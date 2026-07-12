/**
 * Vault-wide reindex: ensure folder notes for JD-named folders, rewrite all
 * category JDex (`XX.00`) files at all three tiers (per-category, area
 * management, system), refresh `## Contents (Obsidian)` in every folder
 * note, and sync `jd-id` frontmatter across all JD-named files.
 *
 * Per-iteration error isolation: one bad file (corrupt YAML, locked write,
 * etc.) doesn't kill the whole sweep. Failures are accumulated and surfaced
 * in the final Notice with a console-warn for paths.
 */

import { type App, Notice, TFile, moment } from "obsidian";
import { ensureFolderNotes, updateFolderNote } from "../lib/folder-notes";
import { ensureCategoryIndexes } from "../lib/standard-zeros";
import { syncJdIds } from "../lib/sync-id";
import {
	type PreservedDescription,
	isAreaManagement,
	reindexCategory,
} from "../lib/category-index";

interface Failures {
	indexes: { path: string; error: string }[];
	folderNotes: { path: string; error: string }[];
}

/**
 * Order: ordinary → area-management → system. Upper tiers consume each
 * tier's freshly-rebuilt `## Contents`, so per-area and per-system runs
 * after their inputs are settled.
 */
function tierOrder(prefix: string): number {
	if (prefix === "00") return 2;
	if (isAreaManagement(prefix)) return 1;
	return 0;
}

export async function indexVault(app: App): Promise<void> {
	// Use ISO-style T separator throughout. Space separator confuses some
	// YAML parsers (notably obsidian-linter's "Dedupe YAML Array Values"
	// rule, which mis-treats `2026-05-07 14:39` as a multi-line construct).
	const now = moment().format("YYYY-MM-DDTHH:mm");

	const failures: Failures = { indexes: [], folderNotes: [] };

	// 0a. Auto-create XX.00 index files for JD category folders missing one.
	//     Without these, the next pass cannot enumerate the category at all.
	const categoryIndexResult = await ensureCategoryIndexes(app, now);

	// 0b. Auto-create folder notes for JD leaf-ID folders missing one.
	const folderResult = await ensureFolderNotes(app, now);

	// Refresh file list after potential creations.
	const allFiles = app.vault.getFiles().filter((f) => f.extension === "md");

	// 1. Reindex every XX.00 in tier order. The regex requires a real
	//    separator after `XX.00` to avoid matching `XX.00+SUF.md` siblings.
	const indexFiles = allFiles
		.filter((f) => /^\d{2}\.00(?:\s|\.|$)/.test(f.basename))
		.map((f) => ({ file: f, prefix: f.basename.match(/^(\d{2})/)![1] }))
		.sort((a, b) => tierOrder(a.prefix) - tierOrder(b.prefix) || a.prefix.localeCompare(b.prefix));

	let rewriteCount = 0;
	const allPreserved: PreservedDescription[] = [];
	for (const { file: indexFile } of indexFiles) {
		try {
			const result = await reindexCategory(app, indexFile, allFiles);
			allPreserved.push(...result.preserved);
			rewriteCount++;
		} catch (e) {
			failures.indexes.push({ path: indexFile.path, error: (e as Error).message });
			console.warn("[jd] reindexCategory failed", indexFile.path, e);
		}
	}

	// 2. Update ## Contents (Obsidian) for every folder note.
	let folderNoteCount = 0;
	const folderNotes = allFiles.filter(
		(f) => f.parent && f.basename === f.parent.name && !/^\d{2}\.00\b/.test(f.basename)
	);
	for (const fn of folderNotes) {
		try {
			if (await updateFolderNote(app, fn, allFiles)) folderNoteCount++;
		} catch (e) {
			failures.folderNotes.push({ path: fn.path, error: (e as Error).message });
			console.warn("[jd] updateFolderNote failed", fn.path, e);
		}
	}

	// 3. Sync jd-id frontmatter on all JD-named files.
	const syncResult = await syncJdIds(app, allFiles);

	const errCount =
		failures.indexes.length +
		failures.folderNotes.length +
		categoryIndexResult.failures.length +
		folderResult.failures.length +
		syncResult.failures.length;
	const errPart = errCount > 0 ? ` · ${errCount} errors (see console)` : "";
	const presPart = allPreserved.length > 0
		? ` · ${allPreserved.length} descriptions preserved (see console)`
		: "";
	new Notice(
		`Reindexed ${rewriteCount} indexes, ${folderNoteCount} folder notes updated, ` +
		`${categoryIndexResult.created} new category indexes, ` +
		`${folderResult.created} new folder notes, ${syncResult.synced} IDs synced${errPart}${presPart}`
	);
	if (allPreserved.length > 0) {
		console.log("[jd] Preserved descriptions:", allPreserved);
	}
	if (errCount > 0) {
		console.warn("[jd] indexVault errors:", {
			indexes: failures.indexes,
			folderNotes: failures.folderNotes,
			ensureCategoryIndexes: categoryIndexResult.failures,
			ensureFolderNotes: folderResult.failures,
			syncJdIds: syncResult.failures,
		});
	}
}

export async function indexCategory(app: App, indexFile: TFile): Promise<void> {
	if (!/^\d{2}\.00\b/.test(indexFile.basename)) {
		new Notice("Not a .00 index file");
		return;
	}

	const allFiles = app.vault.getFiles().filter((f) => f.extension === "md");
	const prefix = indexFile.basename.match(/^(\d{2})/)![1];
	const folderPath = indexFile.parent?.path ?? "";
	if (!folderPath) {
		// indexFile somehow has no parent — bail rather than match every
		// file in the vault via empty-prefix startsWith.
		new Notice("Index file has no parent folder; cannot scope reindex.");
		return;
	}

	// Bare `startsWith(folderPath)` matches sibling-prefix folders like
	// `06 Foo` vs `06 Foo Long`, scooping unrelated files into this
	// category's reindex. Require either an exact match (the folder note
	// itself) or a child path (`folderPath + "/"`).
	const inCategoryScope = (path: string) =>
		path === folderPath || path.startsWith(folderPath + "/");

	const failures: { path: string; error: string }[] = [];
	const preserved: PreservedDescription[] = [];

	try {
		const result = await reindexCategory(app, indexFile, allFiles);
		preserved.push(...result.preserved);
	} catch (e) {
		failures.push({ path: indexFile.path, error: (e as Error).message });
		console.warn("[jd] reindexCategory failed", indexFile.path, e);
	}

	let folderNoteCount = 0;
	const folderNotes = allFiles.filter(
		(f) =>
			f.parent &&
			f.basename === f.parent.name &&
			!/^\d{2}\.00\b/.test(f.basename) &&
			inCategoryScope(f.parent.path)
	);
	for (const fn of folderNotes) {
		try {
			if (await updateFolderNote(app, fn, allFiles)) folderNoteCount++;
		} catch (e) {
			failures.push({ path: fn.path, error: (e as Error).message });
			console.warn("[jd] updateFolderNote failed", fn.path, e);
		}
	}

	const catFiles = allFiles.filter((f) => f.parent && inCategoryScope(f.parent.path));
	const syncResult = await syncJdIds(app, catFiles);

	const errCount = failures.length + syncResult.failures.length;
	const errPart = errCount > 0 ? ` · ${errCount} errors (see console)` : "";
	const presPart = preserved.length > 0
		? ` · ${preserved.length} descriptions preserved (see console)`
		: "";
	new Notice(
		`Reindexed ${prefix}, ${folderNoteCount} folder notes, ${syncResult.synced} IDs synced${errPart}${presPart}`
	);
	if (preserved.length > 0) {
		console.log("[jd] Preserved descriptions:", preserved);
	}
	if (errCount > 0) {
		console.warn("[jd] indexCategory errors:", { failures, syncJdIds: syncResult.failures });
	}
}
