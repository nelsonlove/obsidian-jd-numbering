/**
 * Quick ID navigation — command palette fuzzy search by JD ID and title.
 *
 * "JD: Go to ID" opens a suggester where you type "26.11" or "restraining"
 * and it jumps to the matching note.
 */

import { type App, SuggestModal, TFile } from "obsidian";

const ID_RE = /^(\d{2}\.\d{2}|\d{5})\s+(.+)$/;

interface JDNoteMatch {
	id: string;
	title: string;
	file: TFile;
}

export class GoToIdModal extends SuggestModal<JDNoteMatch> {
	private notes: JDNoteMatch[];

	constructor(app: App) {
		super(app);
		this.notes = this.buildIndex();
		this.setPlaceholder("Type a JD ID or title...");
	}

	private buildIndex(): JDNoteMatch[] {
		const results: JDNoteMatch[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const match = ID_RE.exec(file.basename);
			if (match) {
				results.push({
					id: match[1],
					title: match[2],
					file,
				});
			}
		}
		results.sort((a, b) => a.id.localeCompare(b.id));
		return results;
	}

	getSuggestions(query: string): JDNoteMatch[] {
		const q = query.toLowerCase().trim();
		if (!q) return this.notes;

		return this.notes.filter(
			(n) =>
				n.id.includes(q) ||
				n.title.toLowerCase().includes(q)
		);
	}

	renderSuggestion(item: JDNoteMatch, el: HTMLElement): void {
		const row = el.createDiv({ cls: "jd-goto-row" });
		row.createSpan({ text: item.id, cls: "jd-goto-id" });
		row.createSpan({ text: item.title, cls: "jd-goto-title" });
	}

	onChooseSuggestion(item: JDNoteMatch): void {
		this.app.workspace.openLinkText(item.file.path, "");
	}
}
