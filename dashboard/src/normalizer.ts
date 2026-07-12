/**
 * Frontmatter normalizer — auto-corrects JD note frontmatter on save.
 *
 * Runs on vault "modify" events for JD notes. Each behavior is independently
 * toggleable in settings; the key names (titleKey/idKey/typeKey) come from
 * settings via getKeys().
 *
 * Behaviors (gated by toggles):
 *   - normalizeInferType (does double duty):
 *       (a) fill in jd-id from filename when missing — required for any
 *           later inference to fire, since steps 1-2 below need the value
 *       (b) add inferred type when missing (writes a tag when typeAsTag
 *           is on; skipped when value is `id` and writeTypeForGenericIds
 *           is off)
 *   - normalizeQuoteId: wrap unquoted IDs in single quotes
 *   - normalizeSortKeys: reorder frontmatter keys into canonical order
 *   - normalizeStripHeadingId: rewrite `# XX.YY Title` as `# Title`
 *
 * Uses a write guard to prevent re-triggering from its own modifications.
 */

import { type App, TFile } from "obsidian";
import type { JDSettings } from "./settings";
import { getKeys, shouldWriteType, typeTagFor } from "./keys";

function buildKeyOrder(settings: JDSettings): Record<string, number> {
	const k = getKeys(settings);
	return {
		[k.title]: 0,
		[k.id]: 1,
		[k.type]: 2,
		"jd-location": 3,
		created: 4,
		modified: 5,
		surveyed: 6,
		aliases: 7,
		tags: 8,
	};
}

// ── Type inference ───────────────────────────────────────────────

const ZERO_TYPES: Record<string, string> = {
	"00": "index",
	"01": "inbox",
	"02": "tasks",
	"03": "templates",
	"04": "links",
	"05": "policies",
	"06": "knowledge-base",
	"07": "dashboard",
	"08": "someday",
	"09": "archive",
};

/**
 * Default `+SUFFIX → type` map. Used by `inferType` when no per-call
 * override is supplied. Lifted to settings (`subidTypes`) so users can
 * add their own suffixes from the GUI; this constant is the seed value
 * and the fallback for code paths that don't yet thread settings.
 */
export const DEFAULT_SUBID_TYPES: Record<string, string> = {
	"+REPORT": "report",
	"+AUDIT": "audit",
};

/**
 * True when the head of an ID is 5 digits (an expanded-area item or its
 * sub-ID — e.g. `92004` or `92004.11`).
 */
function isExpandedFormat(jdId: string): boolean {
	const head = jdId.includes(".") ? jdId.slice(0, jdId.indexOf(".")) : jdId;
	return /^\d{5}$/.test(head);
}

export function inferType(
	jdId: string,
	options: { inferForExpanded?: boolean; subidTypes?: Record<string, string> } = {}
): string | null {
	const subidTypes = options.subidTypes ?? DEFAULT_SUBID_TYPES;
	// Split on '+' to get the suffix tokens of the ID (e.g. `06.13+REPORT+v2`
	// → `["06.13", "REPORT", "v2"]`, suffix tokens being everything after
	// index 0, re-prefixed). Whole-token comparison so a user-configured
	// `+RE` doesn't silently swallow `+REPORT`.
	const idTokens = jdId.toUpperCase().split("+").slice(1).map((t) => "+" + t);
	for (const [suffix, type] of Object.entries(subidTypes)) {
		if (idTokens.includes(suffix.toUpperCase())) return type;
	}
	if (jdId.includes("+")) return "meta";

	// Expanded-area items cover disparate kinds; defer to user unless opted in.
	if (isExpandedFormat(jdId) && !options.inferForExpanded) return null;

	const parts = jdId.split(".");
	if (parts.length === 2) return ZERO_TYPES[parts[1]] ?? "id";
	if (parts.length === 1 && /^\d{5}$/.test(jdId)) return "id";
	return null;
}

// ── Frontmatter parsing ─────────────────────────────────────────

interface FmEntry {
	key: string;
	text: string;
}

function parseFrontmatter(fmText: string): FmEntry[] {
	const entries: FmEntry[] = [];
	const lines = fmText.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			i++;
			continue;
		}

		const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)/);
		if (m) {
			const key = m[1];
			const fullLines = [line];
			i++;
			while (i < lines.length) {
				const next = lines[i];
				if (next && (next[0] === " " || next[0] === "\t")) {
					fullLines.push(next);
					i++;
				} else {
					break;
				}
			}
			entries.push({ key, text: fullLines.join("\n") });
		} else {
			i++;
		}
	}

	return entries;
}

function sortEntries(
	entries: FmEntry[],
	order: Record<string, number>
): FmEntry[] {
	return [...entries].sort((a, b) => {
		const aOrd = order[a.key] ?? 100;
		const bOrd = order[b.key] ?? 100;
		if (aOrd !== bOrd) return aOrd - bOrd;
		return a.key.localeCompare(b.key);
	});
}

// ── Tag handling ────────────────────────────────────────────────

/**
 * Insert a tag into an existing `tags:` entry, or create one. Mutates the
 * entries array. Returns true if a change was made, false if the tag was
 * already present.
 */
function ensureTag(entries: FmEntry[], tag: string): boolean {
	const tagsEntry = entries.find((e) => e.key === "tags");
	if (!tagsEntry) {
		entries.push({ key: "tags", text: `tags:\n    - ${tag}` });
		return true;
	}

	const lines = tagsEntry.text.split("\n");
	for (const line of lines) {
		const m = line.match(/^\s*-\s*(.+?)\s*$/);
		if (m && m[1] === tag) return false;
	}

	const inlineList = tagsEntry.text.match(/^tags:\s*\[(.*)\]\s*$/);
	if (inlineList) {
		const existing = inlineList[1]
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (existing.includes(tag)) return false;
		const all = [...existing, tag];
		tagsEntry.text = `tags:\n${all.map((t) => `    - ${t}`).join("\n")}`;
		return true;
	}

	const inlineSingle = tagsEntry.text.match(/^tags:\s*([^\s\[].+?)\s*$/);
	if (inlineSingle) {
		const existing = inlineSingle[1].trim();
		if (existing === tag) return false;
		tagsEntry.text = `tags:\n    - ${existing}\n    - ${tag}`;
		return true;
	}

	tagsEntry.text = `${tagsEntry.text}\n    - ${tag}`;
	return true;
}

// ── Normalizer ──────────────────────────────────────────────────

const ID_RE = /^(\d{2}\.\d{2}|\d{5})\s+(.+)$/;
const HEADING_ID_RE = /^# (?:\d{2}\.\d{2}\+?|\d{5})\s+(.+)$/m;

export class FrontmatterNormalizer {
	private app: App;
	private settings: JDSettings;
	private writeGuard = new Set<string>();

	constructor(app: App, settings: JDSettings) {
		this.app = app;
		this.settings = settings;
	}

	/** Refresh the cached settings reference (call after settings change). */
	updateSettings(settings: JDSettings): void {
		this.settings = settings;
	}

	isGuarded(path: string): boolean {
		return this.writeGuard.has(path);
	}

	async normalize(file: TFile): Promise<boolean> {
		if (!this.settings.normalizeEnabled) return false;

		const match = ID_RE.exec(file.basename);
		if (!match) return false;

		const content = await this.app.vault.read(file);
		if (!content.startsWith("---\n")) return false;

		const firstClose = content.indexOf("\n---\n", 4);
		if (firstClose === -1) return false;

		const fmText = content.slice(4, firstClose + 1);
		const body = content.slice(firstClose + 5);

		const keys = getKeys(this.settings);
		let entries = parseFrontmatter(fmText);
		let changed = false;

		// 0. Fill in jd-id from filename if missing. Without this, downstream
		//    type inference can't run on freshly-created notes — and the
		//    matching tag (e.g. jd/inbox for XX.01) never gets added.
		const fnId = match[1];
		let idEntry = entries.find((e) => e.key === keys.id);
		if (this.settings.normalizeInferType && !idEntry) {
			idEntry = { key: keys.id, text: `${keys.id}: '${fnId}'` };
			entries.push(idEntry);
			changed = true;
		}

		// 1. Quote ID if unquoted
		if (this.settings.normalizeQuoteId && idEntry) {
			const m = idEntry.text.match(/^[a-zA-Z][\w-]*:\s*(\S+)$/);
			if (m && !m[1].startsWith("'") && !m[1].startsWith('"')) {
				idEntry.text = `${keys.id}: '${m[1]}'`;
				changed = true;
			}
		}

		// 2. Infer type if missing
		if (this.settings.normalizeInferType && idEntry) {
			const valMatch = idEntry.text.match(/^[a-zA-Z][\w-]*:\s*(.*)$/);
			const idVal = (valMatch ? valMatch[1] : "")
				.replace(/['"]/g, "")
				.trim();
			const inferred = inferType(idVal, {
				inferForExpanded: this.settings.inferTypeForExpandedIds,
				subidTypes: this.settings.subidTypes,
			});

			if (inferred && shouldWriteType(this.settings, inferred)) {
				if (this.settings.typeAsTag) {
					const tag = typeTagFor(this.settings, inferred);
					if (ensureTag(entries, tag)) changed = true;
				} else if (!entries.find((e) => e.key === keys.type)) {
					entries.push({
						key: keys.type,
						text: `${keys.type}: ${inferred}`,
					});
					changed = true;
				}
			}
		}

		// 3. Sort keys
		if (this.settings.normalizeSortKeys) {
			const order = buildKeyOrder(this.settings);
			const sorted = sortEntries(entries, order);
			const keysChanged =
				sorted.map((e) => e.key).join(",") !==
				entries.map((e) => e.key).join(",");
			if (keysChanged) {
				entries = sorted;
				changed = true;
			}
		}

		// 4. Strip ID from H1 heading
		let newBody = body;
		if (this.settings.normalizeStripHeadingId) {
			const headingMatch = HEADING_ID_RE.exec(body);
			if (headingMatch) {
				newBody = body.replace(HEADING_ID_RE, `# ${headingMatch[1]}`);
				if (newBody !== body) changed = true;
			}
		}

		if (!changed) return false;

		const newFm = entries.map((e) => e.text).join("\n") + "\n";
		const newContent = `---\n${newFm}---\n${newBody}`;

		this.writeGuard.add(file.path);
		await this.app.vault.modify(file, newContent);

		setTimeout(() => {
			this.writeGuard.delete(file.path);
		}, 1000);

		return true;
	}
}
