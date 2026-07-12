/**
 * Create the standard `XX.00`–`XX.09` notes in the current category folder,
 * skipping any that already exist. Active note must live inside a JD
 * category folder (basename starts with `XX `). Per-zero failures are
 * surfaced via the Notice and console.
 */

import { type App, Notice, TFile, TFolder, moment } from "obsidian";
import { createStandardZeros } from "../lib/standard-zeros";

export async function standardZerosCommand(app: App, file: TFile): Promise<void> {
	const folder = file.parent;
	if (!folder) {
		new Notice("File has no parent folder");
		return;
	}
	const folderMatch = folder.name.match(/^(\d{2})\s/);
	if (!folderMatch) {
		new Notice("Current folder doesn't look like a JD category");
		return;
	}
	const prefix = folderMatch[1];
	const now = moment().format("YYYY-MM-DDTHH:mm");
	const result = await createStandardZeros(app, folder as TFolder, prefix, now);
	const failPart = result.failures.length > 0
		? ` · ${result.failures.length} failed (see console)`
		: "";
	new Notice(`Created ${result.created}, skipped ${result.skipped} existing${failPart}`);
	if (result.failures.length > 0) {
		console.warn("[jd] standard-zeros failures:", result.failures);
	}
}
