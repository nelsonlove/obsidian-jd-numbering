/**
 * Inbox Dashboard — sidebar panel showing unsorted item counts.
 *
 * Displays all XX.01 Unsorted/Inbox directories with non-zero counts,
 * sorted busiest-first. Click a row to open the folder in the file explorer.
 */

import { ItemView, type WorkspaceLeaf, setIcon } from "obsidian";
import type JDDashboardPlugin from "../main";
import { scanInboxes, type InboxItem } from "../scanner";

export const VIEW_TYPE_INBOX = "jd-inbox-dashboard";

export class InboxDashboardView extends ItemView {
	plugin: JDDashboardPlugin;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: JDDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_INBOX;
	}

	getDisplayText(): string {
		return "JD Inboxes";
	}

	getIcon(): string {
		return "inbox";
	}

	async onOpen(): Promise<void> {
		this.render();

		// Re-render when files change
		this.registerEvent(
			this.app.vault.on("create", () => this.debouncedRender())
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.debouncedRender())
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.debouncedRender())
		);
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	private renderTimeout: ReturnType<typeof setTimeout> | null = null;

	private debouncedRender(): void {
		if (this.renderTimeout) clearTimeout(this.renderTimeout);
		this.renderTimeout = setTimeout(() => this.render(), 500);
	}

	render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("jd-inbox-dashboard");

		const inboxes = scanInboxes(this.app);
		const total = inboxes.reduce((sum, i) => sum + i.count, 0);

		// Header
		const header = container.createDiv({ cls: "jd-inbox-header" });
		header.createEl("h3", { text: "Inboxes" });
		const badge = header.createSpan({ cls: "jd-inbox-total" });
		badge.setText(String(total));

		if (inboxes.length === 0) {
			container.createEl("p", {
				text: "All inboxes empty.",
				cls: "jd-inbox-empty",
			});
			return;
		}

		// Group by area
		const byArea = new Map<string, InboxItem[]>();
		for (const item of inboxes) {
			const list = byArea.get(item.area) ?? [];
			list.push(item);
			byArea.set(item.area, list);
		}

		for (const [area, items] of byArea) {
			const areaEl = container.createDiv({ cls: "jd-inbox-area" });
			areaEl.createEl("h4", { text: area, cls: "jd-inbox-area-name" });

			const listEl = areaEl.createEl("ul", { cls: "jd-inbox-list" });
			for (const item of items) {
				const li = listEl.createEl("li", { cls: "jd-inbox-item" });

				const row = li.createDiv({ cls: "jd-inbox-row" });

				const nameEl = row.createSpan({ cls: "jd-inbox-name" });
				nameEl.setText(item.category);

				const countEl = row.createSpan({ cls: "jd-inbox-count" });
				countEl.setText(String(item.count));

				li.addEventListener("click", () => {
					// Reveal the inbox folder in the file explorer
					const folder = this.app.vault.getAbstractFileByPath(item.path);
					if (folder) {
						// Open file explorer and reveal the folder
						const fileExplorer =
							this.app.workspace.getLeavesOfType("file-explorer")[0];
						if (fileExplorer) {
							this.app.workspace.revealLeaf(fileExplorer);
							// Use internal API to reveal folder in tree
							(fileExplorer.view as any)?.revealInFolder?.(folder);
						}
					}
				});
			}
		}

		// Footer with timestamp
		const footer = container.createDiv({ cls: "jd-inbox-footer" });
		const now = new Date();
		footer.createSpan({
			text: `Updated ${now.toLocaleTimeString()}`,
			cls: "jd-inbox-timestamp",
		});

		const refreshBtn = footer.createEl("button", { cls: "jd-inbox-refresh" });
		setIcon(refreshBtn, "refresh-cw");
		refreshBtn.addEventListener("click", () => this.render());
	}
}
