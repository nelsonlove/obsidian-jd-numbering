/**
 * Drift report — generates a comprehensive markdown report of JD system health.
 *
 * Writes to 00-09 System/00 System management/00.00+REPORT JD drift report.md
 * covering: frontmatter drift, missing stubs, inbox summary.
 */

import { type App, Notice, TFile, normalizePath } from "obsidian";
import { scanDrift, scanInboxes, findMissingStubs, type DriftItem } from "../scanner";
import type { JDex } from "../jdex";
import type { JDSettings } from "../settings";
import { getKeys, formatTypeFrontmatter } from "../keys";

const REPORT_PATH = "00-09 System/00 System management/00.00+REPORT JD drift report.md";

function formatDate(): string {
	const d = new Date();
	return d.toISOString().split("T")[0];
}

function formatTime(): string {
	return new Date().toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = map.get(k) ?? [];
		list.push(item);
		map.set(k, list);
	}
	return map;
}

function issueLabel(issue: DriftItem["issue"]): string {
	switch (issue) {
		case "id-mismatch": return "ID mismatch";
		case "title-mismatch": return "Title mismatch";
		case "wrong-folder": return "Wrong folder";
		case "missing-frontmatter": return "Missing frontmatter";
	}
}

export async function generateDriftReport(
	app: App,
	jdex: JDex | null,
	settings: JDSettings
): Promise<void> {
	const keys = getKeys(settings);
	const drift = scanDrift(app, keys);
	const inboxes = scanInboxes(app);
	const missingStubs = jdex ? findMissingStubs(app, jdex) : [];

	const lines: string[] = [];

	// Frontmatter
	lines.push("---");
	for (const line of formatTypeFrontmatter(settings, "report")) {
		lines.push(line);
	}
	lines.push(`generated: ${formatDate()}`);
	lines.push("---");
	lines.push("");
	lines.push("# JD Drift Report");
	lines.push("");
	lines.push(`> Generated ${formatDate()} at ${formatTime()} by Johnny Decimal Dashboard plugin.`);
	lines.push("");

	// Summary
	lines.push("## Summary");
	lines.push("");
	lines.push(`| Metric | Count |`);
	lines.push(`| ------ | ----- |`);
	lines.push(`| Drifted notes | ${drift.length} |`);
	lines.push(`| Active inboxes | ${inboxes.length} |`);
	lines.push(`| Total inbox items | ${inboxes.reduce((s, i) => s + i.count, 0)} |`);
	if (jdex) {
		lines.push(`| Missing note stubs | ${missingStubs.length} |`);
	}
	lines.push("");

	// Drift details
	lines.push("## Drift");
	lines.push("");
	if (drift.length === 0) {
		lines.push("No drift detected — all JD notes are consistent.");
	} else {
		const byIssue = groupBy(drift, (d) => d.issue);
		for (const [issue, items] of byIssue) {
			lines.push(`### ${issueLabel(issue as DriftItem["issue"])} (${items.length})`);
			lines.push("");
			for (const item of items) {
				lines.push(`- \`${item.path}\` — ${item.detail}`);
			}
			lines.push("");
		}
	}

	// Inboxes
	lines.push("## Inboxes");
	lines.push("");
	if (inboxes.length === 0) {
		lines.push("All inboxes empty.");
	} else {
		lines.push("| Category | Inbox | Count |");
		lines.push("| -------- | ----- | ----- |");
		for (const item of inboxes) {
			lines.push(`| ${item.category} | ${item.inboxFolder} | ${item.count} |`);
		}
	}
	lines.push("");

	// Missing stubs
	if (jdex) {
		lines.push("## Missing Note Stubs");
		lines.push("");
		if (missingStubs.length === 0) {
			lines.push("All JDex entries have corresponding Obsidian notes.");
		} else {
			lines.push("JDex entries without a corresponding note in the vault:");
			lines.push("");
			for (const stub of missingStubs) {
				lines.push(`- **${stub.id}** ${stub.title} → \`${stub.expectedPath}\``);
			}
		}
		lines.push("");
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

	new Notice(`Drift report updated: ${drift.length} drifted, ${inboxes.length} active inboxes`);
}
