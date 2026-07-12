/**
 * Audit report — generates a comprehensive vault health report.
 *
 * Writes to 00-09 System/00 System management/00.00+REPORT JD vault audit.md
 * grouped by severity: errors, warnings, info.
 */

import { type App, Notice, TFile, normalizePath } from "obsidian";
import {
	runValidation,
	type ValidationReport,
	type ValidationIssue,
	type Severity,
	type ValidatorOptions,
} from "../validator";
import type { JDex } from "../jdex";
import type { JDSettings } from "../settings";
import { getKeys, formatTypeFrontmatter, typeTagFor } from "../keys";

const REPORT_PATH =
	"00-09 System/00 System management/00.00+REPORT JD vault audit.md";

const SEVERITY_EMOJI: Record<Severity, string> = {
	error: "x",
	warning: "!",
	info: "~",
};

const SEVERITY_LABEL: Record<Severity, string> = {
	error: "Errors",
	warning: "Warnings",
	info: "Info",
};

function checkLabels(idKey: string): Record<string, string> {
	return {
		"required-fields": "Missing required fields",
		"date-format": "Invalid date formats",
		"valid-category": "Invalid JD categories",
		"duplicate-id": `Duplicate ${idKey} values`,
		"orphaned-file": "Orphaned files",
		"broken-wikilink": "Broken wikilinks",
		"empty-note": "Empty notes",
		"stale-surveyed": "Stale surveyed dates",
		"title-mismatch": "Title mismatches",
		"missing-stub": "Missing note stubs",
		"unregistered-id": "Unregistered IDs (in vault, not in JDex YAML)",
		"jdex-title-mismatch": "Filename ↔ JDex YAML title mismatches",
		"jdex-category-mismatch": "Category folder ↔ JDex YAML title mismatches",
	};
}

function formatDate(): string {
	return new Date().toISOString().split("T")[0];
}

function formatTime(): string {
	return new Date().toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function groupByCheck(issues: ValidationIssue[]): Map<string, ValidationIssue[]> {
	const map = new Map<string, ValidationIssue[]>();
	for (const issue of issues) {
		const list = map.get(issue.check) ?? [];
		list.push(issue);
		map.set(issue.check, list);
	}
	return map;
}

function renderIssue(issue: ValidationIssue): string {
	const link = `[[${issue.path.replace(/\.md$/, "")}]]`;
	let line = `- ${link} — ${issue.message}`;
	if (issue.suggestion) {
		line += `\n  - *${issue.suggestion}*`;
	}
	return line;
}

export async function generateAuditReport(
	app: App,
	jdex: JDex | null,
	settings: JDSettings,
	options?: Omit<ValidatorOptions, "keys">
): Promise<void> {
	const keys = getKeys(settings);
	// Always pass indexTag and typeTagPrefix — the validator is a read-mode
	// check that accepts either frontmatter or tag form, independent of the
	// `typeAsTag` write-mode setting.
	const indexTag = typeTagFor(settings, "index");
	const typeTagPrefix = settings.typeTagPrefix ?? "jd/";
	const report = runValidation(app, jdex, {
		...options,
		keys,
		indexTag,
		typeTagPrefix,
	});
	const lines: string[] = [];
	const CHECK_LABELS = checkLabels(keys.id);

	// Frontmatter
	lines.push("---");
	for (const line of formatTypeFrontmatter(settings, "report")) {
		lines.push(line);
	}
	lines.push(`generated: ${formatDate()}`);
	lines.push("---");
	lines.push("");
	lines.push("# JD Vault Audit");
	lines.push("");
	lines.push(
		`> Generated ${formatDate()} at ${formatTime()} by Johnny Decimal Dashboard plugin.`
	);
	lines.push("");

	// Summary table
	lines.push("## Summary");
	lines.push("");
	lines.push("| Metric | Count |");
	lines.push("| ------ | ----- |");
	lines.push(`| Files scanned | ${report.filesScanned} |`);
	lines.push(`| Errors | ${report.summary.error} |`);
	lines.push(`| Warnings | ${report.summary.warning} |`);
	lines.push(`| Info | ${report.summary.info} |`);
	lines.push(`| **Total issues** | **${report.issues.length}** |`);
	lines.push("");

	if (report.issues.length === 0) {
		lines.push("All clear — no issues detected.");
		lines.push("");
	}

	// Group by severity, then by check within each severity
	const severities: Severity[] = ["error", "warning", "info"];

	for (const severity of severities) {
		const sevIssues = report.issues.filter((i) => i.severity === severity);
		if (sevIssues.length === 0) continue;

		lines.push(`## ${SEVERITY_LABEL[severity]} (${sevIssues.length})`);
		lines.push("");

		const byCheck = groupByCheck(sevIssues);
		for (const [check, items] of byCheck) {
			const label = CHECK_LABELS[check] ?? check;
			lines.push(`### ${label} (${items.length})`);
			lines.push("");
			for (const item of items) {
				lines.push(renderIssue(item));
			}
			lines.push("");
		}
	}

	// Write the report
	const content = lines.join("\n");
	const normalizedPath = normalizePath(REPORT_PATH);
	const existing = app.vault.getAbstractFileByPath(normalizedPath);

	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
	} else {
		await app.vault.create(normalizedPath, content);
	}

	// Open the report
	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (file instanceof TFile) {
		await app.workspace.openLinkText(file.path, "");
	}

	const { error, warning, info } = report.summary;
	new Notice(
		`Vault audit: ${error} errors, ${warning} warnings, ${info} info (${report.filesScanned} files)`
	);
}
