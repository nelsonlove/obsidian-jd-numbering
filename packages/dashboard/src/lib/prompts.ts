/**
 * Modal-based replacements for QuickAdd's interactive prompts.
 *
 * - `inputPrompt` — single-line text input. Resolves to the entered string,
 *   or `null` on cancel/dismiss (Esc, click-away, Cancel button).
 * - `confirmPrompt` — yes/no question. Resolves to `true` for Yes, `false`
 *   for No, `null` for cancel/dismiss. Callers should distinguish No from
 *   cancel where it matters (e.g. renumber's auto-displace prompt).
 */

import { App, Modal, Setting } from "obsidian";

export function inputPrompt(
	app: App,
	title: string,
	placeholder = "",
	defaultValue = ""
): Promise<string | null> {
	return new Promise((resolve) => {
		new InputPromptModal(app, title, placeholder, defaultValue, resolve).open();
	});
}

export function confirmPrompt(
	app: App,
	title: string,
	message: string
): Promise<boolean | null> {
	return new Promise((resolve) => {
		new ConfirmPromptModal(app, title, message, resolve).open();
	});
}

class InputPromptModal extends Modal {
	private value: string;
	private resolved = false;

	constructor(
		app: App,
		private title: string,
		private placeholder: string,
		defaultValue: string,
		private resolveFn: (v: string | null) => void
	) {
		super(app);
		this.value = defaultValue;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });

		new Setting(contentEl).addText((text) => {
			text.setPlaceholder(this.placeholder)
				.setValue(this.value)
				.onChange((v) => {
					this.value = v;
				});
			text.inputEl.style.width = "100%";
			text.inputEl.focus();
			text.inputEl.select();
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					this.submit();
				}
			});
		});

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText("OK").setCta().onClick(() => this.submit()))
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	private submit(): void {
		this.resolved = true;
		this.resolveFn(this.value);
		this.close();
	}

	onClose(): void {
		if (!this.resolved) this.resolveFn(null);
		this.contentEl.empty();
	}
}

class ConfirmPromptModal extends Modal {
	private answer: boolean | null = null;

	constructor(
		app: App,
		private title: string,
		private message: string,
		private resolveFn: (v: boolean | null) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Yes").setCta().onClick(() => this.respond(true))
			)
			.addButton((btn) => btn.setButtonText("No").onClick(() => this.respond(false)));
	}

	private respond(value: boolean): void {
		this.answer = value;
		this.close();
	}

	onClose(): void {
		// Resolves to null if user dismissed without clicking Yes/No; this
		// distinguishes "cancel" from an explicit "No" — important for
		// flows like renumber that branch on the response.
		this.resolveFn(this.answer);
		this.contentEl.empty();
	}
}
