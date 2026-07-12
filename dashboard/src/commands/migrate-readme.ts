/**
 * Migration: +README cover notes → folder-named cover notes.
 *
 * Old: `06.12 Foo/06.12+README.md`
 *      jd-id: '06.12+README'
 *      aliases:
 *          - 06.12 Foo
 *
 * New: `06.12 Foo/06.12 Foo.md`
 *      jd-id: '06.12'
 *      (alias dropped — bare filename already resolves)
 *
 * Reads each `*+README.md`, rewrites the frontmatter, then renames via
 * the vault API (which updates wikilinks in other notes).
 */

import { type App, Notice, TFile } from "obsidian";
import type { JDKeys } from "../keys";

/**
 * Matches both naming conventions seen in the wild:
 *   - ID-form:   `06.06+README.md`
 *   - bare-form: `+README Knowledge base for category 06.md`
 * Either way the file gets renamed to its parent folder's name.
 */
const README_FILENAME_RE = /^(\d{2}\.\d{2}\+README\.md|\+README .+\.md)$/;

interface MigrateResult {
	scanned: number;
	migrated: number;
	skipped: { path: string; reason: string }[];
	preserved: { path: string; aliases: string[] }[];
}

export async function migrateReadmeFiles(
	app: App,
	keys: JDKeys
): Promise<MigrateResult> {
	const result: MigrateResult = { scanned: 0, migrated: 0, skipped: [], preserved: [] };

	const targets: TFile[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (README_FILENAME_RE.test(file.name)) targets.push(file);
	}
	result.scanned = targets.length;

	for (const file of targets) {
		const skip = (reason: string) =>
			result.skipped.push({ path: file.path, reason });

		const parent = file.parent;
		if (!parent) {
			skip("no parent folder");
			continue;
		}

		const newBasename = parent.name;
		const newPath = `${parent.path}/${newBasename}.md`;

		// Don't clobber an existing file at the destination
		const existing = app.vault.getAbstractFileByPath(newPath);
		if (existing && existing.path !== file.path) {
			skip(`destination exists: ${newPath}`);
			continue;
		}

		try {
			const content = await app.vault.read(file);
			const { text: rewritten, userAliases } = rewriteFrontmatter(content, keys, parent.name);
			if (rewritten !== content) {
				await app.vault.modify(file, rewritten);
			}
			await app.fileManager.renameFile(file, newPath);
			result.migrated++;
			if (userAliases.length > 0) {
				result.preserved.push({ path: newPath, aliases: userAliases });
			}
		} catch (e) {
			skip(`error: ${(e as Error).message}`);
		}
	}

	const preservedFragment =
		result.preserved.length > 0
			? ` Aliases retained in ${result.preserved.length} file(s) — see console.`
			: "";
	new Notice(
		`Migrated ${result.migrated}/${result.scanned} +README files.` +
			` Skipped: ${result.skipped.length}.` +
			preservedFragment
	);
	if (result.skipped.length > 0) {
		console.group("README migration — skipped files");
		for (const s of result.skipped) {
			console.log(`${s.path}: ${s.reason}`);
		}
		console.groupEnd();
	}
	if (result.preserved.length > 0) {
		console.group("README migration — user aliases preserved");
		for (const p of result.preserved) {
			console.log(`${p.path}: ${p.aliases.join(", ")}`);
		}
		console.groupEnd();
	}

	return result;
}

/**
 * Rewrite the frontmatter:
 *   - strip "+README" suffix from the ID value
 *   - drop an auto-generated `aliases:` block (single alias matching the
 *     parent folder name); preserve any aliases block that contains user
 *     additions so we don't silently lose data
 *
 * Returns the rewritten content plus the list of aliases retained (so the
 * caller can surface them to the user — preserved aliases may want a
 * manual once-over).
 */
function rewriteFrontmatter(
	content: string,
	keys: JDKeys,
	parentName: string
): { text: string; userAliases: string[] } {
	const empty = { text: content, userAliases: [] };
	if (!content.startsWith("---\n")) return empty;
	const close = content.indexOf("\n---\n", 4);
	if (close === -1) return empty;

	const fmText = content.slice(4, close + 1);
	const body = content.slice(close + 5);

	const lines = fmText.split("\n");
	// Fixed regex captures any YAML scalar key; the key name is then
	// compared as a string. Avoids constructing RegExp from settings input
	// (which the linter flags as a ReDoS risk surface).
	const KEY_LINE_RE = /^([a-zA-Z][\w-]*):\s*(.*)$/;

	const out: string[] = [];
	const userAliases: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const m = line.match(KEY_LINE_RE);

		if (m && m[1] === keys.id) {
			const value = m[2].trim().replace(/^['"]|['"]$/g, "");
			if (value.endsWith("+README")) {
				const stripped = value.slice(0, -"+README".length);
				out.push(`${keys.id}: '${stripped}'`);
				i++;
				continue;
			}
		}

		if (m && m[1] === "aliases") {
			const inlineValue = m[2].trim();
			const blockLines = [line];
			let j = i + 1;
			while (j < lines.length && /^\s+-\s/.test(lines[j])) {
				blockLines.push(lines[j]);
				j++;
			}
			const aliases = parseAliases(inlineValue, blockLines.slice(1));

			// Auto-generated case: exactly one alias matching the parent
			// folder name. Drop the whole block — the bare filename will
			// resolve once the file is renamed to `parent.name.md`.
			if (aliases.length === 1 && aliases[0] === parentName) {
				i = j;
				continue;
			}

			// Anything else (user-added aliases, multiple aliases, an
			// empty `aliases: []`) passes through verbatim. We don't try
			// to re-emit canonically because the original format may have
			// been the user's choice.
			out.push(...blockLines);
			if (aliases.length > 0) userAliases.push(...aliases);
			i = j;
			continue;
		}

		out.push(line);
		i++;
	}

	return { text: `---\n${out.join("\n")}---\n${body}`, userAliases };
}

/**
 * Extract alias values from either form. Block form: child lines like
 * `    - Foo`. Inline form: `[Foo, Bar]`, `[]`, or a bare scalar like
 * `Foo`. Quotes are stripped. Doesn't handle YAML edge cases (escaped
 * commas inside quoted strings, flow-style nested structures); migration
 * inputs are constrained enough that the simple split is fine.
 */
function parseAliases(inlineValue: string, childLines: string[]): string[] {
	if (childLines.length > 0) {
		const out: string[] = [];
		for (const child of childLines) {
			const m = child.match(/^\s+-\s+(.+)$/);
			if (m) out.push(unquote(m[1].trim()));
		}
		return out;
	}
	if (!inlineValue) return [];
	if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
		const inner = inlineValue.slice(1, -1).trim();
		if (!inner) return [];
		return inner.split(",").map((s) => unquote(s.trim()));
	}
	return [unquote(inlineValue)];
}

function unquote(s: string): string {
	return s.replace(/^['"]|['"]$/g, "");
}
