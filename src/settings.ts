import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
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

	renderFilenameSetting(setting: Setting): void {
		const exampleLocation = 'Gondor';
		setting.descEl.createEl("p", {text: `Here's an example for a pin called '${exampleLocation}':`});
		setting.descEl.createEl("br");
		const output = setting.descEl.createEl("output", {text: this.plugin.settings.MapPinFilename.generate(exampleLocation) });
		setting.addText(text => text
			.setPlaceholder("Enter a file name with '%n' where the name will go")
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
				output.textContent = this.plugin.settings.MapPinFilename.generate(exampleLocation);
			})
		);
	}

	getSettingDefinitions() {
		return [
			{
				name: 'Map pin filename template',
				desc: 'When you name a map pin, it finds or creates a file with the generated filename. This template string generates the filename. All occurrences of "%n" are replaced with the name.',
				render: this.renderFilenameSetting.bind(this)
			},
			{
				name: 'Map pin size',
				desc: 'How big you want your map pins?',
				control: {
					type: 'slider',
					key: 'MapPinSize',
					defaultValue: 60,
					min: 40,
					max: 400,
					step: 10
				}
			}
		];
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const filenameSetting = new Setting(containerEl)
			.setName('Map pin filename template')
			.setDesc("When you name a map pin, it finds or creates a file with the generated filename. This template string generates the filename. All occurrences of '%n' are replaced with the name.");
		this.renderFilenameSetting(filenameSetting);

		new Setting(containerEl)
			.setName('Map pin size')
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

	isValidFilename(filename: string): boolean {
		const regex = /^[^\\/:*?"<>|]+$/;
		return regex.test(filename);
	}
}


