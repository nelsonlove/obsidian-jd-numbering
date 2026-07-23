/**
 * Core Johnny Decimal model + parser.
 *
 * Knows the ID shapes used in this vault (see 00.98 System reference):
 *   - area          XX-YY            e.g. 00-09, 90-99   (hyphen, not en-dash)
 *   - category      XX               e.g. 06, 72
 *   - id            XX.YY            e.g. 06.11
 *   - expanded-item NNNNN            e.g. 92021 (expanded area) or 27001 (expanded category)
 *   - fractal-id    NNNNN.YY         e.g. 92021.10 (inside an expanded area)
 *
 * Everything else (e.g. "26 2.18") is malformed and should be flagged by the linter.
 */

export interface JdConfig {
	/** Areas whose whole band uses 5-digit sequential IDs, e.g. ["90-99"]. */
	expandedAreas: string[];
	/** Single categories that use 5-digit flat IDs, e.g. ["27"]. */
	expandedCategories: string[];
}

export const DEFAULT_CONFIG: JdConfig = {
	expandedAreas: ["90-99"],
	expandedCategories: ["27"],
};

export type JdKind = "area" | "category" | "id" | "expanded-item" | "fractal-id";

export interface ParsedId {
	raw: string;
	kind: JdKind;
	/** Area band, e.g. "00-09". */
	area: string;
	/** Category code, e.g. "06" (empty for a bare area). */
	category: string;
}

/** The area band (e.g. "90-99") that a 2-digit category (e.g. "92") belongs to. */
export function areaOfCategory(cat: string): string {
	const d = cat[0];
	return `${d}0-${d}9`;
}

const RE_AREA = /^([0-9])0-([0-9])9$/; // 00-09, 10-19, ... 90-99 (digits must match)
const RE_CATEGORY = /^[0-9]{2}$/;
const RE_ID = /^([0-9]{2})\.([0-9]{2})$/;
const RE_FRACTAL = /^([0-9]{5})\.([0-9]{2})$/;
const RE_FIVE = /^([0-9]{5})$/;

/**
 * Parse a raw jd-id string. Returns null when the string is not a valid JD
 * identifier under the given config (i.e. it is malformed / not a JD id).
 */
export function parseJdId(raw: string, cfg: JdConfig): ParsedId | null {
	const s = raw.trim();

	const am = s.match(RE_AREA);
	if (am && am[1] === am[2]) {
		return { raw: s, kind: "area", area: s, category: "" };
	}
	if (RE_CATEGORY.test(s)) {
		return { raw: s, kind: "category", area: areaOfCategory(s), category: s };
	}
	let m = s.match(RE_ID);
	if (m) {
		return { raw: s, kind: "id", area: areaOfCategory(m[1]), category: m[1] };
	}
	m = s.match(RE_FRACTAL);
	if (m) {
		const cat = m[1].slice(0, 2);
		if (cfg.expandedAreas.includes(areaOfCategory(cat))) {
			return { raw: s, kind: "fractal-id", area: areaOfCategory(cat), category: cat };
		}
		return null;
	}
	m = s.match(RE_FIVE);
	if (m) {
		const cat = s.slice(0, 2);
		if (
			cfg.expandedAreas.includes(areaOfCategory(cat)) ||
			cfg.expandedCategories.includes(cat)
		) {
			return { raw: s, kind: "expanded-item", area: areaOfCategory(cat), category: cat };
		}
		return null;
	}
	return null;
}

/** True when the category uses 5-digit IDs (expanded area or expanded category). */
export function isExpandedCategory(cat: string, cfg: JdConfig): boolean {
	return (
		cfg.expandedCategories.includes(cat) ||
		cfg.expandedAreas.includes(areaOfCategory(cat))
	);
}

/**
 * The canonical JD id of a folder note, derived from its filename id-token.
 * Folder notes have a deliberate asymmetry between the name token and the id:
 *   - area folder note      "A0-A9 Title"  -> id "A0-A9"     (e.g. 00-09)
 *   - category folder note  "AC Title"     -> id "AC.00"     (standard-zero home)
 * Returns null when the token is not an area/category id (i.e. not a folder-note
 * shape — e.g. an "AC.YY" content id or a 5-digit expanded item).
 */
export function canonicalFolderNoteId(nameToken: string, cfg: JdConfig): string | null {
	const p = parseJdId(nameToken, cfg);
	if (!p) return null;
	if (p.kind === "area") return p.raw; // 00-09 -> 00-09
	if (p.kind === "category") return `${p.raw}.00`; // 04 -> 04.00
	return null;
}

/** Standard-zero slots .00–.09 are reserved for infrastructure, not content. */
export function isStandardZero(id: ParsedId): boolean {
	if (id.kind !== "id") return false;
	const dec = parseInt(id.raw.split(".")[1], 10);
	return dec <= 9;
}

/**
 * Strip an Extend-the-End suffix (e.g. "43.11+2024 Foo" -> "43.11") and a
 * trailing title, returning just the leading id token of a filename.
 * Returns the raw token (still needs parseJdId to validate).
 */
export function idTokenFromName(name: string): string {
	// Filenames are "<jd-id> <title>". The id token is everything up to the
	// first space, minus any +EtE suffix.
	const token = name.split(" ")[0];
	const plus = token.indexOf("+");
	return plus === -1 ? token : token.slice(0, plus);
}

/**
 * Given a set of used decimal parts in a normal category, return the next free
 * two-digit content decimal (".10".."".99"), or null if the category is full.
 * Content IDs start at .10 — .00–.09 are the reserved standard zeros.
 */
export function nextContentDecimal(used: Set<number>): string | null {
	for (let n = 10; n <= 99; n++) {
		if (!used.has(n)) return String(n).padStart(2, "0");
	}
	return null;
}
