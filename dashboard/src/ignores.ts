/**
 * Cascading ignore resolution.
 *
 * A file's effective ignore list is the union of:
 *   1. Its own frontmatter ignore field
 *   2. Every ancestor folder's cover note ignore field (cover notes are
 *      identified by basename === parent folder name)
 *
 * This lets users silence a whole subtree by setting `jd-ignore: true` once
 * on the cover note for that subtree.
 */

import { type App, TFile } from "obsidian";
import type { JDKeys } from "./keys";
import { parseIgnoreField } from "./keys";

const cache = new Map<string, string[]>();

export function clearIgnoreCache(): void {
	cache.clear();
}

/**
 * Read a single file's `<ignoreKey>` frontmatter field, normalized to a list.
 */
function ownIgnores(app: App, file: TFile, keys: JDKeys): string[] {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!fm || fm[keys.ignore] === undefined) return [];
	return parseIgnoreField(fm[keys.ignore]);
}

/**
 * Collect the effective ignore list for a file, walking up through any
 * cover notes in ancestor folders.
 */
export function ignoresFor(app: App, file: TFile, keys: JDKeys): string[] {
	const cacheKey = `${keys.ignore}::${file.path}`;
	const cached = cache.get(cacheKey);
	if (cached) return cached;

	const collected: string[] = [];
	collected.push(...ownIgnores(app, file, keys));

	let folder = file.parent;
	while (folder && folder.parent) {
		const coverPath = `${folder.path}/${folder.name}.md`;
		const coverFile = app.vault.getAbstractFileByPath(coverPath);
		if (coverFile instanceof TFile && coverFile.path !== file.path) {
			collected.push(...ownIgnores(app, coverFile, keys));
		}
		folder = folder.parent;
	}

	cache.set(cacheKey, collected);
	return collected;
}

export function isIgnored(
	app: App,
	file: TFile,
	keys: JDKeys,
	checkName: string
): boolean {
	const list = ignoresFor(app, file, keys);
	return list.includes("*") || list.includes(checkName);
}
