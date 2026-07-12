/**
 * Create a new JD category in the active area: walks up from the active
 * note to find the area folder, picks the next free category number,
 * prompts for a name, creates the folder + standard zeros, opens the
 * new index note. Surfaces partial-creation failures.
 */

import { type App, Notice, TFile, TFolder, moment } from "obsidian";
import { TFolder as TFolderClass } from "obsidian";
import { inputPrompt } from "../lib/prompts";
import { createStandardZeros, suffixFor } from "../lib/standard-zeros";

export async function newCategoryCommand(app: App, file: TFile): Promise<void> {
	let areaFolder: TFolder | null = null;
	let folder: TFolder | null = file.parent;
	while (folder && folder.path !== "/") {
		if (/^\d{2}-\d{2}\s/.test(folder.name)) {
			areaFolder = folder;
			break;
		}
		folder = folder.parent;
	}
	if (!areaFolder) {
		new Notice("Could not find an area folder (e.g. '90-99 Technical')");
		return;
	}

	const areaMatch = areaFolder.name.match(/^(\d{2})-(\d{2})\s/);
	if (!areaMatch) return;
	const areaStart = parseInt(areaMatch[1]);
	const areaEnd = parseInt(areaMatch[2]);

	const existingNums = new Set<number>();
	for (const item of app.vault.getAllLoadedFiles()) {
		if (!(item instanceof TFolderClass)) continue;
		if (item.parent !== areaFolder) continue;
		const m = item.name.match(/^(\d{2})\s/);
		if (m) existingNums.add(parseInt(m[1]));
	}

	let nextNum: number | null = null;
	for (let i = areaStart; i <= areaEnd; i++) {
		if (!existingNums.has(i)) { nextNum = i; break; }
	}
	if (nextNum === null) {
		new Notice(`No available category numbers in ${areaFolder.name}`);
		return;
	}

	const name = await inputPrompt(
		app,
		`New category in ${areaFolder.name} (next: ${String(nextNum).padStart(2, "0")})`,
		"Category name"
	);
	if (name === null) return;
	if (!name.trim()) {
		new Notice("Category name cannot be empty");
		return;
	}

	const prefix = String(nextNum).padStart(2, "0");
	const folderName = `${prefix} ${name.trim()}`;
	const folderPath = `${areaFolder.path}/${folderName}`;
	const now = moment().format("YYYY-MM-DDTHH:mm");

	const result = await createStandardZeros(
		app,
		{ path: folderPath, name: folderName },
		prefix,
		now
	);
	if (result.failures.length > 0) {
		const total = result.created + result.skipped + result.failures.length;
		new Notice(
			`Created ${folderName}: ${result.created} new, ${result.skipped} existed, ${result.failures.length}/${total} failed — see console`
		);
		console.warn("[jd] new-category partial:", result.failures);
		return;
	}

	const suffix = suffixFor(prefix);
	const indexPath = `${folderPath}/${prefix}.00 JDex ${suffix}.md`;
	const indexFile = app.vault.getAbstractFileByPath(indexPath);
	if (indexFile instanceof TFile) {
		await app.workspace.getLeaf().openFile(indexFile);
	} else {
		new Notice(`Created ${folderName}, but index file not found at expected path`);
		console.warn("[jd] new-category: expected index file missing", indexPath);
		return;
	}

	new Notice(`Created ${folderName} with standard zeros`);
}
