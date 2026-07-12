/**
 * Filesystem-contents renderer — populates the `## Contents (Filesystem)`
 * section of a cover note with an LLM-generated description of what's
 * actually on the filesystem at that JD ID.
 *
 * Owns the entire `## Contents (Filesystem)` section (heading included) via
 * `setSection`. Sibling section `## Contents (Obsidian)` is independently
 * managed by index-folder-note. Adaptive prompt: bullet ≤7, group 8–25,
 * prose >25.
 *
 * Costs a paid API call per run, so the command is manual-only and
 * operates on the active note. Bumps `surveyed` frontmatter on every
 * successful run (including no-op same-output runs — re-running IS a
 * survey event regardless of whether the body changed).
 */

import { type App, Notice, TFile, moment } from "obsidian";
import { readdirSync, lstatSync, readlinkSync } from "fs";
import { homedir } from "os";
import { sep } from "path";
import { type JDSettings, type LlmTaskId } from "../settings";
import { getProvider, type ProviderId } from "../llm/provider";
import { getApiKey } from "../llm/secrets";
import { getKeys } from "../keys";
import { setSection } from "../lib/sections";

// Typed as LlmTaskId so a future rename in LLM_TASKS without renaming here
// fails the build instead of producing a runtime undefined lookup.
const TASK_ID: LlmTaskId = "renderFiles";
const SECTION_HEADING = "## Contents (Filesystem)";

/** Filenames to skip in the listing. */
const IGNORE_NAMES = new Set([".DS_Store", ".localized", "Thumbs.db"]);

/** Subdirs whose name matches a JD-ID pattern have their own notes — skip them. */
const ID_SUBDIR_RE = /^(\d{2}\.\d{2}|\d{5})\s+/;

/**
 * Extract a JD ID prefix from a filename basename. Accepts the +SUF
 * suffix form (`06.13+REPORT Foo`) used by SUBID_TYPES — otherwise a
 * legitimate stem note would false-abort against its matching
 * frontmatter id when its filename trips the equality check.
 */
const FILENAME_ID_RE = /^(\d{2}\.\d{2}(?:\+\w+)?|\d{5}(?:\+\w+)?)\s+/;

/** Discriminated union — each kind carries exactly the fields it needs. */
type ListedEntry =
	| { kind: "file"; name: string; size: number }
	| { kind: "dir"; name: string }
	| { kind: "symlink"; name: string; target: string | null };

interface ListResult {
	entries: ListedEntry[];
	skipped: { name: string; reason: string }[];
}

/**
 * Discriminated union over the path-resolution result so consumers can
 * narrow via `if (resolved.ok) { use resolved.path }` rather than checking
 * which-of-two-optionals-is-set.
 */
type PathResolution =
	| { ok: true; path: string }
	| { ok: false; error: string };

export async function renderFiles(
	app: App,
	settings: JDSettings,
	file: TFile
): Promise<void> {
	const keys = getKeys(settings);
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	const id = fm?.[keys.id];
	if (!id || typeof id !== "string") {
		new Notice("Render Files: active note has no JD ID in frontmatter.");
		return;
	}

	// Filesystem-path resolution downstream derives the directory from
	// `file.basename` / `file.parent`, not from this `id`. If the filename
	// JD prefix has drifted from the frontmatter `id`, we'd be making a
	// paid LLM call against the wrong directory. Abort and tell the user
	// to reconcile via drift-report rather than silently mispoint.
	const filenameIdMatch = file.basename.match(FILENAME_ID_RE);
	const filenameId = filenameIdMatch ? filenameIdMatch[1] : null;
	if (filenameId !== id) {
		new Notice(
			`Render Files: filename JD ID ${filenameId ?? "(none)"} doesn't match frontmatter ${keys.id} = ${id}. Reconcile via drift-report, then retry.`
		);
		return;
	}

	const taskModel = settings.llmTaskModels[TASK_ID];
	if (!taskModel) {
		new Notice("Render Files: no model configured. Open plugin settings → 'Per-task models' and pick one.");
		return;
	}
	const apiKey = getApiKey(app, taskModel.provider);
	if (!apiKey) {
		new Notice(`Render Files: no ${taskModel.provider} API key set. Open plugin settings → 'AI provider keys'.`);
		return;
	}

	const resolved = resolveFilesystemPath(settings, file);
	if (!resolved.ok) {
		new Notice(`Render Files: ${resolved.error}`);
		return;
	}
	const fsPath = resolved.path;

	let listed: ListResult;
	try {
		listed = listDirectory(fsPath);
	} catch (e) {
		new Notice(`Render Files: ${(e as Error).message}`);
		return;
	}

	if (listed.entries.length === 0) {
		new Notice(`Render Files: ${fsPath} has no listable entries.`);
		return;
	}

	const prompt = buildPrompt(settings, fsPath, listed.entries);
	const provider = getProvider(taskModel.provider);

	new Notice(`Render Files: calling ${taskModel.provider}:${taskModel.model}…`);
	let body: string;
	try {
		body = await provider.complete({ apiKey, model: taskModel.model, prompt });
	} catch (e) {
		new Notice(`Render Files: LLM call failed — ${(e as Error).message}`);
		return;
	}

	// LLM call succeeded — we're now committed. Any failure past this point
	// wastes the paid call, so wrap each step and surface a clear retry-safe
	// notice. The body string lives in scope so the caller can manually retry
	// if needed (the next paid call will reuse the same text only by coincidence).
	const wrapped = wrapAutoGenerated(body, fsPath, listed.entries.length, taskModel);
	let original: string;
	try {
		original = await app.vault.read(file);
	} catch (e) {
		new Notice(`Render Files: LLM responded but vault read failed — ${(e as Error).message}. Output not written.`);
		console.warn("[jd] render-files: post-LLM read failed", file.path, "body:\n" + body);
		return;
	}

	const updated = setSection(original, SECTION_HEADING, wrapped);

	try {
		if (updated !== original) {
			await app.vault.modify(file, updated);
		}
		await markSurveyed(app, file);
	} catch (e) {
		new Notice(`Render Files: LLM responded but write failed — ${(e as Error).message}. Output not saved.`);
		console.warn("[jd] render-files: post-LLM write failed", file.path, "body:\n" + body);
		return;
	}

	const skippedNote = listed.skipped.length > 0
		? ` (${listed.skipped.length} unreadable entries skipped — see console)`
		: "";
	if (updated === original) {
		new Notice(`Render Files: no body changes — bumped \`surveyed\`${skippedNote}.`);
	} else {
		new Notice(`Render Files: rendered${skippedNote}.`);
	}
	if (listed.skipped.length > 0) {
		console.warn("[jd] render-files: skipped entries in", fsPath, listed.skipped);
	}
}

async function markSurveyed(app: App, file: TFile): Promise<void> {
	// Match the `created`/`modified` format from the rest of the codebase
	// so obsidian-linter's date-parser doesn't misparse adjacent fields.
	const today = moment().format("YYYY-MM-DDTHH:mm");
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm.surveyed = today;
	});
}

// ── Path resolution ─────────────────────────────────────────────

function resolveFilesystemPath(settings: JDSettings, file: TFile): PathResolution {
	// Only expand a leading `~` or `~/...` — never mid-string tildes.
	// See note on `JDDashboardPlugin.resolvePath` in main.ts.
	const raw = settings.jdRoot;
	let root: string;
	if (raw === "~") root = homedir();
	else if (raw.startsWith("~/")) root = homedir() + raw.slice(1);
	else root = raw;
	while (root.length > 1 && root.endsWith(sep)) root = root.slice(0, -1);
	if (!root.startsWith(sep)) {
		return { ok: false, error: `JD root '${settings.jdRoot}' is not absolute. Set it under plugin settings → Paths.` };
	}

	const parentName = file.parent?.name ?? "";
	const isCover = parentName === file.basename;
	const vaultRelDir = isCover
		? file.parent?.path ?? ""
		: dirSiblingForLeaf(file);
	if (!vaultRelDir) return { ok: false, error: "active note has no resolvable vault path" };

	const segments = vaultRelDir.split("/");
	if (segments.some((s) => s === "..")) {
		return { ok: false, error: "vault path contains '..' segment — refusing to traverse outside JD root" };
	}
	if (segments.some((s) => s === "")) {
		return { ok: false, error: "vault path has empty segment" };
	}
	if (vaultRelDir.startsWith("/")) {
		return { ok: false, error: "vault path is absolute — refusing" };
	}
	const relNative = segments.join(sep);
	return { ok: true, path: `${root}${sep}${relNative}` };
}

function dirSiblingForLeaf(file: TFile): string {
	const parentPath = file.parent?.path ?? "";
	const sibling = file.basename;
	return parentPath ? `${parentPath}/${sibling}` : sibling;
}

// ── Directory listing ───────────────────────────────────────────

function listDirectory(absPath: string): ListResult {
	let root = absPath;
	while (root.length > 1 && root.endsWith(sep)) root = root.slice(0, -1);
	const names = readdirSync(root);
	const entries: ListedEntry[] = [];
	const skipped: { name: string; reason: string }[] = [];

	for (const name of names) {
		if (IGNORE_NAMES.has(name)) continue;
		if (name.startsWith(".")) continue;
		if (ID_SUBDIR_RE.test(name)) continue;
		if (name.includes("/") || name.includes("\\") || name === "..") continue;

		const full = `${root}${sep}${name}`;
		let lst;
		try {
			lst = lstatSync(full);
		} catch (e) {
			skipped.push({ name, reason: `lstat: ${(e as Error).message}` });
			continue;
		}

		if (lst.isSymbolicLink()) {
			let target: string | null = null;
			try {
				target = readlinkSync(full);
			} catch {
				target = null;
			}
			entries.push({ kind: "symlink", name, target });
		} else if (lst.isDirectory()) {
			entries.push({ kind: "dir", name });
		} else {
			entries.push({ kind: "file", name, size: lst.size });
		}
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return { entries, skipped };
}

// ── Prompt building ─────────────────────────────────────────────

const DEFAULT_PROMPT = `You are documenting a Johnny Decimal directory for an Obsidian note's "## Contents (Filesystem)" section. Below is the directory listing.

Directory: {path}
Items: {count} total

{listing}

Write a concise markdown description following these rules:

- ≤ 7 items: bullet list every item, one short note per file (what it is or why it's here, inferred from the filename).
- 8–25 items: group by type or naming pattern, give counts per group, then bullet-list the most notable individual items (largest, oldest, anything that doesn't fit a group).
- > 25 items: a short prose summary (≤ 4 sentences) describing what's in the directory and how it's organized. No exhaustive lists.

Always:
- Surface symlinks with their resolved targets
- Mention anything that looks like a subproject, repo, or scan series
- If filenames suggest a date range, mention it
- Don't speculate beyond what filenames + extensions support
- No preamble ("This directory contains…") — just the description
- Markdown only, no headings (the "## Contents (Filesystem)" heading already exists)`;

function buildPrompt(settings: JDSettings, path: string, entries: ListedEntry[]): string {
	const template = settings.renderFilesPrompt.trim() || DEFAULT_PROMPT;
	const listing = formatListing(entries);
	return template
		.replace(/\{path\}/g, displayPath(path))
		.replace(/\{count\}/g, String(entries.length))
		.replace(/\{listing\}/g, listing);
}

function formatListing(entries: ListedEntry[]): string {
	const rows: string[] = [];
	for (const e of entries) {
		switch (e.kind) {
			case "symlink":
				rows.push(`${e.name}    → ${e.target ?? "(unresolved)"} (symlink)`);
				break;
			case "dir":
				rows.push(`${e.name}/    (dir)`);
				break;
			case "file":
				rows.push(`${e.name}    ${formatSize(e.size)}`);
				break;
		}
	}
	return rows.join("\n");
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function displayPath(absPath: string): string {
	const home = process.env.HOME ?? "";
	if (home && absPath.startsWith(home)) return "~" + absPath.slice(home.length);
	return absPath;
}

// ── Auto-gen wrapping ───────────────────────────────────────────

function wrapAutoGenerated(
	body: string,
	fsPath: string,
	count: number,
	taskModel: { provider: ProviderId; model: string }
): string {
	const date = moment().format("YYYY-MM-DD");
	return [
		"> [!warning]+ Auto-generated — do not edit",
		"> Regenerated by **JD: Render filesystem contents**. Manual edits in this section will be overwritten on next run.",
		"",
		body.trim(),
		"",
		`*Generated ${date} by ${taskModel.provider}:${taskModel.model} from \`${displayPath(fsPath)}\` (${count} entries)*`,
	].join("\n");
}
