/**
 * `jd-id` frontmatter sync from filename. The on-save normalizer handles
 * single-file sync inline; these helpers exist for batch operations
 * (index-vault, index-folder-note) that need to fix many files at once.
 *
 * Per-file errors are collected, not thrown. Most likely cause is malformed
 * YAML in a single note (often the very thing the user is running the
 * sync to fix); aborting the whole batch on one bad file is the wrong call.
 */

import type { App, TFile } from "obsidian";

const JD_ID_PATTERN = /^(\d{2}\.\d{2})\b/;

export async function syncJdId(app: App, file: TFile): Promise<boolean> {
	const match = file.basename.match(JD_ID_PATTERN);
	if (!match) return false;

	const jdId = match[1];
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (fm?.["jd-id"] === jdId) return false;

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		frontmatter["jd-id"] = jdId;
	});
	return true;
}

export interface SyncJdIdsResult {
	synced: number;
	failures: { path: string; error: string }[];
}

export async function syncJdIds(app: App, files: TFile[]): Promise<SyncJdIdsResult> {
	const result: SyncJdIdsResult = { synced: 0, failures: [] };
	for (const file of files) {
		try {
			if (await syncJdId(app, file)) result.synced++;
		} catch (e) {
			result.failures.push({ path: file.path, error: (e as Error).message });
			console.warn("[jd] syncJdId failed", file.path, e);
		}
	}
	return result;
}
