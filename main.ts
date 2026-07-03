import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { JdConfig } from "./src/jd";
import { lintVault, renderReport } from "./src/lint";
import { renderIndex } from "./src/indexNote";
import { assignNextNumber, refileToMatchId } from "./src/actions";
import { DEFAULT_SETTINGS, JdSettings, JdSettingTab } from "./src/settings";

export default class JdPlugin extends Plugin {
	settings!: JdSettings;

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
