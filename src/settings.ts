import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_CONFIG } from "./jd";
import type JdPlugin from "../main";

export interface JdSettings {
	expandedAreas: string[];
	expandedCategories: string[];
	indexPath: string;
	/** Whether JD: Lint vault writes (and opens) a report note. */
	writeLintReport: boolean;
	lintReportPath: string;
	leaveRedirectOnRefile: boolean;
	/** Lint the active note when it is saved/modified. */
	lintOnSave: boolean;
	/** Lint the active note when you switch to it. */
	lintOnFileChange: boolean;
	/** Show the active-note status-bar indicator (JD ✓ / JD ⚠ N). */
	showStatusBar: boolean;
	/** Also pop a notice (not just the status bar) when a lint finds issues. */
	showLintNotice: boolean;
}

export const DEFAULT_SETTINGS: JdSettings = {
	expandedAreas: DEFAULT_CONFIG.expandedAreas,
	expandedCategories: DEFAULT_CONFIG.expandedCategories,
	indexPath: "JD index.md",
	writeLintReport: true,
	lintReportPath: "JD lint report.md",
	leaveRedirectOnRefile: false,
	lintOnSave: false,
	lintOnFileChange: false,
	showStatusBar: true,
	showLintNotice: false,
};

const parseList = (v: string): string[] =>
	v.split(",").map((s) => s.trim()).filter(Boolean);

export class JdSettingTab extends PluginSettingTab {
	plugin: JdPlugin;

	constructor(app: App, plugin: JdPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "JD Numbering" });

		new Setting(containerEl)
			.setName("Expanded areas")
			.setDesc("Comma-separated area bands that use 5-digit ids (e.g. 90-99).")
			.addText((t) =>
				t
					.setPlaceholder("90-99")
					.setValue(this.plugin.settings.expandedAreas.join(", "))
					.onChange(async (v) => {
						this.plugin.settings.expandedAreas = parseList(v);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Expanded categories")
			.setDesc("Comma-separated categories that use 5-digit flat ids (e.g. 27).")
			.addText((t) =>
				t
					.setPlaceholder("27")
					.setValue(this.plugin.settings.expandedCategories.join(", "))
					.onChange(async (v) => {
						this.plugin.settings.expandedCategories = parseList(v);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Index note path")
			.setDesc("Where JD: Refresh index writes the generated JDex index.")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.indexPath)
					.onChange(async (v) => {
						this.plugin.settings.indexPath = v.trim() || DEFAULT_SETTINGS.indexPath;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Write lint report")
			.setDesc("When JD: Lint vault runs, write and open a report note. When off, it just shows the counts as a notice.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.writeLintReport)
					.onChange(async (v) => {
						this.plugin.settings.writeLintReport = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Lint report path")
			.setDesc("Where JD: Lint vault writes its report (when the report is enabled).")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.lintReportPath)
					.onChange(async (v) => {
						this.plugin.settings.lintReportPath = v.trim() || DEFAULT_SETTINGS.lintReportPath;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Leave redirect stub on refile")
			.setDesc("When refiling, leave a system/redirect note at the old path so links keep resolving.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.leaveRedirectOnRefile)
					.onChange(async (v) => {
						this.plugin.settings.leaveRedirectOnRefile = v;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Automatic linting" });
		containerEl.createEl("p", {
			text: "Surface JD issues for the active note in the status bar. Read-only — never moves or renames files.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Lint on save")
			.setDesc("Check the active note when it is saved/modified.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.lintOnSave)
					.onChange(async (v) => {
						this.plugin.settings.lintOnSave = v;
						await this.plugin.saveSettings();
						this.plugin.refreshStatusBar();
					})
			);

		new Setting(containerEl)
			.setName("Lint on file change")
			.setDesc("Check a note when you open or switch to it.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.lintOnFileChange)
					.onChange(async (v) => {
						this.plugin.settings.lintOnFileChange = v;
						await this.plugin.saveSettings();
						this.plugin.refreshStatusBar();
					})
			);

		new Setting(containerEl)
			.setName("Show status-bar indicator")
			.setDesc("Show the active note's JD status in the status bar (JD ✓ / JD ⚠ N). Click it to run a full vault lint.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showStatusBar)
					.onChange(async (v) => {
						this.plugin.settings.showStatusBar = v;
						await this.plugin.saveSettings();
						this.plugin.refreshStatusBar();
					})
			);

		new Setting(containerEl)
			.setName("Show notice on issues")
			.setDesc("In addition to the status bar, pop a notice listing the note's issues when an automatic lint finds any.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showLintNotice)
					.onChange(async (v) => {
						this.plugin.settings.showLintNotice = v;
						await this.plugin.saveSettings();
					})
			);
	}
}
