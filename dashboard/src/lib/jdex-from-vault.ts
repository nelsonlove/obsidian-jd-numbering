/**
 * Build a `JDex` object from the Obsidian vault state.
 *
 * Walks the vault for areas (`XX-XX <name>/`), categories (`XX <name>/`),
 * and IDs (`XX.YY <title>.md` or `XX.YY <title>/<XX.YY <title>.md>`),
 * extracts frontmatter where present, and assembles the structure
 * jd-cli's YAML schema expects.
 *
 * Per the Obsidian-centric architecture (2026-05-09): the vault is the
 * source of truth; `jd-index.yaml` is a derived cache. This function is
 * the cache-build path.
 */

import { type App, TFile, TFolder } from "obsidian";
import { stringify as stringifyYaml } from "yaml";
import type { JDArea, JDCategory, JDEntry, JDex } from "../jdex";

const AREA_RE = /^(\d{2}-\d{2})\s+(.+)$/;
const CAT_RE = /^(\d{2})\s+(.+)$/;
const ID_RE = /^(\d{2}\.\d{2})\s+(.+?)$/;
const FIVE_DIGIT_RE = /^(\d{5})\s+(.+?)$/;

interface ExtractedFields {
	created?: string;
	description?: string;
	locations?: string[];
}

function extractFromFrontmatter(app: App, file: TFile): ExtractedFields {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!fm) return {};
	const out: ExtractedFields = {};
	if (fm.created != null) {
		const s = String(fm.created).trim();
		if (s) out.created = s;
	}
	if (fm.description != null) {
		const s = String(fm.description).trim();
		if (s) out.description = s;
	}
	if (fm.locations != null) {
		if (Array.isArray(fm.locations)) {
			const arr = fm.locations.map(String).filter((s) => s.length > 0);
			if (arr.length) out.locations = arr;
		} else if (typeof fm.locations === "string" && fm.locations.length > 0) {
			out.locations = [fm.locations];
		}
	}
	return out;
}

/**
 * Find the cover note for a folder: a TFile child whose basename matches
 * the folder's own name (the standard "folder note" pattern in this vault).
 */
function findCoverNote(folder: TFolder): TFile | null {
	for (const c of folder.children) {
		if (c instanceof TFile && c.basename === folder.name) return c;
	}
	return null;
}

function makeEntry(jdId: string, title: string, fields: ExtractedFields): JDEntry {
	const entry: JDEntry = { id: jdId, title };
	if (fields.created) entry.created = fields.created;
	if (fields.description) entry.description = fields.description;
	if (fields.locations && fields.locations.length) entry.locations = fields.locations;
	return entry;
}

/** Build a JDex object by walking vault folders. */
export function buildJdexFromVault(app: App): JDex {
	const root = app.vault.getRoot();
	const areas: JDArea[] = [];

	for (const areaChild of root.children) {
		if (!(areaChild instanceof TFolder)) continue;
		const am = areaChild.name.match(AREA_RE);
		if (!am) continue;

		const area: JDArea = {
			id: am[1],
			title: am[2],
			categories: [],
		};

		for (const catChild of areaChild.children) {
			if (!(catChild instanceof TFolder)) continue;
			const cm = catChild.name.match(CAT_RE);
			if (!cm) continue;

			const category: JDCategory = {
				id: cm[1],
				title: cm[2],
				entries: [],
			};

			const seen = new Set<string>();

			for (const idChild of catChild.children) {
				if (idChild instanceof TFile) {
					if (idChild.extension !== "md") continue;
					const m = idChild.basename.match(ID_RE);
					if (!m) continue;
					const [, jdId, title] = m;
					if (seen.has(jdId)) continue;
					seen.add(jdId);
					category.entries.push(
						makeEntry(jdId, title, extractFromFrontmatter(app, idChild))
					);
				} else if (idChild instanceof TFolder) {
					const m = idChild.name.match(ID_RE) ?? idChild.name.match(FIVE_DIGIT_RE);
					if (!m) continue;
					const [, jdId, title] = m;
					if (seen.has(jdId)) continue;
					seen.add(jdId);
					const cover = findCoverNote(idChild);
					category.entries.push(
						makeEntry(jdId, title, cover ? extractFromFrontmatter(app, cover) : {})
					);
				}
			}

			category.entries.sort((a, b) => a.id.localeCompare(b.id));
			area.categories.push(category);
		}

		area.categories.sort((a, b) => a.id.localeCompare(b.id));
		areas.push(area);
	}

	areas.sort((a, b) => a.id.localeCompare(b.id));
	return { areas };
}

/**
 * Serialize a JDex to YAML matching jd-cli's existing format conventions
 * (block style, 2-space indent, IDs as quoted strings).
 *
 * `yaml@2.x` quotes numeric-looking strings automatically when needed,
 * which matches the existing format. Default lineWidth wraps long lines;
 * set to 0 to disable wrapping for stability.
 */
export function serializeJdex(jdex: JDex): string {
	return stringifyYaml(jdex, {
		lineWidth: 0,
		blockQuote: "literal",
	});
}
