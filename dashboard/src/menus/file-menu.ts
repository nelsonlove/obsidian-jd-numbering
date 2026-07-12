/**
 * File-explorer right-click submenu — "Johnny Decimal ▸".
 *
 * Adds a single submenu entry to Obsidian's file-menu (right-click in the
 * file explorer) that fans out into the plugin's file-scoped commands.
 * Top-level palette commands stay untouched; this is purely a discovery
 * surface for the same handlers.
 *
 * Each item carries a `visible(file)` predicate matching its palette
 * `checkCallback` — e.g. "Index category" / "New stem" only appear for
 * `.00` notes.
 */

import { type App, type MenuItem, Notice, TFile } from "obsidian";
import type { Plugin } from "obsidian";
import type { JDSettings } from "../settings";

import { promoteToFolder } from "../commands/promote-to-folder";
import { renderFiles } from "../commands/render-files";
import { renumberCommand } from "../commands/renumber";
import { indexFolderNote } from "../commands/index-folder-note";
import { indexCategory } from "../commands/index-vault";
import { standardZerosCommand } from "../commands/standard-zeros";
import { newCategoryCommand } from "../commands/new-category";
import {
	newGenericIdFromTemplate,
	newStandardZeroFromTemplate,
	newStemFromTemplate,
} from "../commands/new-from-template";

/**
 * Obsidian 1.5+ exposes `MenuItem.setSubmenu()` at runtime, but the
 * public `.d.ts` shipped with the npm package doesn't declare it. The
 * plugin's `minAppVersion` (1.11.4) is well past the introduction, so
 * augment the type rather than cast at every call site.
 */
declare module "obsidian" {
	interface MenuItem {
		setSubmenu(): Menu;
	}
}

const CATEGORY_ZERO_RE = /^\d{2}\.00\b/;

interface MenuItemDef {
	title: string;
	icon: string;
	section: "create" | "reorganize" | "index";
	visible: (file: TFile) => boolean;
	run: (app: App, file: TFile, settings: JDSettings) => Promise<unknown> | void;
}

const ITEMS: readonly MenuItemDef[] = [
	// Create
	{
		title: "New ID in category",
		icon: "file-plus",
		section: "create",
		visible: () => true,
		run: (app, file, settings) => newGenericIdFromTemplate(app, file, settings),
	},
	{
		title: "New standard zero",
		icon: "file-plus-2",
		section: "create",
		visible: () => true,
		run: (app, file, settings) => newStandardZeroFromTemplate(app, file, settings),
	},
	{
		title: "Create standard zeros in category",
		icon: "files",
		section: "create",
		visible: () => true,
		run: (app, file) => standardZerosCommand(app, file),
	},
	{
		title: "New category in area",
		icon: "folder-plus",
		section: "create",
		visible: () => true,
		run: (app, file) => newCategoryCommand(app, file),
	},
	{
		title: "New stem",
		icon: "git-branch-plus",
		section: "create",
		visible: (file) => CATEGORY_ZERO_RE.test(file.basename),
		run: (app, file, settings) => newStemFromTemplate(app, file, settings),
	},

	// Reorganize
	{
		title: "Promote note to folder",
		icon: "folder-tree",
		section: "reorganize",
		visible: () => true,
		run: (app, file) => promoteToFolder(app, file),
	},
	{
		title: "Renumber note",
		icon: "hash",
		section: "reorganize",
		visible: () => true,
		run: (app, file) => renumberCommand(app, file),
	},

	// Index
	{
		title: "Index folder note",
		icon: "list-tree",
		section: "index",
		visible: () => true,
		run: (app, file) => indexFolderNote(app, file),
	},
	{
		title: "Index category",
		icon: "list-ordered",
		section: "index",
		visible: (file) => CATEGORY_ZERO_RE.test(file.basename),
		run: (app, file) => indexCategory(app, file),
	},
	{
		title: "Render filesystem contents",
		icon: "folder-search",
		section: "index",
		visible: () => true,
		run: (app, file, settings) => renderFiles(app, settings, file),
	},
];

const SECTION_ORDER: readonly MenuItemDef["section"][] = [
	"create",
	"reorganize",
	"index",
];

/**
 * Surface command failures as a Notice + console.error, mirroring
 * `runCmd` in main.ts. Wrapping in `Promise.resolve().then(run)` lets a
 * single `.catch` handle both promise rejections (the async commands)
 * and any synchronous throws a future item might add.
 */
function safeRun(label: string, run: () => Promise<unknown> | void): void {
	Promise.resolve()
		.then(run)
		.catch((e: unknown) => {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[jd] menu action failed:", label, e);
			new Notice(label + ": " + msg);
		});
}

/**
 * Register the "Johnny Decimal ▸" submenu on the file-explorer right-click
 * menu. The submenu only appears for `.md` files; folders, images, and
 * other extensions are skipped.
 *
 * Items are grouped into create/reorganize/index sections, with separators
 * inserted between groups that actually rendered (so a category zero note
 * doesn't get a trailing separator with nothing after it).
 */
export function registerFileMenu(plugin: Plugin, settings: () => JDSettings): void {
	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, abstractFile) => {
			if (!(abstractFile instanceof TFile)) return;
			if (abstractFile.extension !== "md") return;
			const file = abstractFile;

			const groups = SECTION_ORDER
				.map((section) => ITEMS.filter((it) => it.section === section && it.visible(file)))
				.filter((group) => group.length > 0);
			if (groups.length === 0) return;

			menu.addItem((parent: MenuItem) => {
				parent.setTitle("Johnny Decimal");
				parent.setIcon("hash");
				const sub = parent.setSubmenu();
				groups.forEach((group, idx) => {
					if (idx > 0) sub.addSeparator();
					for (const item of group) {
						sub.addItem((mi: MenuItem) => {
							mi.setTitle(item.title);
							mi.setIcon(item.icon);
							mi.onClick(() => {
								safeRun(item.title, () => item.run(plugin.app, file, settings()));
							});
						});
					}
				});
			});
		})
	);
}
