import {
	Modal,
	Setting,	
	Notice,
	Plugin,
	Menu,
	TFile,
	WorkspaceLeaf
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	CanvasMapPinSettingsTab,
} from './settings';

export default class CanvasMapPinPlugin extends Plugin {
	settings!;

	async onload() {
		await this.loadSettings();

		window.mapPinSubtype = "map-pin";

		this.registerEvent(app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf) => {
			const canvas = leaf.view.canvas;
			if (!canvas) return;
			if (this.shouldModifyCanvas(canvas)) {
				if (Object.isEmpty(canvas.data)) {
					// only reliable way to await the canvas.nodes being populated
					void new Promise((resolve, reject) => {
						let data = canvas.data;
						Object.defineProperty(canvas, "data", {
							get() { return data; },
							set(d) { d.nodes ? resolve() : {}; data=d; }
						});
					}).then(() => {
						modifyCanvasMapPins(canvas);
						// reset the data property
						Object.defineProperty(canvas, "data", {
							value: canvas.data,
							writable: true,
							configurable: true,
							enumerable: true
						});
					});
				} else {
					modifyCanvasMapPins(canvas)
				}
				// stop the nodeInteractionLayer from being placed over map pins
				canvas.nodeInteractionLayer.setTarget = function (e) {
					if (e?.unknownData.subtype === mapPinSubtype || canvas.dragginPin) return;
					this.target !== e && (this.target = e, this.render())
				};
			}
		}));

		this.addCommand({
			id: 'add-canvas-map-pin',
			name: 'Add a Map Pin on a Canvas',
			repeatable: false,
			icon: 'map-pin-plus-inside',
			hotkeys: [{key: 'M', modifiers: ['Ctrl']}],
			checkCallback: async (checking: boolean) => {
				const canvasView = this.app.workspace.activeLeaf.view.getViewType() === 'canvas';
				if (canvasView) {
					if (!checking) {
						const name = await this.getPinName();
						if (name) {
							await this.addMapPin(name);
						}
					}
					return true;
				}
				return false;
			},
		});

		this.addSettingTab(new CanvasMapPinSettingsTab(this.app, this));

	}

	onunload() {
		delete window.mapPinSize;
		delete window.mapPinFilenameTemplate;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);

		let mapPinSize = 0;
		Object.defineProperty(window, "mapPinSize", {
			get() { return mapPinSize; },
			set(v) {
				mapPinSize = v;
				document.documentElement.style.setProperty("--map-pin-size", v + "px");
/*
 * This code will render any canvases that have map pins if in view, whether focussed or not.
 * however, it causes canvases being loaded alongside this plugin (i.e. on normal start up) to throw an error since their data hasn't loaded yet.
 *  
				const canvases = [];
				this.app.workspace.iterateAllLeaves(leaf => {
					if (leaf.width && leaf.view.canvas) {
						canvases.push(leaf.view.canvas);
					}
				});
				if (canvases.length) canvases.forEach(canvas => processCanvas(canvas));
*/
			},
			configurable: true,
		});
		window.mapPinSize = this.settings.MapPinSize; // induce side effect of setting CSS :root variable and modifying any open canvases

		window.mapPinFilenameTemplate = {
			currentTemplateString: this.settings.MapPinFilenameTemplateString,
			generateMapPinFilename: function(name) {
				return (this.currentTemplateString + ".md").split("%n").join(name);
			}
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	addStatusBarText(text) {
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(text);
		return statusBarItemEl;
	}
	removeStatusBarText(el) {
		el.remove();
	}
	async getPinName() {
		return new Promise((resolve, reject) => {
			new MapPinNameModal(this.app)
				.setValueCallback(value => resolve(value))
				.open();
		});
	}
	async addMapPin(name) {
		// Add "Map Pin" media to Canvas
		const canvas = this.app.workspace.activeLeaf.view.canvas;

		const filename = window.mapPinFilenameTemplate.generateMapPinFilename(name);

		let mapPinTFile = app.vault.getFileByPath(filename);
		let fileCreated;
		if (!mapPinTFile) {
			try {
				mapPinTFile = await app.vault.create(
					app.fileManager.getNewFileParent(app.workspace.getActiveFile().path).path + filename,
					"Add some info about " + name + "..."
				);
				fileCreated = true;
			} catch(e) {
				new Notice(e, 3000);
				return;
			};
		} else {
			fileCreated = false;
		}

		const mapPin = canvas.createFileNode({
                        pos: canvas.pointer,
                        size: { width: mapPinSize, height: mapPinSize },
                        file: mapPinTFile,
                        save: true,
                        focus: false
		});

		Object.assign(mapPin.unknownData, {
			subtype: mapPinSubtype,
			mapPinName: name
		});

		mapPin.nodeEl.classList.add("cmp-map-pin");

		dragPin(mapPin, false, fileCreated);

	}
	shouldModifyCanvas(canvas) {
		// modify if...
		return (
			// ...canvas has no nodes (initialised for 1st time)
			!canvas.nodes.size ||
			(
				// ...or it has been initialised and...
				canvas.nodes.size &&
				// ...it contains map pins and...
				canvas.nodes.values().find(node => node.unknownData.subtype === window.mapPinSubtype) &&
				// ...the map pins haven't been initialised.
				canvas.nodes.values().find(node => node.unknownData.subtype === window.mapPinSubtype && !node.mapPinned)
			)
		);
	}
}

class MapPinNameModal extends Modal {
	#input;
	#callback;
	onOpen() {
		this.contentEl.classList.add("cmp-map-pin-modal");
		this.setTitle("Map Pin Name");
		this.#input = this.contentEl.createEl("input", {placeholder: "Pin location...", cls: "cmp-name-input"});
		this.#input.addEventListener("keydown", (e)=>{e.key === "Enter" ? this.close() : {} });
		this.contentEl.createEl("p", {text: "Pins automatically link to, or create, a file with their generated filename:", cls: ""});
		const output = this.contentEl.createEl("output", { cls: "" });
		this.#input.addEventListener("input", () => {
			output.textContent = this.#input.value ? window.mapPinFilenameTemplate.generateMapPinFilename(this.#input.value) : "";
		});
		const settingsBtn = this.contentEl.createEl("button", {cls: "cmp-settings-button"});
		settingsBtn.addEventListener("click", () => {
			app.setting.open();
			const settingsTab = app.setting.openTabById("canvas-map-pins");
			window.setTimeout(() => settingsTab.containerEl.children[0].classList.add("is-flashing"), 800);
			window.setTimeout(() => settingsTab.containerEl.children[0].classList.remove("is-flashing"), 1800);
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
					this.#input.value = "";
					this.close();
				})
			);
	}

	onClose() {
		if (this.#callback) { this.#callback(this.#input.value); }
		this.contentEl.empty();
	}

	setValueCallback(callback) {
		this.#callback = callback;
		return this;
	}
}

class InterceptedSet extends Set {
	constructor(data) {
		super(data);
	}
	add(v) {
		if (v.unknownData.subtype !== window.mapPinSubtype) {
			super.add(v);
		}
	}
}

function dragPin(mapPin: TFile, returnToInitialPos, deleteFileOnNullDrop) {
	const canvas = mapPin.canvas;
	canvas.draggingPin = true;

	const initialPos = returnToInitialPos ? {x: mapPin.x, y: mapPin.y} : null;

		mapPin.nodeEl.classList.add("cmp-dragging");
		mapPin.getPoint = function() {return {x: this.x, y: this.y}};
		const imageExts = [
			"svg",
			"jpg",
			"jpeg",
			"png",
			"webp",
			"avif",
			"heic"
		];

		// Let it track cursor and be subject to drag dead zones until click

		// canvas.pointer is modified "onPointerMove", so making it an accessor prop
		// allows us to define the new mapPin[x&y] by hijacking their eventListener
		const pointInBox = (point, bBox) => {
			return bBox.minX <= point.x && bBox.minY <= point.y && bBox.maxX >= point.x && bBox.maxY >= point.y;
		};
		// canvas.nodeIndex.data.children are sometimes [TFile] and sometimes [{children:[TFile]}]
		const nodes = canvas.nodeIndex.data.children.flatMap(obj => obj.children ? obj.children : obj);
		const dropZones = nodes
			.filter(n => n.id !== mapPin.id && imageExts.includes(n.file?.extension))
			.sort((e, t) => t.zIndex - e.zIndex)
			.map(t => t.getBBox());

		if (!dropZones.find(z => pointInBox(mapPin.getPoint(), z))) {mapPin.nodeEl.classList.add("cmp-no-drop");}


		let pointerValue = {x:0, y:0};
		let lastCollision = false;
		Object.defineProperty(canvas, "pointer", {
			get() {	return pointerValue; },
			set(v) {
				pointerValue = v;
				mapPin.x = Math.round(v.x);
				mapPin.y = Math.round(v.y);
				this.markMoved(mapPin);  // rerenders just this element in next frame ...I assume

				const collision = dropZones.find(z => pointInBox(mapPin.getPoint(), z));
				if (collision && !lastCollision) {
					mapPin.nodeEl.classList.remove("cmp-no-drop");
					lastCollision = true;
				} else if (!collision && lastCollision) {
					mapPin.nodeEl.classList.add("cmp-no-drop");
					lastCollision = false;
				}
			},
		});

		const resetPointer = (canvas) => {
			const lastPointerValue = canvas.pointer;
			delete canvas.pointer;
			canvas.pointer = lastPointerValue;
		};

		const controller = new AbortController();

		document.addEventListener("click", (e) => {
			controller.abort();
			delete canvas.draggingPin;

			const parentMap =  nodes
				.filter(n => n.id !== mapPin.id && imageExts.includes(n.file?.extension) && pointInBox(mapPin.getPoint(), n.getBBox()))
				.sort((e, t) => t.zIndex - e.zIndex)[0];
			if (!parentMap) {
				if (initialPos) {
					canvas.pointer = initialPos;	
				} else {
					canvas.removeNode(mapPin);
					canvas.requestSave();
					if (deleteFileOnNullDrop) {
						canvas.app.vault.delete(mapPin.file);
					}
				}
				resetPointer(canvas); // deregister our hijacking
				return;
			}
			resetPointer(canvas); // deregister our hijacking
			const offsetLeft = (mapPin.x - parentMap.x) / parentMap.width;
			const offsetTop = (mapPin.y - parentMap.y) / parentMap.height;
			Object.assign(mapPin.unknownData, {
				parent: parentMap.id,
				offsetTop: offsetTop,
				offsetLeft: offsetLeft
			});
			mapPin.nodeEl.classList.remove("cmp-dragging");
			mappinify(mapPin);
			canvas.requestSave();
		}, {once: true, signal: controller.signal});

		document.addEventListener("keydown", ({key}) => {
			if (!["Escape", "Delete", "Backspace"].includes(key)) return;
			controller.abort();
			delete canvas.draggingPin;
			if (initialPos) {
				canvas.pointer = initialPos;	
			} else {
				if (deleteFileOnNullDrop) {
					canvas.app.vault.delete(mapPin.file);
				}
				canvas.removeNode(mapPin);
			}
			resetPointer(canvas);
			canvas.requestSave();
		}, {signal: controller.signal});
}

function _processCanvas(canvas) {
	modifyCanvasMapPins(canvas);
	// stop the nodeInteractionLayer from being placed over map pins
	canvas.nodeInteractionLayer.setTarget = function (e) {
		if (e?.unknownData.subtype === window.mapPinSubtype) return;
		this.target !== e && (this.target = e, this.render())
	};
}

function modifyCanvasMapPins(canvas) {
	canvas
		.nodes
		.values()
		.filter(node => node.unknownData.subtype === window.mapPinSubtype)
		.forEach(pin => mappinify(pin));
	// stop the selection menu from coming up on map pins
	// only needed for newly created map pins
	canvas.selection = new InterceptedSet( canvas.selection.values().toArray() );
}

function mappinify(mapPin: Tfile) {
	mapPin.width = window.mapPinSize;
	mapPin.height = window.mapPinSize;
	mapPin.canvas.markMoved(mapPin);
	mapPin.nodeEl.classList.add("cmp-map-pin");
	mapPin.nodeEl.dataset.mapPinName = mapPin.unknownData.mapPinName;
	mapPin.focus = () => {};
	mapPin.blur = () => {};
	// The following two event listeners need to be registered only for newly created pins
	// and pins that the canvas randomly decides don't get their own onClick and onContextMenu
	mapPin.nodeEl.addEventListener("contextmenu", (e) => {e.preventDefault(); mapPin.onContextMenu(e);}, true);
	mapPin.nodeEl.addEventListener("click", (e) => {e.preventDefault(); mapPin.onClick()}, true);

	mapPin.onContextMenu = function(e) {
		if (this.contextMenuOpen) return;
		this.contextMenuOpen = true;
		const menu = new Menu();
/*
  [ ] Swap file		arrow-left-right
  [x] Rename file (currently called "Rename...")	pen-line
  [x] Reveal file in navigation (allows user to do the rest of the default actions from the file itself)	folder-open

  [x] Zoom to selection		zoom-to-selection
  [ ] Move Pin			move | hand
  [ ] Rename map pin		map-pin-pen

  [x] Remove pin		trash-2 | map-pin-off | map-pin-minus | map-pin-x | map-pin-x-inside (red)

*/



		if (this.file) {
/* TODO
			menu.addItem((item) =>
				item
					.setTitle('Swap file...')
					.setIcon('arrow-left-right')
					.onClick(() => {
						// TODO
					})
			);
*/
			menu.addItem((item) =>
				item
					.setTitle('Rename file...')
					.setIcon('pen-line')
					.onClick(() => {
						app.fileManager.promptForFileRename(mapPin.file);
					})
			);
		} else {
			// add file
		}

		menu.addItem((item) =>
			item
				.setTitle('Reveal file in navigation')
				.setIcon('folder-open')
				.onClick(() => {
					app.internalPlugins.plugins["file-explorer"].instance.revealInFolder(mapPin.file);
				})
		);


		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle('Zoom to selection')
				.setIcon('zoom-to-selection')
				.onClick(() => {
					mapPin.canvas.zoomToBbox(this.getBBox());
				})
		);

		menu.addItem((item) =>
			item
				.setTitle('Move pin')
				.setIcon('move')
				.onClick((e) => {
					e.stopPropagation(); // stop the current click from immediately placing the pin
					dragPin(mapPin, true);
				})
		);

/* Just delete the pin a create a new on ffs
		menu.addItem((item) =>
			item
				.setTitle('Rename pin')
				.setIcon('map-pin-pen')
				.onClick(() => {
					app.fileManager.promptForFileRename(this.file);
				})
		);
*/
		menu.addSeparator();

		// doesn't handle map pin rerendering if user uses "undo" after deletion
		menu.addItem((item) =>
			item
				.setTitle('Remove pin')
				.setIcon('map-pin-x')
				.setWarning(true)
				.onClick(() => {
					mapPin.canvas.removeNode(mapPin);
					mapPin.canvas.requestSave();
				})
		);


		menu.onunload = () => {mapPin.contextMenuOpen = false};

		menu.showAtMouseEvent(e);
	};
	mapPin.onClick = async function() {
		if (this.clicked || this.canvas.draggingPin) return;
		this.clicked = true;
		window.setTimeout(() => {mapPin.clicked = false}, 0);

		const openPreview = app.workspace
			.leftSplit
			.children
			.filter(section => section.type === "tabs")[0]
			.children
			.filter(leaf => leaf.view.file?.name === mapPin.filePath)[0];
		if (openPreview) {
			await app.workspace.revealLeaf(openPreview);
			return;
		}
		const preview = app.workspace.getLeftLeaf(false);
		preview.setViewState({
			type: 'markdown',
			state: {
				active: true,
				mode: "source",
				file: mapPin.filePath,
			},
		});
		app.workspace.setActiveLeaf(preview);
	};

	mapPin.mapPinned = true;
	const parent = mapPin.canvas.nodes.get(mapPin.unknownData.parent);
	if (parent.childMapPins) {
		parent.childMapPins.add(mapPin);
		return;
	}
	Object.defineProperty(parent, "childMapPins", {value: new Set([mapPin])});
	let {x, y, width, height, renderedZIndex} = parent;
	Object.defineProperty(parent, "x", {
		get() {return x;},
		set(n) {
			if (x===n) return;
			this.childMapPins.forEach(c => {
				c.x += n - x;
				this.canvas.markMoved(c);
			});
			x=n;
		}
	});
	Object.defineProperty(parent, "y", {
		get() {return y;},
		set(n) {
			if (y===n) return;
			this.childMapPins.forEach(c => {
				c.y += n - y;
				this.canvas.markMoved(c);
			});
			y=n;
		}
	});
	Object.defineProperty(parent, "width", {
		get() {return width;},
		set(n) {
			if (width === n) return;
			this.childMapPins.forEach(c => {
				c.x = c.unknownData.offsetLeft * n + parent.x;
				this.canvas.markMoved(c);
			});
			width = n;
		}
	});
	Object.defineProperty(parent, "height", {
		get() {return height;},
		set(n) {
			if (height === n) return;
			this.childMapPins.forEach(c => {
				c.y = c.unknownData.offsetTop * n + parent.y;
				this.canvas.markMoved(c);
			});
			height = n;
		}
	});
	Object.defineProperty(parent, "renderedZIndex", {
		get() {return renderedZIndex;},
		set(n) {
			if (renderedZIndex === n) return;
			this.childMapPins.forEach(c => {
				c.zIndex = n + 1;
				c.renderZIndex();
			});
			renderedZIndex = n;
		}
	});
};