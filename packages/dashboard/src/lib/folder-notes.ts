/**
 * Folder-note utilities: detection of cover notes, sibling listings,
 * `## Contents (Obsidian)` upserts, and bulk creation of missing folder
 * notes for JD-named folders that need them.
 */

import type { App, TFile, TFolder } from "obsidian";
import { TFolder as TFolderClass } from "obsidian";
import { setSection } from "./sections";

/**
 * Folder names that should have a folder note. Excludes:
 *   - areas like `XX-YY <name>` (no folder note convention)
 *   - categories like `XX <name>` (use XX.00 index file instead)
 * Includes:
 *   - sub-IDs:           XX.YY, XX.YY+SUF
 *   - expanded-area IDs: XXXXX, XXXXX.YY (5-digit Extend-the-End format)
 */
const JD_FOLDER_NEEDS_NOTE = /^(\d{2}\.\d{2}(?:\+\w+)?|\d{5}(?:\.\d{2})?)\s+(.+)$/;

export function getFolderNoteSiblings(allFiles: TFile[], folderNote: TFile): TFile[] {
	return allFiles
		.filter((f) => {
			if (f.extension !== "md") return false;
			if (f.path === folderNote.path) return false;
			if (f.parent?.path !== folderNote.parent?.path) return false;
			return true;
		})
		.sort((a, b) => a.basename.localeCompare(b.basename));
}

export async function updateFolderNote(
	app: App,
	folderNote: TFile,
	allFiles: TFile[]
): Promise<boolean> {
	const siblings = getFolderNoteSiblings(allFiles, folderNote);
	if (siblings.length === 0) return false;

	const links = siblings.map((f) => `- [[${f.basename}]]`).join("\n");
	let content = await app.vault.read(folderNote);
	content = setSection(content, "## Contents (Obsidian)", links);
	await app.vault.modify(folderNote, content);
	return true;
}

export function buildLeafFolderNote(jdId: string, title: string, now: string): string {
	return `---
title: ${title}
jd-id: '${jdId}'
created: ${now}
modified: ${now}
tags: [jd/id]
aliases: [${title}]
linter-yaml-title-alias: ${title}
---

# ${title}
`;
}

export interface EnsureFolderNotesResult {
	created: number;
	failures: { path: string; error: string }[];
}

/**
 * Walk the vault for JD-named folders that lack a folder note and create
 * a minimal one for each. Per-folder errors are collected, not thrown —
 * one bad folder shouldn't kill the whole sweep.
 */
export async function ensureFolderNotes(app: App, now: string): Promise<EnsureFolderNotesResult> {
	const allFolders = app.vault
		.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolderClass);

	const result: EnsureFolderNotesResult = { created: 0, failures: [] };
	for (const folder of allFolders) {
		const m = folder.name.match(JD_FOLDER_NEEDS_NOTE);
		if (!m) continue;
		const [, jdId, title] = m;
		const folderNotePath = `${folder.path}/${folder.name}.md`;
		if (app.vault.getAbstractFileByPath(folderNotePath)) continue;
		try {
			await app.vault.create(folderNotePath, buildLeafFolderNote(jdId, title, now));
			result.created++;
		} catch (e) {
			result.failures.push({ path: folderNotePath, error: (e as Error).message });
			console.warn("[jd] ensureFolderNotes failed", folderNotePath, e);
		}
	}
	return result;
}
