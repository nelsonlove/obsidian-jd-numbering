/**
 * Vault validator — comprehensive JD system health checks.
 *
 * Each check is a pure function: (app, jdex?) -> ValidationIssue[].
 * The engine runs all checks and collates results by severity.
 * Never modifies files — report only.
 */

import { type App, TFile, TFolder } from "obsidian";
import type { JDex, JDConfig } from "./jdex";
import { flatEntries, findCategory, isExpandedAreaItem } from "./jdex";
import type { JDKeys } from "./keys";
import { categoryOf } from "./keys";
import { isIgnored, clearIgnoreCache } from "./ignores";

// ── Types ────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
	check: string;
	severity: Severity;
	path: string;
	message: string;
	suggestion?: string;
}

export interface ValidationReport {
	timestamp: string;
	issues: ValidationIssue[];
	summary: Record<Severity, number>;
	filesScanned: number;
}

// ── Patterns ─────────────────────────────────────────────────────

const ID_RE = /^(\d{2}\.\d{2}|\d{5})\s+(.+)$/;
const AREA_RE = /^(\d{2})-(\d{2})\s+(.+)$/;
const CATEGORY_RE = /^(\d{2})\s+(.+)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

// ── Individual checks ────────────────────────────────────────────

/**
 * Return the normalized list of frontmatter tags (without leading `#`).
 *
 * Honors both `tags:` and `tag:` keys (Obsidian's raw frontmatter
 * preserves whichever the user wrote — only the higher-level
 * `cache.tags` aggregate normalizes them).
 */
function frontmatterTags(fm: unknown): string[] {
	if (!fm || typeof fm !== "object") return [];
	const f = fm as Record<string, unknown>;
	const collect = (raw: unknown): string[] => {
		if (raw == null) return [];
		const arr = Array.isArray(raw) ? raw : [raw];
		return arr.map((t) => String(t).replace(/^#/, ""));
	};
	return [...collect(f.tags), ...collect(f.tag)];
}

function checkRequiredFields(
	app: App,
	keys: JDKeys,
	typeTagPrefix: string
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const idTitleFields = [keys.id, keys.title];

	for (const file of app.vault.getMarkdownFiles()) {
		const match = file.basename.match(ID_RE);
		if (!match) continue;

		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;

		for (const field of idTitleFields) {
			if (!fm || !fm[field]) {
				issues.push({
					check: "required-fields",
					severity: "error",
					path: file.path,
					message: `Missing required field: ${field}`,
					suggestion: `Add ${field} to frontmatter`,
				});
			}
		}

		// Type marker — accept either `<typeKey>` frontmatter or any
		// `<typeTagPrefix>*` tag (e.g. `jd/index`). The setting `typeAsTag`
		// only governs write-mode; the validator accepts either form so
		// users mid-migration aren't penalized.
		const hasTypeField = !!(fm && fm[keys.type]);
		const hasTypeTag = frontmatterTags(fm).some((t) =>
			t.startsWith(typeTagPrefix)
		);
		if (!hasTypeField && !hasTypeTag) {
			issues.push({
				check: "required-fields",
				severity: "error",
				path: file.path,
				message: `Missing type marker: no ${keys.type} frontmatter and no ${typeTagPrefix}* tag`,
				suggestion: `Add a ${typeTagPrefix}<type> tag (e.g. ${typeTagPrefix}index) or ${keys.type}: <type> frontmatter`,
			});
		}
	}

	return issues;
}

function checkDateFormats(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const dateFields = ["created", "modified", "surveyed"];

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) continue;

		for (const field of dateFields) {
			const val = fm[field];
			if (val === undefined || val === null || val === "") continue;

			const str = String(val);
			if (!ISO_DATE_RE.test(str)) {
				issues.push({
					check: "date-format",
					severity: "warning",
					path: file.path,
					message: `Invalid date format in ${field}: "${str}"`,
					suggestion: `Use ISO 8601 format: YYYY-MM-DD`,
				});
			}
		}
	}

	return issues;
}

function checkValidCategories(app: App, keys: JDKeys): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	const knownCategories = new Set<string>();
	const root = app.vault.getRoot();
	for (const areaChild of root.children) {
		if (!(areaChild instanceof TFolder)) continue;
		if (!AREA_RE.test(areaChild.name)) continue;
		for (const catChild of areaChild.children) {
			if (!(catChild instanceof TFolder)) continue;
			const m = CATEGORY_RE.exec(catChild.name);
			if (m) knownCategories.add(m[1]);
		}
	}

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.[keys.id]) continue;

		const jdId = String(fm[keys.id]).replace(/\+.*$/, "");
		const catNum = categoryOf(jdId);
		if (catNum && !knownCategories.has(catNum)) {
			issues.push({
				check: "valid-category",
				severity: "error",
				path: file.path,
				message: `${keys.id} ${fm[keys.id]} references unknown category ${catNum}`,
				suggestion: `Verify category ${catNum} exists in the vault`,
			});
		}
	}

	return issues;
}

function checkDuplicateIds(app: App, keys: JDKeys): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const seen = new Map<string, string[]>();

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.[keys.id]) continue;

		const id = String(fm[keys.id]);
		const list = seen.get(id) ?? [];
		list.push(file.path);
		seen.set(id, list);
	}

	for (const [id, paths] of seen) {
		if (paths.length > 1) {
			for (const path of paths) {
				issues.push({
					check: "duplicate-id",
					severity: "error",
					path,
					message: `Duplicate ${keys.id} '${id}' (${paths.length} notes)`,
					suggestion: `Other files: ${paths.filter((p) => p !== path).join(", ")}`,
				});
			}
		}
	}

	return issues;
}

/**
 * True when frontmatter marks the file as type `index`. Honors both
 * key-mode (`jd-type: index`) and tag-mode (`tags: [jd/index]`) — the
 * latter is the active configuration for users with `typeAsTag: true`.
 */
function isIndexFile(fm: unknown, keys: JDKeys, indexTag?: string): boolean {
	if (!fm || typeof fm !== "object") return false;
	const f = fm as Record<string, unknown>;
	if (f[keys.type] === "index") return true;
	if (!indexTag) return false;
	return frontmatterTags(fm).includes(indexTag);
}

function checkOrphanedFiles(app: App, keys: JDKeys, indexTag?: string): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	const linkedPaths = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache?.links) {
			for (const link of cache.links) {
				const resolved = app.metadataCache.getFirstLinkpathDest(
					link.link,
					file.path
				);
				if (resolved) linkedPaths.add(resolved.path);
			}
		}
		if (cache?.embeds) {
			for (const embed of cache.embeds) {
				const resolved = app.metadataCache.getFirstLinkpathDest(
					embed.link,
					file.path
				);
				if (resolved) linkedPaths.add(resolved.path);
			}
		}
	}

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (!match) continue;

		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (isIndexFile(fm, keys, indexTag)) continue;

		if (!linkedPaths.has(file.path)) {
			issues.push({
				check: "orphaned-file",
				severity: "warning",
				path: file.path,
				message: `Not linked from any other note`,
				suggestion: `Add a link from the category index or a related note`,
			});
		}
	}

	return issues;
}

function checkBrokenWikilinks(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache?.links) continue;

		for (const link of cache.links) {
			const resolved = app.metadataCache.getFirstLinkpathDest(
				link.link,
				file.path
			);
			if (!resolved) {
				issues.push({
					check: "broken-wikilink",
					severity: "info",
					path: file.path,
					message: `Broken link: [[${link.link}]]`,
					suggestion: `Target does not exist`,
				});
			}
		}
	}

	return issues;
}

function checkEmptyNotes(app: App): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (!match) continue;

		const cache = app.metadataCache.getFileCache(file);
		if (!cache) continue;

		const sections = cache.sections ?? [];
		const nonFmSections = sections.filter((s) => s.type !== "yaml");
		const hasContent = nonFmSections.some(
			(s) => s.type !== "heading" && s.type !== "yaml"
		);

		if (!hasContent) {
			issues.push({
				check: "empty-note",
				severity: "info",
				path: file.path,
				message: `No content beyond frontmatter and heading`,
				suggestion: `Add a description or ## Contents section`,
			});
		}
	}

	return issues;
}

function checkStaleSurveyed(app: App, staleDays: number): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - staleDays);

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.surveyed) continue;

		const surveyed = new Date(String(fm.surveyed));
		if (isNaN(surveyed.getTime())) continue;

		if (surveyed < cutoff) {
			const daysAgo = Math.floor(
				(Date.now() - surveyed.getTime()) / (1000 * 60 * 60 * 24)
			);
			issues.push({
				check: "stale-surveyed",
				severity: "info",
				path: file.path,
				message: `Last surveyed ${daysAgo} days ago (${fm.surveyed})`,
				suggestion: `Review and update the surveyed date`,
			});
		}
	}

	return issues;
}

function checkTitleMismatch(app: App, keys: JDKeys): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (!match) continue;

		const filenameTitle = match[2];
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm?.[keys.title]) continue;

		const fmTitle = String(fm[keys.title]);
		if (fmTitle !== filenameTitle) {
			issues.push({
				check: "title-mismatch",
				severity: "warning",
				path: file.path,
				message: `${keys.title} "${fmTitle}" doesn't match filename "${filenameTitle}"`,
				suggestion: `Update ${keys.title} or rename the file`,
			});
		}
	}

	return issues;
}

function checkMissingStubs(app: App, jdex: JDex): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const allEntries = flatEntries(jdex);
	const existingIds = new Set<string>();

	for (const file of app.vault.getMarkdownFiles()) {
		const match = ID_RE.exec(file.basename);
		if (match) existingIds.add(match[1]);
	}

	for (const { entry, category, area } of allEntries) {
		if (existingIds.has(entry.id)) continue;
		issues.push({
			check: "missing-stub",
			severity: "warning",
			path: `${area.id} ${area.title}/${category.id} ${category.title}/`,
			message: `JDex entry ${entry.id} "${entry.title}" has no note`,
			suggestion: `Create stub: ${entry.id} ${entry.title}.md`,
		});
	}

	return issues;
}

// ── JDex YAML drift (vault → YAML) ────────────────────────────────

function checkUnregisteredIds(
	app: App,
	keys: JDKeys,
	jdex: JDex,
	config: JDConfig | null
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const knownIds = new Set(flatEntries(jdex).map((f) => f.entry.id));

	for (const file of app.vault.getMarkdownFiles()) {
		const match = file.basename.match(ID_RE);
		if (!match) continue;
		const id = match[1];

		if (id.includes(".") && id.endsWith(".00")) continue;
		if (knownIds.has(id)) continue;
		if (isExpandedAreaItem(config, id)) continue;

		issues.push({
			check: "unregistered-id",
			severity: "warning",
			path: file.path,
			message: `ID ${id} not present in JDex YAML`,
			suggestion: `Add via 'jd jdex adopt' or remove the note`,
		});
	}

	return issues;
}

function checkJdexTitleMismatch(app: App, jdex: JDex): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const titleById = new Map(
		flatEntries(jdex).map((f) => [f.entry.id, f.entry.title])
	);

	for (const file of app.vault.getMarkdownFiles()) {
		const match = file.basename.match(ID_RE);
		if (!match) continue;
		const id = match[1];
		const filenameTitle = match[2];
		const yamlTitle = titleById.get(id);
		if (!yamlTitle) continue;
		if (yamlTitle === filenameTitle) continue;

		issues.push({
			check: "jdex-title-mismatch",
			severity: "warning",
			path: file.path,
			message: `Filename title "${filenameTitle}" differs from JDex YAML "${yamlTitle}"`,
			suggestion: `Rename the file or update jd-index.yaml`,
		});
	}

	return issues;
}

function checkJdexCategoryMismatch(app: App, jdex: JDex): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	const root = app.vault.getRoot();
	for (const areaChild of root.children) {
		if (!(areaChild instanceof TFolder)) continue;
		if (!AREA_RE.test(areaChild.name)) continue;
		for (const catChild of areaChild.children) {
			if (!(catChild instanceof TFolder)) continue;
			const m = catChild.name.match(CATEGORY_RE);
			if (!m) continue;
			const catNum = m[1];
			const folderTitle = m[2];
			const yamlCat = findCategory(jdex, catNum);
			if (!yamlCat) continue;
			if (yamlCat.title === folderTitle) continue;
			issues.push({
				check: "jdex-category-mismatch",
				severity: "info",
				path: catChild.path,
				message: `Category folder "${folderTitle}" differs from JDex YAML "${yamlCat.title}"`,
				suggestion: `Rename the folder or update jd-index.yaml`,
			});
		}
	}

	return issues;
}

// ── Engine ───────────────────────────────────────────────────────

export interface ValidatorOptions {
	staleDays?: number;
	skipChecks?: string[];
	keys: JDKeys;
	jdConfig?: JDConfig | null;
	/**
	 * Tag form of `jd-type: index` (e.g. `jd/index`). When set, the orphan
	 * check exempts files carrying this tag in addition to those with
	 * `jd-type: index` frontmatter. Independent of the `typeAsTag` write-mode
	 * setting — pass this whenever the user uses `jd/`-prefixed tags at all.
	 */
	indexTag?: string;
	/**
	 * Prefix used for type tags (e.g. `jd/`). Files whose filename starts
	 * with a JD ID satisfy the type-marker check via *either* `<typeKey>`
	 * frontmatter or any tag starting with this prefix.
	 */
	typeTagPrefix?: string;
}

export function runValidation(
	app: App,
	jdex: JDex | null,
	options: ValidatorOptions
): ValidationReport {
	const {
		staleDays = 90,
		skipChecks = [],
		keys,
		jdConfig = null,
		indexTag,
		typeTagPrefix = "jd/",
	} = options;
	const skip = new Set(skipChecks);

	clearIgnoreCache();
	const allIssues: ValidationIssue[] = [];

	const checks: [string, () => ValidationIssue[]][] = [
		["required-fields", () => checkRequiredFields(app, keys, typeTagPrefix)],
		["date-format", () => checkDateFormats(app)],
		["valid-category", () => checkValidCategories(app, keys)],
		["duplicate-id", () => checkDuplicateIds(app, keys)],
		["orphaned-file", () => checkOrphanedFiles(app, keys, indexTag)],
		["broken-wikilink", () => checkBrokenWikilinks(app)],
		["empty-note", () => checkEmptyNotes(app)],
		["stale-surveyed", () => checkStaleSurveyed(app, staleDays)],
		["title-mismatch", () => checkTitleMismatch(app, keys)],
	];

	if (jdex) {
		checks.push(["missing-stub", () => checkMissingStubs(app, jdex)]);
		checks.push([
			"unregistered-id",
			() => checkUnregisteredIds(app, keys, jdex, jdConfig),
		]);
		checks.push(["jdex-title-mismatch", () => checkJdexTitleMismatch(app, jdex)]);
		checks.push([
			"jdex-category-mismatch",
			() => checkJdexCategoryMismatch(app, jdex),
		]);
	}

	for (const [name, fn] of checks) {
		if (skip.has(name)) continue;
		const raw = fn();
		// Filter out issues whose file opts out via the ignore frontmatter
		const filtered = raw.filter((issue) => {
			const file = app.vault.getAbstractFileByPath(issue.path);
			if (!(file instanceof TFile)) return true;
			return !isIgnored(app, file, keys, issue.check);
		});
		allIssues.push(...filtered);
	}

	const severityOrder: Record<Severity, number> = {
		error: 0,
		warning: 1,
		info: 2,
	};
	allIssues.sort(
		(a, b) => severityOrder[a.severity] - severityOrder[b.severity]
	);

	const summary: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
	for (const issue of allIssues) {
		summary[issue.severity]++;
	}

	return {
		timestamp: new Date().toISOString(),
		issues: allIssues,
		summary,
		filesScanned: app.vault.getMarkdownFiles().length,
	};
}
