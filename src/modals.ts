import { Modal, Setting } from 'obsidian';
import CanvasMapPinPlugin from './main';
import { InternalApp } from './types';

export class MapPinNameModal extends Modal {
	#input: HTMLInputElement | undefined;
	#callback: undefined | ((s: string) => void);
	#plugin: CanvasMapPinPlugin;
	constructor(plugin: CanvasMapPinPlugin) {
		super(plugin.app);
		this.#plugin = plugin;
	}
	onOpen() {
		this.contentEl.classList.add("cmp-map-pin-modal");
		this.setTitle("Map pin name");

		this.#input = this.contentEl.createEl("input", {placeholder: "Pin location...", cls: "cmp-name-input"});
		this.#input.addEventListener("keydown", (e: KeyboardEvent) => e.key === "Enter" ? this.close() : {} );

		this.contentEl.createEl("p", {text: "Pins automatically link to, or create, a file with their generated filename:", cls: ""});
		const output = this.contentEl.createEl("output", { cls: "" });
		this.#input.addEventListener("input", () => {
			output.textContent = this.#input?.value ? this.#plugin.settings.MapPinFilename.generate(this.#input?.value) : "";
		});

		const settingsBtn = this.contentEl.createEl("button", {cls: "cmp-settings-button"});
		settingsBtn.addEventListener("click", () => {
			(this.app as InternalApp).setting.open();
			const settingsTab = (this.app as InternalApp).setting.openTabById("canvas-map-pins");
			window.setTimeout(() => settingsTab.containerEl.children[0]?.classList.add("is-flashing"), 800);
			window.setTimeout(() => settingsTab.containerEl.children[0]?.classList.remove("is-flashing"), 1800);
		});

		new Setting(this.contentEl)
			.addButton(btn => btn
				.setButtonText('Submit')
				.setCta()
				.onClick(() => {
					this.close();
				})
			)
			.addButton(btn => btn
				.setButtonText('Cancel')
				.setClass("mod-cancel")
				.onClick(() => {
					this.cancel();
				})
			);
	}

	cancel() {
		if (this.#input) this.#input.value = "";
		this.close();
	}

	onClose() {
		if (this.#callback && this.#input) { this.#callback(this.#input.value); }
		this.contentEl.empty();
	}

	setValueCallback(callback: (s: string) => void) {
		this.#callback = callback;
		return this;
	}
}
