/**
 * Drift Panel — sidebar showing all JD notes with frontmatter/location issues.
 *
 * Groups by issue type with collapsible sections. Click to navigate.
 * Auto-fix button for simple cases (missing frontmatter).
 * Live updates when vault changes.
 */

import { ItemView, type WorkspaceLeaf, TFile, setIcon, Notice } from "obsidian";
import type JDDashboardPlugin from "../main";
import { scanDrift, findMissingStubs, type DriftItem, type MissingStub } from "../scanner";
import { getKeys, formatTypeFrontmatter } from "../keys";
import { inferType } from "../normalizer";
import { standardZeros } from "../lib/standard-zeros";

export const VIEW_TYPE_DRIFT = "jd-drift-panel";

const ISSUE_LABELS: Record<DriftItem["issue"], string> = {
	"missing-frontmatter": "Missing frontmatter",
	"id-mismatch": "ID mismatch",
	"wrong-folder": "Wrong folder",
	"title-mismatch": "Title mismatch",
};

const ISSUE_ICONS: Record<DriftItem["issue"], string> = {
	"missing-frontmatter": "file-question",
	"id-mismatch": "file-diff",
	"wrong-folder": "folder-x",
	"title-mismatch": "pencil",
};

export class DriftPanelView extends ItemView {
	plugin: JDDashboardPlugin;
	private renderTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: JDDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DRIFT;
	}

	getDisplayText(): string {
		return "JD Drift";
	}

	getIcon(): string {
		return "alert-triangle";
	}

	async onOpen(): Promise<void> {
		this.render();

		// Re-render on metadata changes (frontmatter edits)
		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.debouncedRender())
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.debouncedRender())
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.debouncedRender())
		);
		this.registerEvent(
			this.app.vault.on("create", () => this.debouncedRender())
		);
	}

	async onClose(): Promise<void> {
		if (this.renderTimeout) clearTimeout(this.renderTimeout);
	}

	private debouncedRender(): void {
		if (this.renderTimeout) clearTimeout(this.renderTimeout);
		this.renderTimeout = setTimeout(() => this.render(), 500);
	}

	render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("jd-drift-panel");

		const drift = scanDrift(this.app, getKeys(this.plugin.settings));
		const missingStubs = this.plugin.jdex
			? findMissingStubs(this.app, this.plugin.jdex)
			: [];

		const total = drift.length + missingStubs.length;

		// Header
		const header = container.createDiv({ cls: "jd-drift-header" });
		header.createEl("h3", { text: "Drift" });
		const badge = header.createSpan({
			cls: `jd-drift-total ${total === 0 ? "jd-drift-clean" : ""}`,
		});
		badge.setText(String(total));

		if (total === 0) {
			container.createEl("p", {
				text: "All clear — no drift detected.",
				cls: "jd-drift-empty",
			});
			return;
		}

		// Group drift items by issue type
		const byIssue = new Map<DriftItem["issue"], DriftItem[]>();
		for (const item of drift) {
			const list = byIssue.get(item.issue) ?? [];
			list.push(item);
			byIssue.set(item.issue, list);
		}

		// Render each issue group as a collapsible section
		const issueOrder: DriftItem["issue"][] = [
			"missing-frontmatter",
			"id-mismatch",
			"wrong-folder",
			"title-mismatch",
		];

		for (const issue of issueOrder) {
			const items = byIssue.get(issue);
			if (!items || items.length === 0) continue;

			const section = container.createEl("details", {
				cls: "jd-drift-section",
				attr: { open: "" },
			});

			const summary = section.createEl("summary", {
				cls: "jd-drift-section-header",
			});
			const iconEl = summary.createSpan({ cls: "jd-drift-section-icon" });
			setIcon(iconEl, ISSUE_ICONS[issue]);
			summary.createSpan({
				text: `${ISSUE_LABELS[issue]} (${items.length})`,
			});

			// "Fix all" button for missing frontmatter
			if (issue === "missing-frontmatter") {
				const fixAllBtn = summary.createEl("button", {
					cls: "jd-drift-fix-all",
					attr: { title: `Add ${getKeys(this.plugin.settings).id} frontmatter to all` },
				});
				setIcon(fixAllBtn, "wrench");
				fixAllBtn.addEventListener("click", async (e) => {
					e.stopPropagation();
					await this.fixMissingFrontmatter(items);
				});
			}

			const list = section.createEl("ul", { cls: "jd-drift-list" });
			for (const item of items) {
				this.renderDriftItem(list, item);
			}
		}

		// Missing stubs section
		if (missingStubs.length > 0) {
			const section = container.createEl("details", {
				cls: "jd-drift-section",
			});

			const summary = section.createEl("summary", {
				cls: "jd-drift-section-header",
			});
			const iconEl = summary.createSpan({ cls: "jd-drift-section-icon" });
			setIcon(iconEl, "file-plus");
			summary.createSpan({
				text: `Missing stubs (${missingStubs.length})`,
			});

			// "Create all" button
			const createAllBtn = summary.createEl("button", {
				cls: "jd-drift-fix-all",
				attr: { title: "Create all missing stubs" },
			});
			setIcon(createAllBtn, "plus-circle");
			createAllBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				await this.createAllStubs(missingStubs);
			});

			const list = section.createEl("ul", { cls: "jd-drift-list" });
			for (const stub of missingStubs) {
				this.renderMissingStub(list, stub);
			}
		}

		// Footer
		const footer = container.createDiv({ cls: "jd-drift-footer" });
		const now = new Date();
		footer.createSpan({
			text: `Updated ${now.toLocaleTimeString()}`,
			cls: "jd-drift-timestamp",
		});

		const refreshBtn = footer.createEl("button", { cls: "jd-drift-refresh" });
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.addEventListener("click", () => this.render());
	}

	private renderDriftItem(list: HTMLElement, item: DriftItem): void {
		const li = list.createEl("li", { cls: "jd-drift-item" });

		const row = li.createDiv({ cls: "jd-drift-row" });

		// ID badge
		const id = item.filenameId ?? item.frontmatterId;
		if (id) {
			row.createSpan({ text: id, cls: "jd-drift-id" });
		}

		// Note title (extract from path)
		const filename = item.path.split("/").pop() ?? item.path;
		const title = filename.replace(/\.md$/, "").replace(/^\d{2}\.\d{2}\s+/, "");
		row.createSpan({ text: title, cls: "jd-drift-title" });

		// Detail line
		li.createDiv({ text: item.detail, cls: "jd-drift-detail" });

		// Action buttons
		const actions = li.createDiv({ cls: "jd-drift-actions" });

		// Navigate button
		const navBtn = actions.createEl("button", {
			cls: "jd-drift-action-btn",
			attr: { title: "Open note" },
		});
		setIcon(navBtn, "external-link");
		navBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.app.workspace.openLinkText(item.path, "");
		});

		// Fix button for missing frontmatter
		if (item.issue === "missing-frontmatter" && item.filenameId) {
			const fixBtn = actions.createEl("button", {
				cls: "jd-drift-action-btn",
				attr: { title: `Add ${getKeys(this.plugin.settings).id} to frontmatter` },
			});
			setIcon(fixBtn, "wrench");
			fixBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				await this.fixSingleFrontmatter(item);
			});
		}

		// Click row to navigate
		row.addEventListener("click", () => {
			this.app.workspace.openLinkText(item.path, "");
		});
	}

	private renderMissingStub(list: HTMLElement, stub: MissingStub): void {
		const li = list.createEl("li", { cls: "jd-drift-item jd-drift-stub" });

		const row = li.createDiv({ cls: "jd-drift-row" });
		row.createSpan({ text: stub.id, cls: "jd-drift-id" });
		row.createSpan({ text: stub.title, cls: "jd-drift-title" });

		li.createDiv({
			text: stub.expectedPath,
			cls: "jd-drift-detail",
		});

		// Create button
		const actions = li.createDiv({ cls: "jd-drift-actions" });
		const createBtn = actions.createEl("button", {
			cls: "jd-drift-action-btn",
			attr: { title: "Create stub note" },
		});
		setIcon(createBtn, "file-plus");
		createBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.createSingleStub(stub);
		});
	}

	// ── Auto-fix actions ─────────────────────────────────────────

	private async fixSingleFrontmatter(item: DriftItem): Promise<void> {
		if (!item.filenameId) return;

		const file = this.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) return;

		await this.app.vault.process(file, (content) => {
			return this.addFrontmatterId(content, item.filenameId!);
		});

		new Notice(`Added ${getKeys(this.plugin.settings).id}: '${item.filenameId}' to ${file.basename}`);
		this.debouncedRender();
	}

	private async fixMissingFrontmatter(items: DriftItem[]): Promise<void> {
		let fixed = 0;
		for (const item of items) {
			if (!item.filenameId) continue;
			const file = this.app.vault.getAbstractFileByPath(item.path);
			if (!(file instanceof TFile)) continue;

			await this.app.vault.process(file, (content) => {
				return this.addFrontmatterId(content, item.filenameId!);
			});
			fixed++;
		}
		new Notice(`Added ${getKeys(this.plugin.settings).id} frontmatter to ${fixed} notes`);
		this.debouncedRender();
	}

	private addFrontmatterId(content: string, id: string): string {
		const idKey = getKeys(this.plugin.settings).id;
		if (content.startsWith("---\n")) {
			// Has frontmatter — insert ID line after opening ---
			const endIdx = content.indexOf("\n---\n", 4);
			if (endIdx !== -1) {
				const before = content.slice(0, 4);
				const fm = content.slice(4, endIdx);
				const after = content.slice(endIdx);
				return `${before}${idKey}: '${id}'\n${fm}${after}`;
			}
		}
		// No frontmatter — add it
		return `---\n${idKey}: '${id}'\n---\n${content}`;
	}

	// ── Stub creation ────────────────────────────────────────────

	/**
	 * Standard zeros that are directories (get folder + README) vs notes.
	 * Derived from `standardZeros()` so this stays in sync as the canonical
	 * zero set evolves (e.g. when `.07` was claimed for the Claude Code
	 * notebook, this set picked it up automatically). Prefix/suffix don't
	 * affect `id` or `hasDir`, so any seed values work.
	 */
	private static DIR_ZEROS: Set<string> = new Set(
		standardZeros("00", "").filter((z) => z.hasDir).map((z) => z.id)
	);

	private isDirectoryZero(id: string): boolean {
		const parts = id.split(".");
		if (parts.length !== 2) return false;
		return DriftPanelView.DIR_ZEROS.has(parts[1]);
	}

	private today(): string {
		return new Date().toISOString().split("T")[0];
	}

	private buildStubContent(id: string, title: string, isDir: boolean): string {
		const settings = this.plugin.settings;
		const keys = getKeys(settings);

		// Standard zeros get a meaningful inferred type via `inferType` /
		// `ZERO_TYPES` (e.g. `.01` → "inbox", `.07` → "agent"). Other IDs
		// fall through to the generic "id", which may be omitted by settings.
		const inferred =
			inferType(id, {
				inferForExpanded: settings.inferTypeForExpandedIds,
				subidTypes: settings.subidTypes,
			}) ?? "id";
		const typeLines = formatTypeFrontmatter(settings, inferred);

		const lines = [
			"---",
			`${keys.id}: '${id}'`,
			`${keys.title}: ${title}`,
			...typeLines,
			`created: ${this.today()}`,
			"---",
			"",
			`# ${title}`,
			"",
		];
		if (!isDir) lines.push("## Contents", "");
		return lines.join("\n");
	}

	private async createSingleStub(stub: MissingStub): Promise<void> {
		const isDir = this.isDirectoryZero(stub.id);

		if (isDir) {
			// Create directory with a folder-named cover note inside.
			// Convention: `06.12 Foo/06.12 Foo.md`.
			const folderPath = stub.expectedPath.replace(/\.md$/, "");
			const folderName = folderPath.split("/").pop() ?? "";
			const coverPath = `${folderPath}/${folderName}.md`;

			try {
				await this.app.vault.createFolder(folderPath);
			} catch {
				// Folder may already exist
			}

			const content = this.buildStubContent(stub.id, stub.title, true);
			await this.app.vault.create(coverPath, content);
		} else {
			// Create note file
			const content = this.buildStubContent(stub.id, stub.title, false);
			await this.app.vault.create(stub.expectedPath, content);
		}

		new Notice(`Created stub: ${stub.id} ${stub.title}`);
		this.debouncedRender();
	}

	private async createAllStubs(stubs: MissingStub[]): Promise<void> {
		let created = 0;
		for (const stub of stubs) {
			try {
				await this.createSingleStub(stub);
				created++;
			} catch {
				// Skip if already exists or path issues
			}
		}
		new Notice(`Created ${created} stub notes`);
		this.debouncedRender();
	}
}
