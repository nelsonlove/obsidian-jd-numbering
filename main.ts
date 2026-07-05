import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { JdConfig } from "./src/jd";
import { lintVault, lintNote, renderReport, LintFinding } from "./src/lint";
import { renderIndex } from "./src/indexNote";
import { assignNextNumber, refileToMatchId } from "./src/actions";
import { DEFAULT_SETTINGS, JdSettings, JdSettingTab } from "./src/settings";

export default class JdPlugin extends Plugin {
	settings!: JdSettings;
	private statusBar!: HTMLElement;
	private lintDebounce = 0;

	get config(): JdConfig {
		return {
			expandedAreas: this.settings.expandedAreas,
			expandedCategories: this.settings.expandedCategories,
		};
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new JdSettingTab(this.app, this));

		this.addCommand({
			id: "jd-assign-next-number",
			name: "Assign next number (active note)",
			callback: () => assignNextNumber(this.app, this.config),
		});

		this.addCommand({
			id: "jd-refile-to-match-id",
			name: "Refile active note to match its jd-id",
			callback: () =>
				refileToMatchId(this.app, this.config, this.settings.leaveRedirectOnRefile),
		});

		this.addCommand({
			id: "jd-lint-vault",
			name: "Lint vault",
			callback: () => this.runLint(),
		});

		this.addCommand({
			id: "jd-refresh-index",
			name: "Refresh index",
			callback: () => this.runIndex(),
		});

		// --- Automatic per-note linting (surface-only) ---
		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass("jd-statusbar");
		this.registerDomEvent(this.statusBar, "click", () => this.runLint());

		// Lint on file change: fires when you switch to / open a note.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.settings.lintOnFileChange) this.autoLint(true);
				else if (this.settings.lintOnSave) this.autoLint(false);
				else this.clearStatusBar();
			})
		);

		// Lint on save: fires when the active note's content is written.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!this.settings.lintOnSave) return;
				const active = this.app.workspace.getActiveFile();
				if (!active || !(file instanceof TFile) || active.path !== file.path) return;
				window.clearTimeout(this.lintDebounce);
				this.lintDebounce = window.setTimeout(() => this.autoLint(true), 400);
			})
		);

		this.app.workspace.onLayoutReady(() => this.refreshStatusBar());
	}

	onunload(): void {
		window.clearTimeout(this.lintDebounce);
	}

	/** Lint the active note and update the status bar; optionally notify. */
	private autoLint(notify: boolean): void {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			this.clearStatusBar();
			return;
		}
		const findings = lintNote(this.app, this.config, file);
		this.renderStatus(findings);
		if (notify && this.settings.showLintNotice && findings.length) {
			const body = findings.map((f) => `• ${f.code}: ${f.message}`).join("\n");
			new Notice(`JD — ${file.basename}\n${body}`);
		}
	}

	private renderStatus(findings: LintFinding[]): void {
		if (findings.length === 0) {
			this.statusBar.setText("JD ✓");
			this.statusBar.setAttribute("aria-label", "No JD issues in this note");
			this.statusBar.removeClass("mod-warning");
		} else {
			this.statusBar.setText(`JD ⚠ ${findings.length}`);
			this.statusBar.setAttribute(
				"aria-label",
				findings.map((f) => `${f.code}: ${f.message}`).join("\n")
			);
			this.statusBar.addClass("mod-warning");
		}
	}

	private clearStatusBar(): void {
		this.statusBar.setText("");
		this.statusBar.removeAttribute("aria-label");
		this.statusBar.removeClass("mod-warning");
	}

	/** Re-evaluate the status bar (e.g. after a settings toggle). */
	refreshStatusBar(): void {
		if (this.settings.lintOnSave || this.settings.lintOnFileChange) this.autoLint(false);
		else this.clearStatusBar();
	}

	async runLint(): Promise<void> {
		const findings = lintVault(this.app, this.config);
		const md = renderReport(findings, this.config);
		const file = await this.writeGenerated(this.settings.lintReportPath, md);
		const errors = findings.filter((f) => f.level === "error").length;
		new Notice(`JD lint: ${errors} errors, ${findings.length - errors} warnings.`);
		if (file) this.app.workspace.getLeaf(true).openFile(file);
	}

	async runIndex(): Promise<void> {
		const md = renderIndex(this.app, this.config);
		const file = await this.writeGenerated(this.settings.indexPath, md);
		new Notice("JD index refreshed.");
		if (file) this.app.workspace.getLeaf(true).openFile(file);
	}

	/** Overwrite (or create) a generated note, returning the TFile. */
	private async writeGenerated(path: string, content: string): Promise<TFile | null> {
		const p = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(p);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			return existing;
		}
		try {
			return await this.app.vault.create(p, content);
		} catch (e) {
			new Notice(`JD: could not write ${p} — ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
