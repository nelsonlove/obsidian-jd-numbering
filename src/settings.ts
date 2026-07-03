import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_CONFIG } from "./jd";
import type JdPlugin from "../main";

export interface JdSettings {
	expandedAreas: string[];
	expandedCategories: string[];
	indexPath: string;
	lintReportPath: string;
	leaveRedirectOnRefile: boolean;
}

export const DEFAULT_SETTINGS: JdSettings = {
	expandedAreas: DEFAULT_CONFIG.expandedAreas,
	expandedCategories: DEFAULT_CONFIG.expandedCategories,
	indexPath: "JD index.md",
	lintReportPath: "JD lint report.md",
	leaveRedirectOnRefile: false,
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
			.setName("Lint report path")
			.setDesc("Where JD: Lint vault writes its report.")
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
	}
}
