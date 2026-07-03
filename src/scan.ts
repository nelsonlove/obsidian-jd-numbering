import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
	JdConfig,
	ParsedId,
	parseJdId,
	idTokenFromName,
	areaOfCategory,
} from "./jd";

export interface JdNote {
	file: TFile;
	/** Value of the `jd-id` frontmatter field, if present. */
	frontId: string | null;
	/** Parsed frontmatter id, if valid. */
	parsed: ParsedId | null;
	/** The leading id token of the filename (may differ from frontId). */
	nameId: string;
	title: string;
	/** True when the note carries a `system/redirect` tag (a moved-note stub). */
	isRedirect: boolean;
	/** True when the file is a folder note (basename == its parent folder name). */
	isFolderNote: boolean;
}

export interface VaultScan {
	notes: JdNote[];
	/** category code (e.g. "06") -> folder path of that category. */
	categoryFolders: Map<string, string>;
	/** area band (e.g. "00-09") -> folder path of that area. */
	areaFolders: Map<string, string>;
}

const RE_AREA_FOLDER = /^([0-9]0-[0-9]9) /;
const RE_CAT_FOLDER = /^([0-9]{2}) /;

function tagsOf(app: App, file: TFile): string[] {
	const cache = app.metadataCache.getFileCache(file);
	const out: string[] = [];
	const fm = cache?.frontmatter;
	if (fm && fm.tags) {
		const t = fm.tags;
		if (Array.isArray(t)) out.push(...t.map(String));
		else if (typeof t === "string") out.push(...t.split(/[,\s]+/).filter(Boolean));
	}
	if (cache?.tags) out.push(...cache.tags.map((x) => x.tag.replace(/^#/, "")));
	return out;
}

export function scanVault(app: App, cfg: JdConfig): VaultScan {
	const notes: JdNote[] = [];
	const categoryFolders = new Map<string, string>();
	const areaFolders = new Map<string, string>();

	// Map area/category folders by their name prefix.
	const walk = (folder: TFolder) => {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				const am = child.name.match(RE_AREA_FOLDER);
				if (am && !areaFolders.has(am[1])) areaFolders.set(am[1], child.path);
				const cm = child.name.match(RE_CAT_FOLDER);
				if (cm && !categoryFolders.has(cm[1])) categoryFolders.set(cm[1], child.path);
				walk(child);
			}
		}
	};
	walk(app.vault.getRoot());

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		const frontId = fm && fm["jd-id"] != null ? String(fm["jd-id"]) : null;
		const parsed = frontId ? parseJdId(frontId, cfg) : null;
		const nameId = idTokenFromName(file.basename);
		const tags = tagsOf(app, file);
		const parentName = file.parent ? file.parent.name : "";
		notes.push({
			file,
			frontId,
			parsed,
			nameId,
			title: (fm && typeof fm.title === "string" && fm.title) || file.basename,
			isRedirect: tags.includes("system/redirect"),
			isFolderNote: file.basename === parentName,
		});
	}

	return { notes, categoryFolders, areaFolders };
}

/** All decimal parts (.YY -> integer) already used in a normal category. */
export function usedDecimals(scan: VaultScan, category: string): Set<number> {
	const used = new Set<number>();
	for (const n of scan.notes) {
		const id = n.parsed;
		if (id && id.kind === "id" && id.category === category) {
			used.add(parseInt(id.raw.split(".")[1], 10));
		}
	}
	return used;
}

/** Highest 5-digit item already used in an expanded category, or null. */
export function maxExpandedItem(scan: VaultScan, category: string): number | null {
	let max: number | null = null;
	for (const n of scan.notes) {
		const id = n.parsed;
		if (id && id.kind === "expanded-item" && id.category === category) {
			const v = parseInt(id.raw, 10);
			if (max === null || v > max) max = v;
		}
	}
	return max;
}

/**
 * Expected folder path for a parsed id, using the discovered category folder.
 * Returns null when we can't locate the category's folder.
 */
export function expectedFolder(scan: VaultScan, id: ParsedId): string | null {
	if (id.kind === "area") return scan.areaFolders.get(id.area) ?? null;
	return scan.categoryFolders.get(id.category) ?? null;
}

/** Expected filename (with extension) for an id + title. */
export function expectedFilename(idRaw: string, title: string): string {
	return `${idRaw} ${title}.md`;
}

export function targetPath(folder: string, idRaw: string, title: string): string {
	return normalizePath(`${folder}/${expectedFilename(idRaw, title)}`);
}

export { areaOfCategory };
