/**
 * Johnny Decimal Dashboard — Obsidian plugin entry point.
 *
 * Provides live JD system awareness: inbox dashboard, drift detection,
 * quick ID navigation. Reads the same jd-index.yaml and jd.yaml that
 * jd-cli uses, with no runtime dependency on the Python tool.
 */

import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { type JDSettings, DEFAULT_SETTINGS, JDSettingsTab } from "./settings";
import { InboxDashboardView, VIEW_TYPE_INBOX } from "./views/inbox-dashboard";
import { DriftPanelView, VIEW_TYPE_DRIFT } from "./views/drift-panel";
import { GoToIdModal } from "./commands/go-to-id";
import { generateDriftReport } from "./commands/drift-report";
import { generateAuditReport } from "./commands/audit-report";
import { migrateReadmeFiles } from "./commands/migrate-readme";
import { renderCategoryJdex } from "./commands/render-jdex";
import { promoteToFolder } from "./commands/promote-to-folder";
import { renderFiles } from "./commands/render-files";
import { renumberCommand } from "./commands/renumber";
import { indexFolderNote } from "./commands/index-folder-note";
import { standardZerosCommand } from "./commands/standard-zeros";
import { newCategoryCommand } from "./commands/new-category";
import {
	newGenericIdFromTemplate,
	newStandardZeroFromTemplate,
	newStemFromTemplate,
} from "./commands/new-from-template";
import { indexVault, indexCategory } from "./commands/index-vault";
import { registerFileMenu } from "./menus/file-menu";
import { scanDrift } from "./scanner";
import { parseJDex, parseJDConfig, type JDex, type JDConfig } from "./jdex";
import { FrontmatterNormalizer } from "./normalizer";
import { getKeys } from "./keys";
import { readFileSync, writeFileSync, watchFile, unwatchFile } from "fs";
import { homedir } from "os";
import { buildJdexFromVault, serializeJdex } from "./lib/jdex-from-vault";

/**
 * Wrap a command body so any uncaught rejection surfaces a Notice and a
 * console error, rather than silently disappearing as an unhandled
 * promise. Use for every command-palette dispatch.
 */
function runCmd(name: string, p: Promise<unknown> | (() => Promise<unknown>)): void {
	const promise = typeof p === "function" ? p() : p;
	promise.catch((e: unknown) => {
		const msg = e instanceof Error ? e.message : String(e);
		console.error("[jd] command failed:", name, e);
		new Notice(name + ": " + msg);
	});
}

export default class JDDashboardPlugin extends Plugin {
	settings: JDSettings = DEFAULT_SETTINGS;
	jdex: JDex | null = null;
	jdConfig: JDConfig | null = null;
	private normalizer!: FrontmatterNormalizer;
	private watchedJdexPath: string | null = null;
	private watchedConfigPath: string | null = null;
	private reloadDebouncer: ReturnType<typeof setTimeout> | null = null;
	private jdexRebuildDebouncer: ReturnType<typeof setTimeout> | null = null;
	/** ms-since-epoch of the last self-write to jd-index.yaml (skip-self guard). */
	private lastJdexSelfWriteMs = 0;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.loadJDex();
		this.loadJDConfig();
		this.normalizer = new FrontmatterNormalizer(this.app, this.settings);

		// Register views
		this.registerView(
			VIEW_TYPE_INBOX,
			(leaf) => new InboxDashboardView(leaf, this)
		);
		this.registerView(
			VIEW_TYPE_DRIFT,
			(leaf) => new DriftPanelView(leaf, this)
		);

		// Ribbon icons
		this.addRibbonIcon("inbox", "JD Inboxes", () => {
			runCmd("Open inbox dashboard", () => this.activateInboxView());
		});
		this.addRibbonIcon("alert-triangle", "JD Drift", () => {
			runCmd("Open drift panel", () => this.activateDriftView());
		});

		// Commands
		this.addCommand({
			id: "open-inbox-dashboard",
			name: "Open inbox dashboard",
			callback: () => runCmd("Open inbox dashboard", () => this.activateInboxView()),
		});

		this.addCommand({
			id: "go-to-id",
			name: "Go to ID",
			callback: () => new GoToIdModal(this.app).open(),
		});

		this.addCommand({
			id: "open-drift-panel",
			name: "Open drift panel",
			callback: () => runCmd("Open drift panel", () => this.activateDriftView()),
		});

		this.addCommand({
			id: "check-drift",
			name: "Check for drift",
			callback: () => this.checkDrift(),
		});

		this.addCommand({
			id: "drift-report",
			name: "Generate drift report",
			callback: () => runCmd("Generate drift report", () => generateDriftReport(this.app, this.jdex, this.settings)),
		});

		this.addCommand({
			id: "vault-audit",
			name: "Run vault audit",
			callback: () =>
				runCmd("Run vault audit", () =>
					generateAuditReport(this.app, this.jdex, this.settings, {
						staleDays: this.settings.staleDays,
						jdConfig: this.jdConfig,
					})
				),
		});

		this.addCommand({
			id: "migrate-readme",
			name: "Migrate +README files to folder-named cover notes",
			callback: () => runCmd("Migrate +README files", () => migrateReadmeFiles(this.app, getKeys(this.settings))),
		});

		this.addCommand({
			id: "render-category-jdex",
			name: "Render category JDex contents",
			callback: () => {
				if (!this.jdex) {
					new Notice("JDex not loaded — check JDex path setting.");
					return;
				}
				const jdex = this.jdex;
				runCmd("Render category JDex contents", () => renderCategoryJdex(this.app, jdex, this.settings));
			},
		});

		this.addCommand({
			id: "reload-jdex",
			name: "Reload JDex and config from disk",
			callback: () => this.reloadJDexAndConfig("manual"),
		});

		this.addCommand({
			id: "promote-to-folder",
			name: "Promote note to folder",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				runCmd("Promote note to folder", () => promoteToFolder(this.app, file));
				return true;
			},
		});

		this.addCommand({
			id: "render-files",
			name: "Render filesystem contents",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				runCmd("Render filesystem contents", () => renderFiles(this.app, this.settings, file));
				return true;
			},
		});

		this.addCommand({
			id: "renumber",
			name: "Renumber active note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				runCmd("Renumber active note", () => renumberCommand(this.app, file));
				return true;
			},
		});

		this.addCommand({
			id: "index-folder-note",
			name: "Index folder note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!file.path.endsWith(".md")) return false;
				if (checking) return true;
				runCmd("Index folder note", () => indexFolderNote(this.app, file));
				return true;
			},
		});

		this.addCommand({
			id: "index-category",
			name: "Index category (active .00 note)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!/^\d{2}\.00\b/.test(file.basename)) return false;
				if (checking) return true;
				runCmd("Index category", () => indexCategory(this.app, file));
				return true;
			},
		});

		this.addCommand({
			id: "index-vault",
			name: "Index entire vault",
			callback: () => runCmd("Index entire vault", () => indexVault(this.app)),
		});

		this.addCommand({
			id: "standard-zeros",
			name: "Create standard zeros in current category",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				runCmd("Create standard zeros", () => standardZerosCommand(this.app, file));
				return true;
			},
		});

		this.addCommand({
			id: "new-category",
			name: "New category in current area",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				runCmd("New category", () => newCategoryCommand(this.app, file));
				return true;
			},
		});

		this.addCommand({
			id: "new-standard-zero",
			name: "New standard zero in current category",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				runCmd("New standard zero", () => newStandardZeroFromTemplate(this.app, file, this.settings));
				return true;
			},
		});

		this.addCommand({
			id: "new-id-from-template",
			name: "New ID in current category",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (checking) return true;
				runCmd("New ID", () => newGenericIdFromTemplate(this.app, file, this.settings));
				return true;
			},
		});

		this.addCommand({
			id: "new-stem",
			name: "New stem for current JDex",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!/^\d{2}\.00\b/.test(file.basename)) return false;
				if (checking) return true;
				runCmd("New stem", () => newStemFromTemplate(this.app, file, this.settings));
				return true;
			},
		});

		// File-explorer right-click submenu — same handlers as the palette
		// commands above, surfaced as a "Johnny Decimal ▸" submenu on .md
		// files. `settings` is read lazily so user changes (e.g. templates
		// folder) take effect without re-registering the event.
		registerFileMenu(this, () => this.settings);

		// Settings tab
		this.addSettingTab(new JDSettingsTab(this.app, this));

		// Status bar — drift count (clickable)
		const statusEl = this.addStatusBarItem();
		statusEl.addClass("jd-status-drift");
		statusEl.addEventListener("click", () => this.activateDriftView());
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.updateStatusBar(statusEl);
			})
		);
		// Initial update after a short delay to let metadata cache populate
		this.app.workspace.onLayoutReady(() => {
			setTimeout(() => this.updateStatusBar(statusEl), 2000);
		});

		// Optional audit on startup
		if (this.settings.auditOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				setTimeout(() => {
					runCmd("Startup vault audit", () =>
						generateAuditReport(this.app, this.jdex, this.settings, {
							staleDays: this.settings.staleDays,
							jdConfig: this.jdConfig,
						})
					);
				}, 5000); // wait for metadata cache to settle
			});
		}

		// Frontmatter normalizer — auto-fix on save. Wrap in .catch so a parse
		// failure on one bad note doesn't silently disappear into an unhandled
		// promise rejection (the modify event handler can't be runCmd-wrapped
		// because it fires repeatedly, not once per command).
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.endsWith(".md")) return;
				if (this.normalizer.isGuarded(file.path)) return;
				this.normalizer.normalize(file).catch((e: unknown) => {
					console.warn("[jd] normalizer failed on", file.path, e);
				});
			})
		);

		// JDex write-back: rebuild jd-index.yaml when vault truth changes.
		// `metadataCache.on("changed")` fires after frontmatter parse — the
		// right hook for description/locations edits. `vault.on(...)` covers
		// structural changes. Each is debounced via `scheduleJdexRebuild`,
		// which itself is a no-op when the autoUpdateJdexYaml setting is off.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.extension !== "md") return;
				this.scheduleJdexRebuild();
			})
		);
		this.registerEvent(this.app.vault.on("create", () => this.scheduleJdexRebuild()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleJdexRebuild()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleJdexRebuild()));
	}

	async onunload(): Promise<void> {
		if (this.watchedJdexPath) {
			unwatchFile(this.watchedJdexPath);
			this.watchedJdexPath = null;
		}
		if (this.watchedConfigPath) {
			unwatchFile(this.watchedConfigPath);
			this.watchedConfigPath = null;
		}
		if (this.reloadDebouncer) {
			clearTimeout(this.reloadDebouncer);
			this.reloadDebouncer = null;
		}
		if (this.jdexRebuildDebouncer) {
			clearTimeout(this.jdexRebuildDebouncer);
			this.jdexRebuildDebouncer = null;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.normalizer?.updateSettings(this.settings);
	}

	private resolvePath(p: string): string {
		// Only expand a leading `~` or `~/...` — never mid-string tildes.
		// The iCloud-Obsidian vault path contains literal tildes
		// (`iCloud~md~obsidian`) that naive `.replace("~", HOME)` would corrupt.
		if (p === "~") return homedir();
		if (p.startsWith("~/")) return homedir() + p.slice(1);
		return p;
	}

	private loadJDex(): void {
		try {
			const jdexPath = this.resolvePath(this.settings.jdexPath);
			const raw = readFileSync(jdexPath, "utf-8");
			this.jdex = parseJDex(raw);
			this.watchPath("jdex", jdexPath);
		} catch {
			this.jdex = null;
		}
	}

	private loadJDConfig(): void {
		try {
			const path = this.resolvePath(this.settings.jdConfigPath);
			const raw = readFileSync(path, "utf-8");
			this.jdConfig = parseJDConfig(raw);
			this.watchPath("config", path);
		} catch {
			this.jdConfig = null;
		}
	}

	/**
	 * Watch jdex/config file for external changes (jd-cli writes, manual edits)
	 * and trigger a debounced reload. The vault event system doesn't see files
	 * outside the vault, so we use Node's fs.watchFile directly.
	 */
	private watchPath(kind: "jdex" | "config", path: string): void {
		const current = kind === "jdex" ? this.watchedJdexPath : this.watchedConfigPath;
		if (current === path) return;
		if (current) unwatchFile(current);
		watchFile(path, { interval: 1000 }, (curr, prev) => {
			if (curr.mtimeMs === prev.mtimeMs) return;
			// Skip-self guard: if we wrote this file in the last second
			// (only relevant for jdex), don't trigger a reload — the
			// in-memory state is already current.
			if (
				kind === "jdex" &&
				Date.now() - this.lastJdexSelfWriteMs < 1000
			) {
				return;
			}
			this.scheduleReload();
		});
		if (kind === "jdex") this.watchedJdexPath = path;
		else this.watchedConfigPath = path;
	}

	private scheduleReload(): void {
		if (this.reloadDebouncer) clearTimeout(this.reloadDebouncer);
		this.reloadDebouncer = setTimeout(() => {
			this.reloadDebouncer = null;
			this.reloadJDexAndConfig("file changed");
		}, 250);
	}

	/**
	 * Debounced rebuild of `jd-index.yaml` from current vault state.
	 *
	 * Triggered by vault structure or frontmatter events when
	 * `settings.autoUpdateJdexYaml` is on. Coalesces bursts (e.g. a
	 * batch rename) into a single write. Records the write time so the
	 * `watchFile` callback skips its own self-triggered reload.
	 */
	scheduleJdexRebuild(): void {
		if (!this.settings.autoUpdateJdexYaml) return;
		if (this.jdexRebuildDebouncer) clearTimeout(this.jdexRebuildDebouncer);
		this.jdexRebuildDebouncer = setTimeout(() => {
			this.jdexRebuildDebouncer = null;
			this.rebuildJdexNow();
		}, 500);
	}

	private rebuildJdexNow(): void {
		try {
			const jdex = buildJdexFromVault(this.app);
			const yaml = serializeJdex(jdex);
			const path = this.resolvePath(this.settings.jdexPath);
			this.lastJdexSelfWriteMs = Date.now();
			writeFileSync(path, yaml, "utf-8");
			// Update in-memory copy so consumers see the new state without
			// waiting for the watchFile reload (which we just suppressed).
			this.jdex = jdex;
		} catch (e) {
			console.warn("[jd] rebuildJdexNow failed", e);
			new Notice(
				"JD: failed to write jd-index.yaml — see console"
			);
		}
	}

	reloadJDexAndConfig(reason: string): void {
		this.loadJDex();
		this.loadJDConfig();
		new Notice(`JD: reloaded (${reason})`);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DRIFT)) {
			const view = leaf.view as DriftPanelView;
			if (typeof view.render === "function") view.render();
		}
	}

	async activateInboxView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_INBOX)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_INBOX, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async activateDriftView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(VIEW_TYPE_DRIFT)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (!rightLeaf) return;
			leaf = rightLeaf;
			await leaf.setViewState({ type: VIEW_TYPE_DRIFT, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	private updateStatusBar(el: HTMLElement): void {
		const drift = scanDrift(this.app, getKeys(this.settings));
		if (drift.length > 0) {
			el.setText(`JD: ${drift.length} drifted`);
			el.title = drift.map((d) => d.detail).join("\n");
		} else {
			el.setText("");
			el.title = "";
		}
	}

	private checkDrift(): void {
		const drift = scanDrift(this.app, getKeys(this.settings));
		if (drift.length === 0) {
			new Notice("No drift detected — all JD notes are consistent.");
			return;
		}
		new Notice(`Found ${drift.length} drifted notes. Check the console for details.`);
		console.group("JD Drift Report");
		for (const item of drift) {
			console.log(`[${item.issue}] ${item.path}: ${item.detail}`);
		}
		console.groupEnd();
	}
}
