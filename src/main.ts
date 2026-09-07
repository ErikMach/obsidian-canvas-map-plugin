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
	CanvasMapPinSettings,
	CanvasMapPinSettingsTab,
} from './settings';

type Point = { x: number; y: number };
type BBox = { minX: number; maxX: number, minY: number , maxY: number };


export default class CanvasMapPinPlugin extends Plugin {
	settings!: CanvasMapPinSettings;

	async onload() {
		await this.loadSettings();

		(window as any).mapPinSubtype = "map-pin";

		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
			const canvas = (leaf?.view as any).canvas;
			if (!canvas) return;
			if (this.shouldModifyCanvas(canvas)) {
				if (Object.isEmpty(canvas.data)) {
					// only reliable way to await the canvas.nodes being populated
					void new Promise<void>((resolve, reject) => {
						let data = canvas.data;
						Object.defineProperty(canvas, "data", {
							get() { return data; },
							set(d: any) { d.nodes ? resolve() : {}; data=d; }
						});
					}).then(() => {
						this.modifyCanvasMapPins(canvas);
						// reset the data property
						Object.defineProperty(canvas, "data", {
							value: canvas.data,
							writable: true,
							configurable: true,
							enumerable: true
						});
					});
				} else {
					this.modifyCanvasMapPins(canvas)
				}
				// stop the nodeInteractionLayer from being placed over map pins
				canvas.nodeInteractionLayer.setTarget = function (e: any) {
					if (e?.unknownData.subtype === (window as any).mapPinSubtype || canvas.dragginPin) return;
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
			checkCallback: (checking: boolean) => {
				const canvasView = this.app.workspace.activeLeaf?.view.getViewType() === 'canvas';
				if (canvasView) {
					if (!checking) {
						(async () => {
							const name: string = await this.getPinName();
							if (name) {
								await this.addMapPin(name);
							}
						})();
					}
					return true;
				}
				return false;
			},
		});

		this.addSettingTab(new CanvasMapPinSettingsTab(this.app, this));

	}

	onunload() {
		delete (window as any).mapPinSize;
		delete (window as any).mapPinFilenameTemplate;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<CanvasMapPinSettings>,
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
		(window as any).mapPinSize = this.settings.MapPinSize; // induce side effect of setting CSS :root variable and modifying any open canvases

		(window as any).mapPinFilenameTemplate = {
			currentTemplateString: this.settings.MapPinFilenameTemplateString,
			generateMapPinFilename: function(name: string) {
				return (this.currentTemplateString + ".md").split("%n").join(name);
			}
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	addStatusBarText(text: string) {
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(text);
		return statusBarItemEl;
	}
	removeStatusBarText(el: HTMLElement) {
		el.remove();
	}
	async getPinName(): Promise<string> {
		return new Promise((resolve, reject) => {
			new MapPinNameModal(this.app)
				.setValueCallback(value => resolve(value))
				.open();
		});
	}
	async addMapPin(name: string) {
		// Add "Map Pin" media to Canvas
		const canvas = (this.app.workspace.activeLeaf?.view as any).canvas;

		const filename = (window as any).mapPinFilenameTemplate.generateMapPinFilename(name);

		let mapPinTFile: TFile | null = this.app.vault.getFileByPath(filename);
		let fileCreated;
		if (!mapPinTFile) {
			try {
				mapPinTFile = await this.app.vault.create(
					this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path || "./").path + filename,
					"Add some info about " + name + "..."
				);
				fileCreated = true;
			} catch(e: any) {
				new Notice(e, 3000);
				return;
			};
		} else {
			fileCreated = false;
		}

		const mapPin = canvas.createFileNode({
                        pos: canvas.pointer,
                        size: { width: (window as any).mapPinSize, height: (window as any).mapPinSize },
                        file: mapPinTFile,
                        save: true,
                        focus: false
		});

		Object.assign(mapPin.unknownData, {
			subtype: (window as any).mapPinSubtype,
			mapPinName: name
		});

		mapPin.nodeEl.classList.add("cmp-map-pin");

		this.dragPin(mapPin, false, fileCreated);

	}
	shouldModifyCanvas(canvas: any) {
		// modify if...
		return (
			// ...canvas has no nodes (initialised for 1st time)
			!canvas.nodes.size ||
			(
				// ...or it has been initialised and...
				canvas.nodes.size &&
				// ...it contains map pins and...
				canvas.nodes.values().find((node: any) => node.unknownData.subtype === (window as any).mapPinSubtype) &&
				// ...the map pins haven't been initialised.
				canvas.nodes.values().find((node: any) => node.unknownData.subtype === (window as any).mapPinSubtype && !node.mapPinned)
			)
		);
	}
	dragPin(mapPin: any, returnToInitialPos: boolean, deleteFileOnNullDrop: boolean | undefined) {
		const canvas = mapPin.canvas;
		canvas.draggingPin = true;

		const initialPos = returnToInitialPos ? {x: mapPin.x, y: mapPin.y} : null;

		mapPin.nodeEl.classList.add("cmp-dragging");
		mapPin.getPoint = function(): Point {return {x: this.x, y: this.y}};
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
		const pointInBox = (point: Point, bBox: BBox) => {
			return bBox.minX <= point.x && bBox.minY <= point.y && bBox.maxX >= point.x && bBox.maxY >= point.y;
		};
		// canvas.nodeIndex.data.children are sometimes [any] and sometimes [{children:[any]}]
		const nodes = canvas.nodeIndex.data.children.flatMap((obj: any) => obj.children ? obj.children : obj);
		const dropZones = nodes
			.filter((n: any) => n.id !== mapPin.id && imageExts.includes(n.file?.extension))
			.sort((e: any, t: any) => t.zIndex - e.zIndex)
			.map((t: any) => t.getBBox());

		if (!dropZones.find((z: BBox) => pointInBox(mapPin.getPoint(), z))) {mapPin.nodeEl.classList.add("cmp-no-drop");}

		let pointerValue: Point = {x:0, y:0};
		let lastCollision: boolean = false;
		Object.defineProperty(canvas, "pointer", {
			get() {	return pointerValue; },
			set(v: Point) {
				pointerValue = v;
				mapPin.x = Math.round(v.x);
				mapPin.y = Math.round(v.y);
				this.markMoved(mapPin);  // rerenders just this element in next frame ...I assume

				const collision = dropZones.find((z: BBox) => pointInBox(mapPin.getPoint(), z));
				if (collision && !lastCollision) {
					mapPin.nodeEl.classList.remove("cmp-no-drop");
					lastCollision = true;
				} else if (!collision && lastCollision) {
					mapPin.nodeEl.classList.add("cmp-no-drop");
					lastCollision = false;
				}
			},
		});

		const resetPointer = (canvas: any) => {
			const lastPointerValue = canvas.pointer;
			delete canvas.pointer;
			canvas.pointer = lastPointerValue;
		};

		const controller = new AbortController();

		document.addEventListener("click", (e: Event) => {
			controller.abort();
			delete canvas.draggingPin;

			const parentMap =  nodes
				.filter((n: any) => n.id !== mapPin.id && imageExts.includes(n.file?.extension) && pointInBox(mapPin.getPoint(), n.getBBox()))
				.sort((e: any, t: any) => t.zIndex - e.zIndex)[0];
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
			this.mappinify(mapPin);
			canvas.requestSave();
		}, {once: true, signal: controller.signal});

		document.addEventListener("keydown", ({key}: KeyboardEvent) => {
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

	modifyCanvasMapPins(canvas: any) {
		canvas
			.nodes
			.values()
			.filter((node: any) => node.unknownData.subtype === (window as any).mapPinSubtype)
			.forEach((pin: any) => { this.mappinify(pin)});
		// stop the selection menu from coming up on map pins
		// only needed for newly created map pins
		canvas.selection = new InterceptedSet( canvas.selection.values().toArray() );
	}

	mappinify(mapPin: any) {
		mapPin.width = (window as any).mapPinSize;
		mapPin.height = (window as any).mapPinSize;
		mapPin.canvas.markMoved(mapPin);
		mapPin.nodeEl.classList.add("cmp-map-pin");
		mapPin.nodeEl.dataset.mapPinName = mapPin.unknownData.mapPinName;
		mapPin.focus = () => {};
		mapPin.blur = () => {};
		// The following two event listeners need to be registered only for newly created pins
		// and pins that the canvas randomly decides don't get their own onClick and onContextMenu
		mapPin.nodeEl.addEventListener("contextmenu", (e: Event) => {e.preventDefault(); mapPin.onContextMenu(e);}, true);
		mapPin.nodeEl.addEventListener("click", (e: Event) => {e.preventDefault(); mapPin.onClick()}, true);

		mapPin.onContextMenu = function(e: MouseEvent) {
			if (this.contextMenuOpen) return;
			this.contextMenuOpen = true;
			const menu = new Menu();
	/*
	  [ ] Swap file		arrow-left-right
	  [x] Rename file (currently called "Rename...")	pen-line
	  [x] Reveal file in navigation (allows user to do the rest of the default actions from the file itself)	folder-open

	  [x] Zoom to selection		zoom-to-selection
	  [x] Move Pin			move | hand
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
				const fileManager = this.app.fileManager;
				menu.addItem((item) =>
					item
						.setTitle('Rename file...')
						.setIcon('pen-line')
						.onClick(() => {
							fileManager.promptForFileRename(mapPin.file);
						})
				);
			} else {
				// "add file"
			}

			const fileExplorer = this.app.internalPlugins.plugins["file-explorer"].instance;
			menu.addItem((item) =>
				item
					.setTitle('Reveal file in navigation')
					.setIcon('folder-open')
					.onClick(() => {
						fileExplorer.revealInFolder(mapPin.file);
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

			const dragPin = this.dragPin;
			menu.addItem((item) =>
				item
					.setTitle('Move pin')
					.setIcon('move')
					.onClick((e) => {
						e.stopPropagation(); // stop the current click from immediately placing the pin
						dragPin(mapPin, true, undefined);
					})
			);

	/* Just delete the pin a create a new on ffs
			menu.addItem((item) =>
				item
					.setTitle('Rename pin')
					.setIcon('map-pin-pen')
					.onClick(() => {
						// ...
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
			(window as any).setTimeout(() => {mapPin.clicked = false}, 0);

			const openPreview = this.app.workspace
				.leftSplit
				.children
				.filter((section: any) => section.type === "tabs")[0]
				.children
				.filter((leaf: any) => leaf.view.file?.name === mapPin.filePath)[0];
			if (openPreview) {
				await this.app.workspace.revealLeaf(openPreview);
				return;
			}
			const preview = this.app.workspace.getLeftLeaf(false);
			preview.setViewState({
				type: 'markdown',
				state: {
					active: true,
					mode: "source",
					file: mapPin.filePath,
				},
			});
			this.app.workspace.setActiveLeaf(preview);
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
			set(n: number) {
				if (x===n) return;
				this.childMapPins.forEach((c: any) => {
					c.x += n - x;
					this.canvas.markMoved(c);
				});
				x=n;
			}
		});
		Object.defineProperty(parent, "y", {
			get() {return y;},
			set(n: number) {
				if (y===n) return;
				this.childMapPins.forEach((c: any) => {
					c.y += n - y;
					this.canvas.markMoved(c);
				});
				y=n;
			}
		});
		Object.defineProperty(parent, "width", {
			get() {return width;},
			set(n: number) {
				if (width === n) return;
				this.childMapPins.forEach((c: any) => {
					c.x = c.unknownData.offsetLeft * n + parent.x;
					this.canvas.markMoved(c);
				});
				width = n;
			}
		});
		Object.defineProperty(parent, "height", {
			get() {return height;},
			set(n: number) {
				if (height === n) return;
				this.childMapPins.forEach((c: any) => {
					c.y = c.unknownData.offsetTop * n + parent.y;
					this.canvas.markMoved(c);
				});
				height = n;
			}
		});
		Object.defineProperty(parent, "renderedZIndex", {
			get() {return renderedZIndex;},
			set(n: number) {
				if (renderedZIndex === n) return;
				this.childMapPins.forEach((c: any) => {
					c.zIndex = n + 1;
					c.renderZIndex();
				});
				renderedZIndex = n;
			}
		});
	}

	_processCanvas(canvas: any) {
		this.modifyCanvasMapPins(canvas);
		// stop the nodeInteractionLayer from being placed over map pins
		canvas.nodeInteractionLayer.setTarget = function (e: any) {
			if (e?.unknownData.subtype === (window as any).mapPinSubtype) return;
			this.target !== e && (this.target = e, this.render())
		};
	}
}

class MapPinNameModal extends Modal {
	#input: HTMLInputElement | undefined;
	#callback: undefined | ((s: string) => void);
	onOpen() {
		this.contentEl.classList.add("cmp-map-pin-modal");
		this.setTitle("Map Pin Name");

		this.#input = this.contentEl.createEl("input", {placeholder: "Pin location...", cls: "cmp-name-input"});
		this.#input.addEventListener("keydown", (e: KeyboardEvent) => {e.key === "Enter" ? this.returningClose() : {} });

		this.contentEl.createEl("p", {text: "Pins automatically link to, or create, a file with their generated filename:", cls: ""});
		const output = this.contentEl.createEl("output", { cls: "" });
		this.#input.addEventListener("input", () => {
			output.textContent = this.#input?.value ? (window as any).mapPinFilenameTemplate.generateMapPinFilename(this.#input?.value) : "";
		});

		const settingsBtn = this.contentEl.createEl("button", {cls: "cmp-settings-button"});
		settingsBtn.addEventListener("click", () => {
			(this.app as any).setting.open();
			const settingsTab = (this.app as any).setting.openTabById("canvas-map-pins");
			window.setTimeout(() => settingsTab.containerEl.children[0].classList.add("is-flashing"), 800);
			(window as any).setTimeout(() => settingsTab.containerEl.children[0].classList.remove("is-flashing"), 1800);
		});

		new Setting(this.contentEl)
			.addButton(btn => btn
				.setButtonText('Submit')
				.setCta()
				.onClick(() => {
					this.returningClose();
				})
			)
			.addButton(btn => btn
				.setButtonText('Cancel')
				.setClass("mod-cancel")
				.onClick(() => {
					this.close();
				})
			);
	}

	returningClose() {
		if (this.#callback && this.#input) { this.#callback(this.#input.value); }
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}

	setValueCallback(callback: (s: string) => void) {
		this.#callback = callback;
		return this;
	}
}

class InterceptedSet extends Set<any> {
	constructor(data: any) {
		super(data);
	}
	add(v: any): this {
		if (v.unknownData.subtype !== (window as any).mapPinSubtype) {
			return super.add(v);
		}
		return this;
	}
}