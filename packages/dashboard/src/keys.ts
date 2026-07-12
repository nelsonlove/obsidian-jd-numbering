/**
 * Frontmatter key helpers — central source of truth for which keys are used.
 *
 * Users can rename `jd-id` / `jd-title` / `jd-type` in settings, or store the
 * type as a tag (`jd/inbox`) instead of a frontmatter key. All consumers go
 * through these helpers so there's only one place to change conventions.
 */

import type { JDSettings } from "./settings";

export interface JDKeys {
	title: string;
	id: string;
	type: string;
	ignore: string;
}

export function getKeys(settings: JDSettings): JDKeys {
	return {
		title: settings.titleKey || "jd-title",
		id: settings.idKey || "jd-id",
		type: settings.typeKey || "jd-type",
		ignore: settings.ignoreKey || "jd-ignore",
	};
}

/**
 * Parse a `jd-ignore` frontmatter value into a normalized form.
 * - boolean true / string "true"|"all" → ["*"] (silence all)
 * - string of comma-separated check names → array
 * - array of strings → as-is
 * - falsy → []
 */
export function parseIgnoreField(value: unknown): string[] {
	if (value === true) return ["*"];
	if (!value) return [];
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
	const s = String(value).trim();
	if (!s) return [];
	if (s === "true" || s === "all" || s === "*") return ["*"];
	return s.split(",").map((v) => v.trim()).filter(Boolean);
}

/** True when `checkName` is silenced by an ignore list. */
export function isCheckIgnored(ignores: string[], checkName: string): boolean {
	return ignores.includes("*") || ignores.includes(checkName);
}

/**
 * Extract the category number from any JD ID form.
 *
 *   "06.12"        → "06"
 *   "92001"        → "92"   (5-digit project items)
 *   "06.12+README" → "06"
 *   "00-09"        → "00"   (area)
 */
export function categoryOf(id: string): string {
	if (id.includes(".")) return id.split(".")[0];
	if (id.includes("-")) return id.split("-")[0];
	return id.slice(0, 2);
}

/** Tag string for a given type value, honoring per-type override map. */
export function typeTagFor(settings: JDSettings, typeValue: string): string {
	const override = settings.typeTagMap?.[typeValue];
	if (override) return override;
	const prefix = settings.typeTagPrefix ?? "jd/";
	return `${prefix}${typeValue}`;
}

/**
 * Whether the type value should be persisted at all. Returns false for the
 * generic catch-all `id` when `writeTypeForGenericIds` is disabled.
 */
export function shouldWriteType(
	settings: JDSettings,
	typeValue: string
): boolean {
	if (typeValue === "id" && !settings.writeTypeForGenericIds) return false;
	return true;
}

/**
 * Format the type as one or more frontmatter lines.
 *
 * - tag mode: emits `tags:` block with the chosen tag (if not empty)
 * - key mode: emits `<typeKey>: <value>`
 *
 * Returns [] when shouldWriteType() is false. Used by report-generation
 * helpers that build YAML frontmatter line-by-line.
 */
export function formatTypeFrontmatter(
	settings: JDSettings,
	typeValue: string
): string[] {
	if (!shouldWriteType(settings, typeValue)) return [];
	const keys = getKeys(settings);
	if (settings.typeAsTag) {
		const tag = typeTagFor(settings, typeValue);
		return ["tags:", `    - ${tag}`];
	}
	return [`${keys.type}: ${typeValue}`];
}
