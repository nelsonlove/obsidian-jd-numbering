import { App, FuzzySuggestModal, Modal, Setting } from "obsidian";

export interface CategoryChoice {
	code: string;
	path: string;
	label: string;
}

export class CategorySuggestModal extends FuzzySuggestModal<CategoryChoice> {
	private items: CategoryChoice[];
	private onChoose: (c: CategoryChoice) => void;

	constructor(app: App, items: CategoryChoice[], onChoose: (c: CategoryChoice) => void) {
		super(app);
		this.items = items;
		this.onChoose = onChoose;
		this.setPlaceholder("Pick the category for this note…");
	}

	getItems(): CategoryChoice[] {
		return this.items;
	}
	getItemText(item: CategoryChoice): string {
		return item.label;
	}
	onChooseItem(item: CategoryChoice): void {
		this.onChoose(item);
	}
}

export class ConfirmModal extends Modal {
	private title: string;
	private bodyLines: string[];
	private ctaText: string;
	private onConfirm: () => void;

	constructor(app: App, title: string, bodyLines: string[], ctaText: string, onConfirm: () => void) {
		super(app);
		this.title = title;
		this.bodyLines = bodyLines;
		this.ctaText = ctaText;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });
		for (const line of this.bodyLines) {
			contentEl.createEl("div", { text: line, cls: "jd-confirm-line" });
		}
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText(this.ctaText)
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
