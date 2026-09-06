import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import CanvasMapPinPlugin from './main';

export const DEFAULT_SETTINGS = {
	MapPinFilenameTemplateString: "%n",
	MapPinSize: 60,
};

export class CanvasMapPinSettingsTab extends PluginSettingTab {
	plugin: CanvasMapPinPlugin;

	constructor(app: App, plugin: CanvasMapPinPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const setting1 = new Setting(containerEl)
			.setName('Map Pin Filename Template String')
			.setDesc("When you name a map pin, it finds or creates a file with the generated filename. This template string generates the filename. All occurrences of '%n' are replaced with the name.");
		setting1.descEl.createEl("p", {text: "Here's an example for a pin called 'Gondor':"});
		setting1.descEl.createEl("br");
		const output = setting1.descEl.createEl("output", {text: "Gondor.md"});
		setting1.addText((text) => {
				text
					.setPlaceholder('Enter a file name with "%n" where the name will go')
					.setValue(this.plugin.settings.MapPinFilenameTemplateString)
					.onChange(async (value) => {
						if (!this.isValidFilename(value)) {
							new Notice("Invalid filename. Avoid using: \\ / : * ? \" < > |", 3000)
								.noticeEl.addClass("mod-warning");
							return;
						}
						const newValue = value || "%n";
						window.mapPinFilenameTemplate.currentTemplateString = newValue;
						this.plugin.settings.MapPinFilenameTemplateString = newValue;
						await this.plugin.saveSettings();
						output.textContent = window.mapPinFilenameTemplate.generateMapPinFilename("Gondor");
					});
			});

		new Setting(containerEl)
			.setName('Map Pin Size')
			.setDesc("How big you want your map pins?")
			.addSlider((slider) =>
				slider
					.setLimits(40, 400, 10)
					.setValue(this.plugin.settings.MapPinSize)
					.onChange(async (value) => {
						window.mapPinSize = value;
						this.plugin.settings.MapPinSize = value;
						await this.plugin.saveSettings();
					}),
			);
	}
	isValidFilename(filename: string): boolean {
		const regex = /^[^\\/:*?"<>|]+$/;
		return regex.test(filename);
	}
}


