import { App, PluginSettingTab, Setting } from 'obsidian';
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

		new Setting(containerEl)
			.setName('Map Pin Filename Template String')
			.setDesc("When you name a map pin, it finds or creates a file with the Map Pin filename. This name is generated with the following template string. Note that '%n' is replace with the name.")
			.addText((text) =>
				text
					.setPlaceholder('Enter a file name with "%n" where the name will go')
					.setValue(this.plugin.settings.MapPinFilenameTemplateString)
					.onChange(async (value) => {
						window.mapPinFileNameTemplate.currentTemplateString = value;
						this.plugin.settings.MapPinFilenameTemplateString = value;
						await this.plugin.saveSettings();
					}),
			);
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
}
