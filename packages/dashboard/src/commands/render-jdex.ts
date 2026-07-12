/**
 * JDex content renderer — populates `XX.00 JDex for category XX.md` files.
 *
 * For each category JDex file in the vault, regenerates a bullet list of
 * `[[ID Title]]` wikilinks for every JDex entry in that category, plus any
 * filesystem-only items (e.g. 5-digit project IDs like `92001`). The list
 * is wrapped in HTML sentinel comments so the command is idempotent and
 * any prose above/below is preserved across runs.
 *
 *   <!-- jd:render-start -->
 *   - [[01.00 JDex for category 01]]
 *   - [[01.01 Inbox for category 01]]
 *   ...
 *   <!-- jd:render-end -->
 *
 * On first run, the sentinel block is inserted after the H1 heading.
 */

import { type App, Notice, TFile, TFolder } from "obsidian";
import type { JDex } from "../jdex";
import { findCategory } from "../jdex";
import type { JDSettings } from "../settings";
import { getKeys, formatTypeFrontmatter } from "../keys";

const CATEGORY_JDEX_RE = /^(\d{2})\.00 JDex for category \1\.md$/;
const CATEGORY_FOLDER_RE = /^(\d{2})\s+(.+)$/;
const AREA_FOLDER_RE = /^\d{2}-\d{2}\s/;
const FIVE_DIGIT_ITEM_RE = /^(\d{5})\s+(.+)$/;
const ID_BASENAME_RE = /^(\d{2}\.\d{2}|\d{5})\s+(.+)$/;

/** Frontmatter key that supplies the entry description (preferred over YAML). */
const DESCRIPTION_KEY = "description";

const SENTINEL_START = "<!-- jd:render-start -->";
const SENTINEL_END = "<!-- jd:render-end -->";

interface RenderEntry {
	id: string;
	title: string;
	description?: string;
}

interface RenderResult {
	scanned: number;
	created: number;
	updated: number;
	unchanged: number;
	skipped: { path: string; reason: string }[];
	driftedRefs: { path: string; ref: string; reason: string }[];
}

export async function renderCategoryJdex(
	app: App,
	jdex: JDex,
	settings: JDSettings
): Promise<RenderResult> {
	const result: RenderResult = {
		scanned: 0,
		created: 0,
		updated: 0,
		unchanged: 0,
		skipped: [],
		driftedRefs: [],
	};

	const idToFile = buildIdFileMap(app);

	// Pass 1: ensure every JDex-YAML category has a JDex note. Create missing.
	for (const area of jdex.areas) {
		for (const cat of area.categories) {
			const expectedPath = expectedJdexPath(area.id, area.title, cat.id, cat.title);
			const existing = app.vault.getAbstractFileByPath(expectedPath);
			if (existing instanceof TFile) continue;
			if (existing) {
				result.skipped.push({
					path: expectedPath,
					reason: "non-file at expected path",
				});
				continue;
			}

			// Make sure parent folder exists before creating.
			const parentPath = expectedPath.slice(0, expectedPath.lastIndexOf("/"));
			try {
				await app.vault.createFolder(parentPath);
			} catch {
				// Folder may already exist
			}

			const entries = collectEntries(app, jdex, cat.id, idToFile);
			const content = buildNewJdexNote(settings, cat.id, cat.title, entries);
			try {
				await app.vault.create(expectedPath, content);
				result.created++;
			} catch (e) {
				result.skipped.push({
					path: expectedPath,
					reason: `create failed: ${(e as Error).message}`,
				});
			}
		}
	}

	// Pass 2: refresh contents of every category JDex file in the vault.
	const targets = findCategoryJdexFiles(app);
	result.scanned = targets.length;

	for (const file of targets) {
		const m = file.name.match(CATEGORY_JDEX_RE);
		if (!m) continue;
		const catNum = m[1];

		const entries = collectEntries(app, jdex, catNum, idToFile);
		if (entries.length === 0) {
			result.skipped.push({
				path: file.path,
				reason: `no entries found for category ${catNum}`,
			});
			continue;
		}

		const block = renderBulletBlock(entries);
		const original = await app.vault.read(file);
		const driftBefore = findDriftedRefs(original, entries);
		for (const ref of driftBefore) {
			result.driftedRefs.push({
				path: file.path,
				ref: ref.ref,
				reason: ref.reason,
			});
		}

		const updated = injectBlock(original, block);
		if (updated === original) {
			result.unchanged++;
			continue;
		}
		await app.vault.modify(file, updated);
		result.updated++;
	}

	const note = `JDex notes: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped.length} skipped`;
	new Notice(note);

	if (result.driftedRefs.length > 0) {
		console.group("JDex render — drifted wikilink references");
		for (const r of result.driftedRefs) {
			console.log(`${r.path}: [[${r.ref}]] — ${r.reason}`);
		}
		console.groupEnd();
	}

	return result;
}

// ── Path / filename construction ─────────────────────────────────

function expectedJdexPath(
	areaId: string,
	areaTitle: string,
	catId: string,
	catTitle: string
): string {
	return `${areaId} ${areaTitle}/${catId} ${catTitle}/${catId}.00 JDex for category ${catId}.md`;
}

// ── New-note construction ───────────────────────────────────────

function buildNewJdexNote(
	settings: JDSettings,
	catId: string,
	catTitle: string,
	entries: RenderEntry[]
): string {
	const keys = getKeys(settings);
	const title = `JDex for category ${catId}`;
	const lines: string[] = [
		"---",
		`${keys.title}: ${title}`,
		`${keys.id}: '${catId}.00'`,
		...formatTypeFrontmatter(settings, "index"),
		"aliases:",
		`    - ${catTitle}`,
		`    - ${catId} ${catTitle}`,
		"---",
		"",
		`# ${title}`,
		"",
		renderBulletBlock(entries),
		"",
	];
	return lines.join("\n");
}

// ── Discovery ────────────────────────────────────────────────────

/**
 * Map JD ID → the most-canonical note file in the vault. When multiple
 * files match (rare), prefer a cover note (basename === parent folder name)
 * over a leaf note.
 */
function buildIdFileMap(app: App): Map<string, TFile> {
	const out = new Map<string, TFile>();
	for (const file of app.vault.getMarkdownFiles()) {
		const m = file.basename.match(ID_BASENAME_RE);
		if (!m) continue;
		const id = m[1];
		const existing = out.get(id);
		if (!existing) {
			out.set(id, file);
			continue;
		}
		const isCoverNew = file.parent?.name === file.basename;
		const isCoverExisting = existing.parent?.name === existing.basename;
		if (isCoverNew && !isCoverExisting) out.set(id, file);
	}
	return out;
}

/**
 * Pull a description for `id` — prefer the note's frontmatter, fall back
 * to the JDex YAML entry.
 */
function descriptionFor(
	app: App,
	id: string,
	idToFile: Map<string, TFile>,
	yamlDescription: string | undefined
): string | undefined {
	const file = idToFile.get(id);
	if (file) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		const fromFm = fm?.[DESCRIPTION_KEY];
		if (fromFm !== undefined && fromFm !== null && String(fromFm).trim()) {
			return String(fromFm).trim();
		}
	}
	return yamlDescription;
}

function findCategoryJdexFiles(app: App): TFile[] {
	const out: TFile[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (CATEGORY_JDEX_RE.test(file.name)) out.push(file);
	}
	return out;
}

/** Collect every entry that should appear in a category's JDex contents. */
function collectEntries(
	app: App,
	jdex: JDex,
	catNum: string,
	idToFile: Map<string, TFile>
): RenderEntry[] {
	const seen = new Set<string>();
	const out: RenderEntry[] = [];

	const cat = findCategory(jdex, catNum);
	if (cat) {
		for (const e of cat.entries) {
			if (seen.has(e.id)) continue;
			seen.add(e.id);
			out.push({
				id: e.id,
				title: e.title,
				description: descriptionFor(app, e.id, idToFile, e.description),
			});
		}
	}

	// Filesystem-only items (e.g. `92001 Substrate/`)
	const folder = findCategoryFolder(app, catNum);
	if (folder) {
		for (const child of folder.children) {
			if (!(child instanceof TFolder)) continue;
			const m = child.name.match(FIVE_DIGIT_ITEM_RE);
			if (!m) continue;
			const id = m[1];
			if (!id.startsWith(catNum)) continue;
			if (seen.has(id)) continue;
			seen.add(id);
			out.push({
				id,
				title: m[2],
				description: descriptionFor(app, id, idToFile, undefined),
			});
		}
	}

	out.sort((a, b) => a.id.localeCompare(b.id));
	return out;
}

function findCategoryFolder(app: App, catNum: string): TFolder | null {
	const root = app.vault.getRoot();
	for (const areaChild of root.children) {
		if (!(areaChild instanceof TFolder)) continue;
		// Skip non-area top-level folders so e.g. `Archives/06 Old Foo/`
		// isn't selected ahead of the real `00-09 System/06 Foo/`.
		if (!AREA_FOLDER_RE.test(areaChild.name)) continue;
		for (const catChild of areaChild.children) {
			if (!(catChild instanceof TFolder)) continue;
			const m = catChild.name.match(CATEGORY_FOLDER_RE);
			if (m && m[1] === catNum) return catChild;
		}
	}
	return null;
}

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render the entry list following the johnnydecimal.com index-page pattern:
 * each entry is a bullet wikilink, optionally followed by a description
 * paragraph separated by blank lines.
 *
 *   - [[01.01 Inbox for category 01]]
 *
 *   Capture buffer for category 01 — items get sorted from here.
 *
 *   - [[01.06 Knowledge base for category 01]]
 */
function renderBulletBlock(entries: RenderEntry[]): string {
	const lines = [SENTINEL_START];
	for (const e of entries) {
		lines.push(`- [[${e.id} ${e.title}]]`);
		if (e.description && e.description.trim()) {
			lines.push("");
			lines.push(e.description.trim());
			lines.push("");
		}
	}
	lines.push(SENTINEL_END);
	return lines.join("\n");
}

/**
 * Replace the sentinel-delimited block in `content`, or insert it after
 * the first H1 if no sentinels exist yet.
 */
function injectBlock(content: string, block: string): string {
	const startIdx = content.indexOf(SENTINEL_START);
	const endIdx = content.indexOf(SENTINEL_END);

	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = content.slice(0, startIdx);
		const after = content.slice(endIdx + SENTINEL_END.length);
		return `${before}${block}${after}`;
	}

	const h1Match = content.match(/^# .+$/m);
	if (!h1Match || h1Match.index === undefined) {
		const sep = content.endsWith("\n") ? "" : "\n";
		return `${content}${sep}\n${block}\n`;
	}
	const insertAt = h1Match.index + h1Match[0].length;
	const before = content.slice(0, insertAt);
	const after = content.slice(insertAt);
	const trimmedAfter = after.replace(/^\n+/, "");
	return `${before}\n\n${block}\n\n${trimmedAfter}`;
}

// ── Drift detection ──────────────────────────────────────────────

interface DriftedRef {
	ref: string;
	reason: string;
}

/**
 * Compare existing wikilinks against the canonical entry list, flagging
 * references with bad IDs (e.g. `[[76.09 Archive for category 77]]` when
 * the actual ID is 77.09).
 */
function findDriftedRefs(content: string, entries: RenderEntry[]): DriftedRef[] {
	const out: DriftedRef[] = [];
	const knownIds = new Set(entries.map((e) => e.id));
	const titleById = new Map(entries.map((e) => [e.id, e.title]));
	const idByTitle = new Map(entries.map((e) => [e.title, e.id]));

	const wikilinkRe = /\[\[([^|\]]+?)\]\]/g;
	for (const match of content.matchAll(wikilinkRe)) {
		const text = match[1].trim();
		const idMatch = text.match(/^(\d{2}\.\d{2})\s+(.+)$/);
		if (!idMatch) continue;
		const refId = idMatch[1];
		const refTitle = idMatch[2];

		if (!knownIds.has(refId)) {
			const correctId = idByTitle.get(refTitle);
			if (correctId) {
				out.push({
					ref: text,
					reason: `ID ${refId} doesn't exist; title matches ${correctId}`,
				});
			} else {
				out.push({ ref: text, reason: `unknown ID ${refId}` });
			}
			continue;
		}
		const expectedTitle = titleById.get(refId);
		if (expectedTitle && expectedTitle !== refTitle) {
			out.push({
				ref: text,
				reason: `title mismatch (expected "${expectedTitle}")`,
			});
		}
	}
	return out;
}
