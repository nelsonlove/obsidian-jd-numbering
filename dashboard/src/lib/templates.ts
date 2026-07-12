/**
 * Template-driven note creation. Reads templates from a configurable folder,
 * substitutes placeholders, creates the new note at the right JD location.
 *
 * Supported placeholder dialects (both treated identically):
 *   {{var}}        Templater / Core Templates style (preferred)
 *   %var%          Legacy QuickAdd-ish style
 *
 * Plus formatted dates / times via moment.js tokens:
 *   {{date:YYYY-MM-DD}}
 *   {{time:HH:mm}}
 *
 * Templates are classified by their `jd-id` frontmatter field:
 *   "{{category}}.NN"        → standard zero, slot NN (NN ∈ ZeroId)
 *   "XX.00+CODE"             → stem template, code CODE (\\w+)
 *   "{{category}}.{{id}}"    → generic ID template
 */

import { type App, TFile, TFolder, moment } from "obsidian";
import type { Moment } from "moment";
import type { ZeroId, ZeroSpec } from "./standard-zeros";

// Set of valid ZeroId values, used to validate template classification.
// Typed as `ReadonlySet<ZeroId>` so the literal members are cross-checked
// against the union at construction — a typo like "10" would fail to compile.
const ZERO_IDS: ReadonlySet<ZeroId> = new Set<ZeroId>([
	"00", "01", "02", "03", "04", "05", "06", "07", "08", "09",
]);

/** Type guard: is this string a valid `ZeroId`? */
function isZeroId(s: string): s is ZeroId {
	return (ZERO_IDS as ReadonlySet<string>).has(s);
}

// ── Scope ────────────────────────────────────────────────────────

/**
 * Scope phrase for a category prefix:
 *   "00"             → "the system"
 *   "x0"  (x > 0)    → "area x0-x9"
 *   "xy"  (y > 0)    → "category xy"
 */
export function scopeFor(prefix: string): string {
	if (prefix === "00") return "the system";
	if (/^[1-9]0$/.test(prefix)) {
		const head = prefix[0];
		return `area ${head}0-${head}9`;
	}
	return `category ${prefix}`;
}

// ── Placeholder context ──────────────────────────────────────────

export interface PlaceholderContext {
	prefix: string;
	id: string;
	fullId: string;
	scope: string;
	folder: string;
	folderName: string;
	title: string;
	tag: string;
	date: string;
	time: string;
	now: string;
}

export interface BuildContextOpts {
	prefix: string;
	id: string;
	folder: { path: string; name: string };
	zero?: ZeroSpec;
	customTitle?: string;
	customTag?: string;
	now?: Moment;
}

export function buildContext(opts: BuildContextOpts): PlaceholderContext {
	const now = opts.now ?? moment();
	const isStem = opts.id.startsWith("+");
	const fullId = isStem ? `${opts.prefix}.00${opts.id}` : `${opts.prefix}.${opts.id}`;
	return {
		prefix: opts.prefix,
		id: opts.id,
		fullId,
		scope: scopeFor(opts.prefix),
		folder: opts.folder.path,
		folderName: opts.folder.name,
		title: opts.customTitle ?? opts.zero?.name ?? "",
		tag: opts.customTag ?? opts.zero?.tag ?? "",
		date: now.format("YYYY-MM-DD"),
		time: now.format("HH:mm"),
		now: now.format("YYYY-MM-DDTHH:mm"),
	};
}

// ── Substitution ─────────────────────────────────────────────────

function valueFor(ctx: PlaceholderContext, key: string): string | null {
	switch (key) {
		// `category` is an alias for `prefix` — the canonical field is `prefix`,
		// but JD-canon-style templates ask for `{{category}}`.
		case "category":
		case "prefix": return ctx.prefix;
		case "id": return ctx.id;
		case "full-id":
		case "fullId": return ctx.fullId;
		case "scope": return ctx.scope;
		case "folder": return ctx.folder;
		case "folder-name":
		case "folderName": return ctx.folderName;
		case "title": return ctx.title;
		case "tag": return ctx.tag;
		case "date": return ctx.date;
		case "time": return ctx.time;
		case "now": return ctx.now;
		default: return null;
	}
}

// Static patterns — no dynamic RegExp construction.
const PLACEHOLDER_BRACE = /\{\{([a-zA-Z][a-zA-Z-]*)\}\}/g;
const PLACEHOLDER_PERCENT = /%([a-zA-Z][a-zA-Z-]*)%/g;
const FORMAT_DATE_BRACE = /\{\{(date|time):([^}]+)\}\}/g;
const FORMAT_DATE_PERCENT = /%(date|time):([^%]+)%/g;

/**
 * Substitute placeholders in template content. Both {{var}} and %var% are
 * accepted. Formatted dates use {{date:FORMAT}} (FORMAT is a moment.js token
 * string, e.g. "YYYY-MM-DD"). Unknown placeholders are left as-is and
 * `console.warn`'d so users can spot typos in their templates.
 */
export function substitute(content: string, ctx: PlaceholderContext): string {
	let out = content;
	const unknown = new Set<string>();

	// Formatted date/time first so {{date:FORMAT}} doesn't match the plain {{date}} rule.
	out = out.replace(FORMAT_DATE_BRACE, (_m, _kind, fmt) => moment().format(fmt));
	out = out.replace(FORMAT_DATE_PERCENT, (_m, _kind, fmt) => moment().format(fmt));

	out = out.replace(PLACEHOLDER_BRACE, (m, key) => {
		const v = valueFor(ctx, key);
		if (v === null) { unknown.add(key); return m; }
		return v;
	});
	out = out.replace(PLACEHOLDER_PERCENT, (m, key) => {
		const v = valueFor(ctx, key);
		if (v === null) { unknown.add(key); return m; }
		return v;
	});

	if (unknown.size > 0) {
		console.warn("[jd] template substitute: unknown placeholders left as-is:", [...unknown]);
	}

	return out;
}

// ── Template discovery ───────────────────────────────────────────

export type TemplateRole =
	| { type: "zero"; zeroId: ZeroId }
	| { type: "stem"; stemCode: string }
	| { type: "generic" };

export interface TemplateMatch {
	file: TFile;
	role: TemplateRole;
}

const ZERO_ID_RE = /^\{\{category\}\}\.(\d{2})$/;
// Stem codes: leading letter, then word chars or hyphens. Broader than
// folder-notes' `\w+` to accommodate hyphenated codes that exist in some
// user notes; the leading-letter requirement avoids `+1`-style anomalies.
const STEM_ID_RE = /^XX\.00\+([A-Za-z][\w-]*)$/;
const GENERIC_ID_RE = /^\{\{category\}\}\.\{\{id\}\}$/;

function classify(jdId: string | null): TemplateRole | null {
	if (!jdId) return null;
	const zero = jdId.match(ZERO_ID_RE);
	if (zero) {
		const id = zero[1];
		if (!isZeroId(id)) return null; // .10+ aren't valid zeros (.07 is now a zero — see standard-zeros.ts)
		return { type: "zero", zeroId: id };
	}
	const stem = jdId.match(STEM_ID_RE);
	if (stem) return { type: "stem", stemCode: stem[1] };
	if (GENERIC_ID_RE.test(jdId)) return { type: "generic" };
	return null;
}

export async function listTemplates(app: App, folderPath: string): Promise<TemplateMatch[]> {
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!folder) {
		throw new Error(`Templates folder not found: '${folderPath}'. Check plugin settings → Paths → Templates folder.`);
	}
	if (!(folder instanceof TFolder)) {
		throw new Error(`Templates path is not a folder: '${folderPath}'`);
	}

	const out: TemplateMatch[] = [];
	const skipped: string[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== "md") continue;
		// Prefer the parsed frontmatter from metadataCache — it handles both
		// single- and double-quoted strings, multi-line values, and won't
		// match a literal `jd-id:` line in the body. But the cache may not
		// have indexed a brand-new template yet, so fall back to a content
		// read + simple regex parse so unindexed files don't silently drop.
		const cache = app.metadataCache.getFileCache(child);
		let jdId: string | null = null;
		if (cache) {
			const v = cache.frontmatter?.["jd-id"];
			if (typeof v === "string") jdId = v;
		} else {
			try {
				jdId = parseJdIdFromContent(await app.vault.cachedRead(child));
			} catch {
				skipped.push(`${child.basename} (read failed)`);
				continue;
			}
		}
		const role = classify(jdId);
		if (role) {
			out.push({ file: child, role });
		} else if (jdId !== null) {
			skipped.push(`${child.basename} (jd-id="${jdId}")`);
		}
	}
	if (skipped.length > 0) {
		console.warn("[jd] templates: ignored files with unrecognized jd-id:", skipped);
	}
	return out;
}

/**
 * Last-resort frontmatter `jd-id` extraction for files that haven't been
 * indexed by the metadataCache yet. Strips both single- and double-quote
 * wrapping. Does not handle multi-line values; templates don't use them.
 */
function parseJdIdFromContent(content: string): string | null {
	const m = content.match(/^jd-id:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
	return m ? m[1].trim() : null;
}

export function findZeroTemplate(templates: TemplateMatch[], zeroId: ZeroId): TemplateMatch | null {
	return templates.find((t) => t.role.type === "zero" && t.role.zeroId === zeroId) ?? null;
}

export function findStemTemplate(templates: TemplateMatch[], stemCode: string): TemplateMatch | null {
	return templates.find((t) => t.role.type === "stem" && t.role.stemCode === stemCode) ?? null;
}

export function findGenericTemplate(templates: TemplateMatch[]): TemplateMatch | null {
	return templates.find((t) => t.role.type === "generic") ?? null;
}

export function listStemCodes(templates: TemplateMatch[]): string[] {
	type StemMatch = TemplateMatch & { role: Extract<TemplateRole, { type: "stem" }> };
	return templates
		.filter((t): t is StemMatch => t.role.type === "stem")
		.map((t) => t.role.stemCode)
		.sort();
}

// ── Filename sanitization ────────────────────────────────────────

/**
 * Reject titles that would write outside the intended folder or produce
 * Obsidian/OS-incompatible filenames. Returns the trimmed title on success
 * or null on rejection (caller surfaces the user-visible Notice).
 *
 * Rejection rules:
 *   - empty / whitespace-only
 *   - any leading dot (would create a hidden file Obsidian doesn't index)
 *   - any `..` substring (path-traversal risk)
 *   - path separators (`/`, `\`)
 *   - Windows-forbidden characters: `:` `|` `?` `*` `<` `>` `"`
 *   - control bytes (U+0000–U+001F)
 *
 * NOT rejected (intentional):
 *   - non-leading dots in longer names (e.g. "foo.v2", "a.b.c")
 *   - trailing whitespace or dots (Windows would silently truncate; macOS
 *     and Linux accept them. Add a check here if/when you target Windows.)
 */
export function sanitizeTitle(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith(".")) return null;
	if (trimmed.includes("..")) return null;
	// eslint-disable-next-line no-control-regex
	if (/[/\\:|?*<>"\x00-\x1f]/.test(trimmed)) return null;
	return trimmed;
}

// ── Creation ─────────────────────────────────────────────────────

export async function createFromTemplate(
	app: App,
	template: TemplateMatch,
	ctx: PlaceholderContext,
	destPath: string
): Promise<TFile> {
	// vault.read (not cachedRead) so a user iterating on a template sees their
	// latest edits when creating from it. cachedRead is a separate per-file
	// content cache (distinct from metadataCache); it can lag behind disk
	// after a recent vault.modify.
	const content = await app.vault.read(template.file);
	const substituted = substitute(content, ctx);

	const parentPath = destPath.substring(0, destPath.lastIndexOf("/"));
	if (parentPath) {
		const parent = app.vault.getAbstractFileByPath(parentPath);
		if (!parent) {
			await app.vault.createFolder(parentPath);
		} else if (!(parent instanceof TFolder)) {
			throw new Error(`Path exists but is not a folder: ${parentPath}`);
		}
	}

	if (app.vault.getAbstractFileByPath(destPath)) {
		throw new Error(`File already exists: ${destPath}`);
	}

	return app.vault.create(destPath, substituted);
}

// ── Destination paths ────────────────────────────────────────────

export function destPathForZero(
	folder: { path: string },
	prefix: string,
	zero: ZeroSpec
): string {
	const basename = `${prefix}.${zero.id} ${zero.name}`;
	return zero.hasDir ? `${folder.path}/${basename}/${basename}.md` : `${folder.path}/${basename}.md`;
}

export function destPathForStem(
	folder: { path: string },
	prefix: string,
	code: string,
	name: string
): string {
	return `${folder.path}/${prefix}.00+${code} ${name}.md`;
}

export function destPathForGenericId(
	folder: { path: string },
	prefix: string,
	id: string,
	title: string
): string {
	return `${folder.path}/${prefix}.${id} ${title}.md`;
}
