/**
 * Index a folder note: sync `jd-id` on the note + every sibling, then
 * rebuild the `## Contents (Obsidian)` section with bullet links to siblings.
 */

import { type App, Notice, TFile } from "obsidian";
import { syncJdId, syncJdIds } from "../lib/sync-id";
import { getFolderNoteSiblings, updateFolderNote } from "../lib/folder-notes";

export async function indexFolderNote(app: App, file: TFile): Promise<void> {
	if (!file.parent || file.basename !== file.parent.name) {
		new Notice("This doesn't appear to be a folder note");
		return;
	}

	const allFiles = app.vault.getFiles().filter((f) => f.extension === "md");

	try {
		await syncJdId(app, file);
	} catch (e) {
		console.warn("[jd] index-folder-note: syncJdId on cover failed", file.path, e);
	}
	const syncResult = await syncJdIds(app, getFolderNoteSiblings(allFiles, file));

	let updated = false;
	try {
		updated = await updateFolderNote(app, file, allFiles);
	} catch (e) {
		new Notice(`Index folder note: failed — ${(e as Error).message}`);
		console.warn("[jd] updateFolderNote failed", file.path, e);
		return;
	}

	const errPart = syncResult.failures.length > 0
		? ` · ${syncResult.failures.length} sync errors (see console)`
		: "";
	const baseMsg = updated
		? `Updated folder note links (${syncResult.synced} jd-ids synced)`
		: `No other notes in this folder (${syncResult.synced} jd-ids synced)`;
	new Notice(baseMsg + errPart);
	if (syncResult.failures.length > 0) {
		console.warn("[jd] index-folder-note sync errors:", syncResult.failures);
	}
}
