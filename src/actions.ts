import { App, Notice, TFile } from "obsidian";
import { JdConfig, parseJdId, isExpandedCategory, nextContentDecimal } from "./jd";
import {
	scanVault,
	usedDecimals,
	maxExpandedItem,
	expectedFolder,
	targetPath,
	VaultScan,
} from "./scan";
import { CategoryChoice, CategorySuggestModal, ConfirmModal } from "./modals";

/** Set the `jd-id` frontmatter, forcing a quoted string to preserve leading zeros. */
async function setJdId(app: App, file: TFile, id: string): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm["jd-id"] = id;
	});
}

/** Compute the next free id in a category (normal or expanded). */
export function nextId(scan: VaultScan, cfg: JdConfig, category: string): string | null {
	if (isExpandedCategory(category, cfg)) {
		const max = maxExpandedItem(scan, category);
		// Expanded ids are 5 digits beginning with the category code.
		const base = parseInt(category + "000", 10); // e.g. 27 -> 27000
		const start = max === null ? base + 1 : max + 1;
		return String(start).padStart(5, "0");
	}
	const dec = nextContentDecimal(usedDecimals(scan, category));
	return dec === null ? null : `${category}.${dec}`;
}

function categoryChoices(scan: VaultScan): CategoryChoice[] {
	return [...scan.categoryFolders.entries()]
		.map(([code, path]) => ({ code, path, label: `${path.split("/").pop()}` }))
		.sort((a, b) => a.code.localeCompare(b.code));
}

/** Category code of a file based on the folder it sits in, if discoverable. */
function categoryOfFile(scan: VaultScan, file: TFile): string | null {
	for (const [code, path] of scan.categoryFolders) {
		const parent = file.parent ? file.parent.path : "";
		if (parent === path || parent.startsWith(path + "/")) return code;
	}
	return null;
}

/**
 * Assign the next free id to the active note. If we can infer the category from
 * the note's folder we use it; otherwise we prompt. Renames + refiles on confirm.
 */
export async function assignNextNumber(app: App, cfg: JdConfig): Promise<void> {
	const file = app.workspace.getActiveFile();
	if (!file) {
		new Notice("JD: open a note first.");
		return;
	}
	const scan = scanVault(app, cfg);

	const proceed = (category: string) => {
		const id = nextId(scan, cfg, category);
		if (!id) {
			new Notice(`JD: category ${category} is full.`);
			return;
		}
		const parsed = parseJdId(id, cfg)!;
		const folder = expectedFolder(scan, parsed) ?? (file.parent ? file.parent.path : "");
		const title = file.basename.replace(/^[0-9.]+\s+/, "");
		const dest = targetPath(folder, id, title);
		new ConfirmModal(
			app,
			"Assign JD number",
			[
				`Category: ${category}`,
				`New id: ${id}`,
				`From: ${file.path}`,
				`To:   ${dest}`,
			],
			`Assign ${id}`,
			async () => {
				try {
					await setJdId(app, file, id);
					if (dest !== file.path) await app.fileManager.renameFile(file, dest);
					new Notice(`JD: assigned ${id}`);
				} catch (e) {
					new Notice(`JD: failed — ${e instanceof Error ? e.message : String(e)}`);
				}
			}
		).open();
	};

	const inferred = categoryOfFile(scan, file);
	if (inferred) proceed(inferred);
	else new CategorySuggestModal(app, categoryChoices(scan), (c) => proceed(c.code)).open();
}

/**
 * Refile the active note so its filename + folder match its jd-id.
 * Optionally leaves a redirect stub at the old path.
 */
export async function refileToMatchId(app: App, cfg: JdConfig, leaveRedirect: boolean): Promise<void> {
	const file = app.workspace.getActiveFile();
	if (!file) {
		new Notice("JD: open a note first.");
		return;
	}
	const scan = scanVault(app, cfg);
	const note = scan.notes.find((n) => n.file.path === file.path);
	if (!note || !note.parsed) {
		new Notice("JD: this note has no valid jd-id.");
		return;
	}
	const id = note.parsed;
	const folder = expectedFolder(scan, id);
	if (!folder) {
		new Notice(`JD: no folder found for category ${id.category}.`);
		return;
	}
	const title = note.title.replace(/^[0-9.]+\s+/, "");
	const dest = targetPath(folder, id.raw, title);
	if (dest === file.path) {
		new Notice("JD: already correctly filed.");
		return;
	}
	const oldPath = file.path;
	new ConfirmModal(
		app,
		"Refile to match jd-id",
		[`id: ${id.raw}`, `From: ${oldPath}`, `To:   ${dest}`, leaveRedirect ? "Leaves a redirect stub." : "No stub."],
		"Refile",
		async () => {
			try {
				await app.fileManager.renameFile(file, dest);
				if (leaveRedirect) {
					const stub =
						`---\njd-id: "${id.raw}"\ntags:\n  - system/redirect\n---\n\nMoved to [[${dest}|${id.raw} ${title}]].\n`;
					await app.vault.create(oldPath, stub);
				}
				new Notice(`JD: refiled ${id.raw}`);
			} catch (e) {
				new Notice(`JD: failed — ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	).open();
}
