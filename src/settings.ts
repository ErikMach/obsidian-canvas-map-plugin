import { App, requireApiVersion, PluginSettingTab, Setting, Notice } from 'obsidian';
import CanvasMapPinPlugin from './main';

export interface CanvasMapPinSettings {
	MapPinFilename: {
		template: string,
		generate: (name: string) => string
	};
	MapPinSize: number;
}

export const DEFAULT_SETTINGS: CanvasMapPinSettings = {
	MapPinFilename: {
		template: "%n",
		generate: function(name: string): string {
			return this.template.replaceAll("%n", name).concat(".md");
		}
	},
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
					.setValue(this.plugin.settings.MapPinFilename.template)
					.onChange(async (value: string) => {
						if (!this.isValidFilename(value)) {
							const message: string = "Invalid filename. Avoid using: \\ / : * ? \" < > |";
							new Notice(message, 3000)
								.messageEl
								.addClass("mod-warning");
							return;
						}
						const newValue: string = value || "%n";
						this.plugin.settings.MapPinFilename.template = newValue;
						await this.plugin.saveSettings();
						output.textContent = this.plugin.settings.MapPinFilename.generate("Gondor");
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
						this.plugin.settings.MapPinSize = value;
						await this.plugin.saveSettings();
					}),
			);
	}
/*... for another time	
	getSettingDefinitions() {
		return [
			{
				
				key: "Map Pin Filename Template String",
				control: {
					type: "text",
					key: "filename",
					placeholder: "Enter a filename with '%n' where the name will go"
				}
			},
			{
				name: "Map Pin Size",
				control: {
					type: "slider",
					key: "size",
					min: 40,
					max: 400,
					step: 10
				}
			}
		];
	}
*/
	isValidFilename(filename: string): boolean {
		const regex = /^[^\\/:*?"<>|]+$/;
		return regex.test(filename);
	}
}


