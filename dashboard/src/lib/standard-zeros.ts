/**
 * Standard-zeros (`XX.00`–`XX.09`) generation for JD categories.
 *
 * The full set is fixed: `00, 01, 02, 03, 04, 05, 06, 07, 08, 09`. `.07`
 * is the local-extension `Dashboard for [scope]` slot (single note per
 * category, jd/dashboard tag) — see vault `00.05` for the convention.
 * The literal type `ZeroId` documents and enforces this.
 */

import type { App, TFolder } from "obsidian";
import { TFolder as TFolderClass } from "obsidian";

export type ZeroId = "00" | "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09";

export interface ZeroSpec {
	id: ZeroId;
	name: string;
	tag: `jd/${string}`;
	hasDir: boolean;
}

export function suffixFor(prefix: string): string {
	return prefix === "00" ? "for the system" : `for category ${prefix}`;
}

export function standardZeros(prefix: string, suffix: string): ZeroSpec[] {
	return [
		{ id: "00", name: `JDex ${suffix}`, tag: "jd/index", hasDir: false },
		{ id: "01", name: `Inbox ${suffix}`, tag: "jd/inbox", hasDir: true },
		{ id: "02", name: `Task & project management ${suffix}`, tag: "jd/tasks", hasDir: false },
		{ id: "03", name: `Templates ${suffix}`, tag: "jd/templates", hasDir: true },
		{ id: "04", name: `Links ${suffix}`, tag: "jd/links", hasDir: false },
		{ id: "05", name: `Conventions & policies ${suffix}`, tag: "jd/policies", hasDir: false },
		{ id: "06", name: `Knowledge base ${suffix}`, tag: "jd/knowledge-base", hasDir: true },
		{ id: "07", name: `Dashboard ${suffix}`, tag: "jd/dashboard", hasDir: false },
		{ id: "08", name: `Someday ${suffix}`, tag: "jd/someday", hasDir: false },
		{ id: "09", name: `Archive ${suffix}`, tag: "jd/archive", hasDir: true },
	];
}

export function buildZeroFrontmatter(zero: ZeroSpec, prefix: string, folderName: string, now: string): string {
	const aliases =
		zero.id === "00"
			? `  - ${zero.name}\n  - ${folderName}`
			: `  - ${zero.name}`;

	return `---
title: ${zero.name}
jd-id: "${prefix}.${zero.id}"
created: ${now}
modified: ${now}
tags:
  - ${zero.tag}
aliases:
${aliases}
linter-yaml-title-alias: ${zero.name}
---

# ${zero.name}

`;
}

/**
 * Folder may not exist yet — pass an object with at least `path` and `name`.
 * Vault will create folders implicitly when the first file is written.
 */
export interface FolderLike {
	path: string;
	name: string;
}

export interface CreateZerosResult {
	created: number;
	skipped: number;
	failures: { name: string; error: string }[];
}

export async function createStandardZeros(
	app: App,
	folder: FolderLike,
	prefix: string,
	now: string
): Promise<CreateZerosResult> {
	const suffix = suffixFor(prefix);
	const zeros = standardZeros(prefix, suffix);
	const result: CreateZerosResult = { created: 0, skipped: 0, failures: [] };

	for (const zero of zeros) {
		const basename = `${prefix}.${zero.id} ${zero.name}`;
		const filepath = zero.hasDir
			? `${folder.path}/${basename}/${basename}.md`
			: `${folder.path}/${basename}.md`;

		if (app.vault.getAbstractFileByPath(filepath)) {
			result.skipped++;
			continue;
		}

		try {
			await app.vault.create(filepath, buildZeroFrontmatter(zero, prefix, folder.name, now));
			result.created++;
		} catch (e) {
			result.failures.push({ name: basename, error: (e as Error).message });
			console.warn("[jd] createStandardZeros failed", filepath, e);
		}
	}

	return result;
}

/**
 * Categories: folders at depth 2 (inside an area at depth 1) named `XX <name>`.
 * Analogous to `JD_FOLDER_NEEDS_NOTE` in folder-notes.ts but for the category
 * level rather than leaf-IDs.
 */
const JD_CATEGORY_FOLDER = /^(\d{2})\s+(.+)$/;

/** Depth at which JD category folders live (area / category). */
const CATEGORY_DEPTH = 2;

export interface EnsureCategoryIndexesResult {
	created: number;
	failures: { path: string; error: string }[];
}

/**
 * Walk the vault for JD category folders (`XX <name>` at depth 2) that lack
 * their `XX.00` JDex index file, and create a minimal one for each.
 *
 * Without an `XX.00` file the vault indexer cannot recognize the category at
 * all — it relies on `XX.00` files to enumerate categories, so a category
 * folder without one is invisible and its sub-IDs never make it into the
 * system JDex. This makes the indexer self-healing in the same spirit as
 * `ensureFolderNotes`.
 *
 * Only the JDex zero (`XX.00`) is created; full standard-zeros scaffolding
 * remains an explicit user action via `JD standard zeros`. Existing index
 * files are accepted in any of `XX.00 Title.md`, `XX.00.md`, or
 * `XX.00+SUF Title.md` form so a deliberately renamed JDex isn't clobbered.
 */
export async function ensureCategoryIndexes(app: App, now: string): Promise<EnsureCategoryIndexesResult> {
	const allFolders = app.vault
		.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolderClass);

	const result: EnsureCategoryIndexesResult = { created: 0, failures: [] };

	for (const folder of allFolders) {
		const m = folder.name.match(JD_CATEGORY_FOLDER);
		if (!m) continue;
		// Categories live at depth 2 (inside a JD area at depth 1). Without
		// this guard, any deeper folder matching `XX <name>` — e.g. a
		// hypothetical `10-19 Personal/14 Writing/01 Subdir/` — would wrongly
		// self-promote to category status.
		if (folder.path.split("/").length !== CATEGORY_DEPTH) continue;

		const prefix = m[1];

		// Skip if THIS category's index file already exists. The check binds
		// to `prefix` so a misfiled `07.00.md` inside `06 Foo/` doesn't
		// suppress 06's index. We accept any of:
		//   `XX.00 Title.md` (space), `XX.00.md` (just extension),
		//   `XX.00+SUF Title.md` (suffix-tagged variant).
		// String-prefix check rather than dynamic regex (avoids ReDoS via
		// interpolation, simpler to read).
		const indexBase = `${prefix}.00`;
		const hasIndex = folder.children.some((c) => {
			if (!c.name.endsWith(".md")) return false;
			if (!c.name.startsWith(indexBase)) return false;
			const next = c.name.charAt(indexBase.length);
			return next === " " || next === "." || next === "+";
		});
		if (hasIndex) continue;

		// `standardZeros()` doesn't guarantee `00` at index 0 in its public
		// contract; look it up by id to keep this resilient if the canonical
		// order is ever reshuffled.
		const zero = standardZeros(prefix, suffixFor(prefix)).find((z) => z.id === "00");
		if (!zero) continue; // unreachable given the literal-typed `ZeroId` union
		const basename = `${prefix}.${zero.id} ${zero.name}`;
		const targetPath = `${folder.path}/${basename}.md`;

		try {
			await app.vault.create(
				targetPath,
				buildZeroFrontmatter(zero, prefix, folder.name, now)
			);
			result.created++;
		} catch (e) {
			result.failures.push({ path: targetPath, error: (e as Error).message });
			console.warn("[jd] ensureCategoryIndexes failed", targetPath, e);
		}
	}

	return result;
}
