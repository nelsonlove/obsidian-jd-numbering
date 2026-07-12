/**
 * Vault scanner — counts inbox items, detects drift, finds missing stubs.
 *
 * Works entirely through Obsidian's vault API (TAbstractFile, TFolder, TFile)
 * so it respects the vault's file index and doesn't hit the filesystem directly.
 */

import { type App, TFile, TFolder } from "obsidian";
import type { JDex, FlatEntry } from "./jdex";
import { flatEntries } from "./jdex";
import type { JDKeys } from "./keys";
import { categoryOf } from "./keys";
import { isIgnored, clearIgnoreCache } from "./ignores";

// ── JD naming patterns ──────────────────────────────────────────

const AREA_RE = /^(\d{2})-(\d{2})\s+(.+)$/;
const CATEGORY_RE = /^(\d{2})\s+(.+)$/;
const ID_RE = /^(\d{2}\.\d{2}|\d{5})\s+(.+)$/;
const INBOX_SUFFIXES = ["Unsorted", "Inbox"];

/**
 * True when `file` is the cover note for an ID directory — i.e. its parent
 * folder matches `XX.YY Title` and the file's basename equals the folder name.
 * Cover-note convention: `06.12 Foo/06.12 Foo.md`.
 */
function isCoverNote(file: TFile): boolean {
	const parent = file.parent;
	if (!parent) return false;
	if (!ID_RE.test(parent.name)) return false;
	return file.basename === parent.name;
}

// ── Inbox scanning ──────────────────────────────────────────────

export interface InboxItem {
	/** Category folder name, e.g. "26 Divorce" */
	category: string;
	/** The .01 folder name, e.g. "26.01 Unsorted" */
	inboxFolder: string;
	/** Full vault path to the inbox folder */
	path: string;
	/** Number of items (files + folders) in the inbox */
	count: number;
	/** Area name for grouping */
	area: string;
}

export function scanInboxes(app: App): InboxItem[] {
	const results: InboxItem[] = [];
	const root = app.vault.getRoot();

	for (const areaChild of root.children) {
		if (!(areaChild instanceof TFolder)) continue;
		const areaMatch = AREA_RE.exec(areaChild.name);
		if (!areaMatch) continue;

		for (const catChild of areaChild.children) {
			if (!(catChild instanceof TFolder)) continue;
			const catMatch = CATEGORY_RE.exec(catChild.name);
			if (!catMatch) continue;

			// Look for XX.01 Unsorted or XX.01 Inbox
			for (const idChild of catChild.children) {
				if (!(idChild instanceof TFolder)) continue;
				const idMatch = ID_RE.exec(idChild.name);
				if (!idMatch) continue;

				const idNum = idMatch[1];
				if (!idNum.endsWith(".01")) continue;

				const title = idMatch[2];
				if (!INBOX_SUFFIXES.some((s) => title.startsWith(s))) continue;

				// Count non-dot children. Exclude the folder's cover note
				// (basename matches folder name) and any legacy +README leftover.
				const coverFilename = `${idChild.name}.md`;
				const count = idChild.children.filter(
					(c) =>
						!c.name.startsWith(".") &&
						c.name !== coverFilename &&
						!c.name.includes("+README")
				).length;

				if (count > 0) {
					results.push({
						category: catChild.name,
						inboxFolder: idChild.name,
						path: idChild.path,
						count,
						area: areaChild.name,
					});
				}
			}
		}
	}

	// Sort busiest first
	results.sort((a, b) => b.count - a.count);
	return results;
}

// ── Drift detection ─────────────────────────────────────────────

export interface DriftItem {
	/** Vault path to the note */
	path: string;
	/** The ID value from frontmatter */
	frontmatterId: string;
	/** The ID parsed from the filename */
	filenameId: string | null;
	/** What's wrong */
	issue: "id-mismatch" | "title-mismatch" | "wrong-folder" | "missing-frontmatter";
	detail: string;
}

export function scanDrift(app: App, keys: JDKeys): DriftItem[] {
	clearIgnoreCache();

	const results: DriftItem[] = [];
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		const fm = cache.frontmatter;
		const filenameMatch = ID_RE.exec(file.basename);
		const filenameId = filenameMatch ? filenameMatch[1] : null;
		const fmId = fm?.[keys.id] ? String(fm[keys.id]) : null;

		if (!filenameId && !fmId) continue;

		if (filenameId && !fmId) {
			if (!isIgnored(app, file, keys, "missing-frontmatter")) {
				results.push({
					path: file.path,
					frontmatterId: "",
					filenameId,
					issue: "missing-frontmatter",
					detail: `File ${file.basename} has JD ID in name but no ${keys.id} frontmatter`,
				});
			}
			continue;
		}

		if (filenameId && fmId && filenameId !== fmId) {
			if (!isIgnored(app, file, keys, "id-mismatch")) {
				results.push({
					path: file.path,
					frontmatterId: fmId,
					filenameId,
					issue: "id-mismatch",
					detail: `Filename says ${filenameId}, frontmatter says ${fmId}`,
				});
			}
			continue;
		}

		// Check that the note is in the right category folder.
		// Cover notes live one level deeper (cat → ID dir → cover note),
		// so use the grandparent for the category check.
		if (fmId && filenameId) {
			const expectedCatNum = categoryOf(fmId);
			const catFolder = isCoverNote(file)
				? file.parent?.parent
				: file.parent;
			if (catFolder) {
				const catMatch = CATEGORY_RE.exec(catFolder.name);
				if (
					catMatch &&
					catMatch[1] !== expectedCatNum &&
					!isIgnored(app, file, keys, "wrong-folder")
				) {
					results.push({
						path: file.path,
						frontmatterId: fmId,
						filenameId,
						issue: "wrong-folder",
						detail: `Note ${fmId} is in category ${catMatch[1]} but should be in ${expectedCatNum}`,
					});
				}
			}
		}
	}

	return results;
}

// ── Missing stub detection ──────────────────────────────────────

export interface MissingStub {
	id: string;
	title: string;
	expectedPath: string;
}

export function findMissingStubs(app: App, jdex: JDex): MissingStub[] {
	const allEntries = flatEntries(jdex);
	const existingIds = new Set<string>();

	// Collect all JD IDs that have notes
	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (match) existingIds.add(match[1]);
	}

	const missing: MissingStub[] = [];
	for (const { entry, category, area } of allEntries) {
		if (existingIds.has(entry.id)) continue;
		const areaFolder = `${area.id} ${area.title}`;
		const catFolder = `${category.id} ${category.title}`;
		missing.push({
			id: entry.id,
			title: entry.title,
			expectedPath: `${areaFolder}/${catFolder}/${entry.id} ${entry.title}.md`,
		});
	}

	return missing;
}
