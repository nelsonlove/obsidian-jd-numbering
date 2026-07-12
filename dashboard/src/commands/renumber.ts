/**
 * Renumber an active JD note to a new ID. If the target ID is already
 * occupied, prompts whether to auto-displace the occupant (next available
 * ID in its category) or to enter a manual displacement ID. Then renames
 * both notes in the right order so the slot opens before the source moves.
 *
 * Renames the .md file and the parent folder (if it's a folder cover note),
 * and updates `jd-id` frontmatter. Wikilinks auto-update via
 * `app.fileManager.renameFile`.
 *
 * Each rename step is wrapped: a partial failure (e.g. occupant moved but
 * source didn't) surfaces an explicit Notice describing the inconsistent
 * state so the user knows to fix it manually.
 */

import { type App, Notice, TFile, TFolder } from "obsidian";
import { confirmPrompt, inputPrompt } from "../lib/prompts";

const ID_RE = /^(\d{2}\.\d{2})$/;
const FN_RE = /^(\d{2}\.\d{2})\s+(.+)$/;

export async function renumberCommand(app: App, file: TFile): Promise<void> {
	const fnMatch = file.basename.match(FN_RE);
	if (!fnMatch) {
		new Notice("Active file's name doesn't start with a JD ID (e.g. '06.13 Foo')");
		return;
	}
	const currentId = fnMatch[1];

	const newId = await inputPrompt(app, `Renumber ${currentId} → ?`, "XX.YY", currentId);
	if (newId === null) return;
	const target = newId.trim();
	if (!ID_RE.test(target)) {
		new Notice(`Invalid ID: ${newId}`);
		return;
	}
	if (target === currentId) {
		new Notice("New ID equals current — nothing to do");
		return;
	}

	const occupants = findByJdId(app, target, file);
	if (occupants.length > 1) {
		new Notice(
			`Renumber: ${occupants.length} files already claim ID ${target} — resolve the duplicates first (see console). Source unchanged.`
		);
		console.warn(
			"[jd] renumber: duplicate occupants for", target,
			occupants.map((o) => o.path)
		);
		return;
	}
	const occupant: TFile | null = occupants[0] ?? null;
	let displaceId: string | null = null;

	if (occupant) {
		const auto = await confirmPrompt(
			app,
			`${target} is in use by "${occupant.basename}"`,
			"Auto-displace the existing note to the next available ID in its category?"
		);
		if (auto === null) {
			new Notice("Renumber cancelled");
			return;
		}
		if (auto) {
			displaceId = nextAvailableId(app, target.slice(0, 2));
			if (!displaceId) {
				new Notice("No free IDs available in that category");
				return;
			}
		} else {
			const manual = await inputPrompt(app, `New ID for "${occupant.basename}"`, "XX.YY");
			if (manual === null) {
				new Notice("Renumber cancelled");
				return;
			}
			if (!ID_RE.test(manual.trim())) {
				new Notice(`Invalid displacement ID: ${manual}`);
				return;
			}
			displaceId = manual.trim();
			if (findByJdId(app, displaceId, occupant).length > 0) {
				new Notice(`${displaceId} is also taken — pick a free ID and try again`);
				return;
			}
		}

		try {
			await renumber(app, occupant, displaceId);
		} catch (e) {
			new Notice(`Renumber: failed to displace occupant — ${(e as Error).message}. Source unchanged.`);
			console.error("[jd] renumber: occupant displacement failed", e);
			return;
		}
	}

	try {
		await renumber(app, file, target);
	} catch (e) {
		const inconsistencyNote = occupant
			? ` Occupant was already moved to ${displaceId} — vault is in inconsistent state.`
			: "";
		new Notice(`Renumber: source rename failed — ${(e as Error).message}.${inconsistencyNote}`);
		console.error("[jd] renumber: source rename failed", e);
		return;
	}

	new Notice(
		occupant
			? `Renumbered ${currentId} → ${target}; displaced → ${displaceId}`
			: `Renumbered ${currentId} → ${target}`
	);
}

// ── Lookups ─────────────────────────────────────────────────────

/**
 * Return *all* files claiming `id` (by frontmatter `jd-id` or by filename
 * prefix). Returning the full set lets the caller distinguish the safe
 * "exactly one occupant, displace it" path from the unsafe "multiple
 * occupants, vault is already drifted" path. A file matching both
 * predicates counts once.
 */
function findByJdId(app: App, id: string, exclude: TFile): TFile[] {
	const matches: TFile[] = [];
	for (const f of app.vault.getMarkdownFiles()) {
		if (f.path === exclude.path) continue;
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		const fmMatch = fm && fm["jd-id"] === id;
		const fnMatch = f.basename.startsWith(`${id} `);
		if (fmMatch || fnMatch) matches.push(f);
	}
	return matches;
}

function nextAvailableId(app: App, categoryNum: string): string | null {
	const used = new Set<string>();
	for (const f of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		const id = fm?.["jd-id"];
		if (typeof id === "string" && id.startsWith(`${categoryNum}.`)) used.add(id);
		const m = f.basename.match(FN_RE);
		if (m && m[1].startsWith(`${categoryNum}.`)) used.add(m[1]);
	}
	for (let i = 10; i <= 99; i++) {
		const candidate = `${categoryNum}.${String(i).padStart(2, "0")}`;
		if (!used.has(candidate)) return candidate;
	}
	return null;
}

// ── Renaming ────────────────────────────────────────────────────

async function renumber(app: App, file: TFile, newId: string): Promise<void> {
	const m = file.basename.match(FN_RE);
	if (!m) throw new Error(`Refusing to rename ${file.path} — no JD ID prefix in filename`);
	const title = m[2];
	const newBasename = `${newId} ${title}`;
	const parent = file.parent;
	const isCoverNote = parent && file.basename === parent.name;

	if (isCoverNote && parent) {
		const grandparentPath = parent.parent && parent.parent.path !== "/" ? parent.parent.path : "";
		const newFolderPath = grandparentPath ? `${grandparentPath}/${newBasename}` : newBasename;
		await app.fileManager.renameFile(parent as TFolder, newFolderPath);
		try {
			await app.fileManager.renameFile(file, `${newFolderPath}/${newBasename}.md`);
		} catch (e) {
			throw new Error(
				`folder renamed to '${newFolderPath}' but cover-note rename failed: ${(e as Error).message}`
			);
		}
	} else {
		const parentPath = parent && parent.path !== "/" ? parent.path : "";
		const newPath = parentPath ? `${parentPath}/${newBasename}.md` : `${newBasename}.md`;
		await app.fileManager.renameFile(file, newPath);
	}

	try {
		await app.fileManager.processFrontMatter(file, (fm) => {
			fm["jd-id"] = newId;
		});
	} catch (e) {
		throw new Error(
			`renamed to '${newBasename}' but jd-id frontmatter update failed: ${(e as Error).message}`
		);
	}
}
