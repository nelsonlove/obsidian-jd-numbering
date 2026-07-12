/**
 * Promote-to-folder — converts an ID note into a same-named folder with
 * the note moved inside as the folder-named cover note.
 *
 *   06 Digital tools/06.13 Bar.md
 *      → 06 Digital tools/06.13 Bar/06.13 Bar.md
 *
 * Useful when a leaf ID note grows enough to need siblings (subfolders,
 * attachments, sub-notes). Operates on the currently active file.
 *
 * Aborts if:
 *   - no active file
 *   - file basename doesn't match `XX.YY Title`
 *   - destination folder already exists
 *   - file is already a cover note (basename === parent folder name)
 */

import { type App, Notice, TFile } from "obsidian";

const ID_RE = /^(\d{2}\.\d{2}|\d{5})\s+(.+)$/;

export async function promoteToFolder(app: App, file: TFile | null): Promise<void> {
	if (!file) {
		new Notice("No active file.");
		return;
	}

	if (!ID_RE.test(file.basename)) {
		new Notice(`Not a JD ID note: ${file.name}`);
		return;
	}

	const parent = file.parent;
	if (!parent) {
		new Notice("File has no parent folder.");
		return;
	}

	if (file.basename === parent.name) {
		new Notice(`${file.name} is already a cover note for its folder.`);
		return;
	}

	const folderName = file.basename;
	// Obsidian represents the vault root as parent.path === "/". Concatenating
	// it would yield `//folderName` — same idiom as renumber.ts / index-vault.ts:
	// treat root as an empty prefix.
	const parentPath = parent.path !== "/" ? parent.path : "";
	const folderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
	const newFilePath = `${folderPath}/${file.name}`;

	if (app.vault.getAbstractFileByPath(folderPath)) {
		new Notice(`Folder already exists: ${folderName}`);
		return;
	}

	try {
		await app.vault.createFolder(folderPath);
		// `renameFile` updates wikilinks pointing at this note (if Obsidian's
		// "auto-update internal links" is on). The basename stays the same,
		// so most resolved links keep working anyway.
		await app.fileManager.renameFile(file, newFilePath);
		new Notice(`Promoted ${folderName} to a folder.`);
	} catch (e) {
		new Notice(`Promote failed: ${(e as Error).message}`);
	}
}
