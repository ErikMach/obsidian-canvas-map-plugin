import {
	Editor,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
	FileSystemAdapter,
	FileManager,
	TFile,
	Menu
} from 'obsidian';
import 	* as obb from 'obsidian';
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

		this.registerEvent(app.workspace.on("active-leaf-change", (leaf) => {
			const canvas = leaf.view.canvas;
			if (!canvas) return;
			if (this.shouldModifyCanvas(canvas)) {
				if (Object.isEmpty(canvas.data)) {
					// only reliable way to await the canvas.nodes being populated
					new Promise((resolve, reject) => {
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
					if (e?.unknownData.subtype === mapPinSubtype) return;
					this.target !== e && (this.target = e, this.render())
				};
			}
		}));

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('map-pin-plus-inside', 'Add Map Pin to Canvas', (_evt: MouseEvent) => {
			// Called when the user clicks the icon.
window.canvas = this.app.workspace.activeLeaf.view.canvas;

			new Notice('Canvas is in window object!');
		});

		// This adds an editor command that can perform some operation on the current editor instance
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

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CanvasMapPinSettingsTab(this.app, this));


		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000),
		);
	}

	onunload() {
		delete window.mapPinSize;
		delete window.mapPinFileNameTemplate;
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

		window.mapPinFileNameTemplate = {
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

		const filename = window.mapPinFileNameTemplate.generateMapPinFilename(name);

		let mapPinTFile = app.vault.getAbstractFileByPath(filename);
		if (!mapPinTFile) {
			try {
				mapPinTFile = await app.vault.create(
					app.fileManager.getNewFileParent(app.workspace.getActiveFile().path).path + filename,
					"Add some info about " + name + "..."
				);
			} catch(e) {
				new Notice(e, 3000);
				return;
			};
		}

		const mapPin = canvas.createFileNode({
                        pos: canvas.pointer,
                        size: { width: mapPinSize, height: mapPinSize },
                        file: mapPinTFile,
                        save: true,
                        focus: false
		});

		Object.assign(mapPin.unknownData, {subtype: mapPinSubtype});

		mapPin.nodeEl.classList.add("cmp-map-pin", "cmp-dragging");
		mapPin.focus = () => {};
		mapPin.blur = () => {};	
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
		// + add status bar text for help 
		const statusBarText = this.addStatusBarText("Click to place the pin on a Map!");

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

		this.registerDomEvent(document, "click", () => {
			controller.abort();
			resetPointer(canvas); // deregister our hijacking
			this.removeStatusBarText(statusBarText);

			const parentMap =  nodes
				.filter(n => n.id !== mapPin.id && imageExts.includes(n.file?.extension) && pointInBox(mapPin.getPoint(), n.getBBox()))
				.sort((e, t) => t.zIndex - e.zIndex)[0];
			if (!parentMap) {
				canvas.removeNode(mapPin);
				return;
			}
			const offsetLeft = (mapPin.x - parentMap.x) / parentMap.width;
			const offsetTop = (mapPin.y - parentMap.y) / parentMap.height;
			Object.assign(mapPin.unknownData, {
				subtype: mapPinSubtype,
				mapPinName: name,
				parent: parentMap.id,
				offsetTop: offsetTop,
				offsetLeft: offsetLeft
			});
			mapPin.nodeEl.classList.remove("cmp-dragging");
			mappinify(mapPin);
			// The following two event listeners need to be registered only for newly created pins
			// don't ask why after mappinify they don't work like every other node... 
			this.registerDomEvent(mapPin.nodeEl, "contextmenu", (e) => {e.preventDefault(); mapPin.onContextMenu(e);}, true);
			this.registerDomEvent(mapPin.nodeEl, "click", (e) => {e.preventDefault(); mapPin.onClick()}, true);
			canvas.requestSave();
		}, {once: true, signal: controller.signal});

		this.registerDomEvent(document, "keydown", ({key}) => {
			if (!["Escape", "Delete", "Backspace"].includes(key)) return;
			controller.abort();
			resetPointer(canvas);
			this.removeStatusBarText(statusBarText);
			canvas.removeNode(mapPin);
		}, {signal: controller.signal});

	}
	addMapPinToCardMenu() {
		// code taken from obsidian's setup for the Canvas Card Menu
		e.createDiv({ cls: "canvas-card-menu-button mod-draggable" }, (function(e) {
			Zg(e, C7.actionDragToAddCard(), { placement: "top" }),
			Ag(e, "lucide-sticky-note"),
			e.addEventListener("click", (function() {
				t.createTextNode({ pos: t.posCenter(), position: "center" })
			})),
			e.addEventListener("pointerdown", (function(e) {
				var n = t.config.defaultTextNodeDimensions;
				t.dragTempNode(e, n, (function(e) {
					t.deselectAll(),
					t.createTextNode({ pos: e, size: n })
				}))
			}))
		}));
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
		this.#input = this.contentEl.createEl("input", {placeholder: "Pin location..."});
		this.setTitle("What's the name of this pin?");
		this.#input.addEventListener("keydown", (e)=>{e.key === "Enter" ? this.close(): {} });
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

function processCanvas(canvas) {
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
	mapPin.onContextMenu = function(e) {
		const menu = new Menu();
/*
  [✓] Swap file
  [✓] Rename file (currently called "Rename...")
  [✓] Reveal file in navigation (allows user to do the rest of the default actions from the file itself)
  [✓] Zoom to selection
  [✓] Remove pin
  [ ] Rename map pin
  [ ] Move Pin
*/

		menu.addItem((item) =>
			item
				.setTitle('Copy')
				.setIcon('documents')
				.onClick(() => {
					new Notice('Copied');
				})
		);

	      menu.showAtMouseEvent(event);
	};
	mapPin.onClick = async function() {
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