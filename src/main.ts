import {
	App,
	Modal,
	Setting,
	SettingTab,	
	Notice,
	Plugin,
	Menu,
	TFile,
	View,
	MarkdownView,
	FileManager,
	WorkspaceSidedock,
	WorkspaceTabs,
	WorkspaceLeaf,

setIcon
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	CanvasMapPinSettings,
	CanvasMapPinSettingsTab,
} from './settings';

type Point = { x: number; y: number };
type BBox = { minX: number; maxX: number, minY: number , maxY: number };

interface InternalWorkspaceSidedock extends WorkspaceSidedock {
	children: Array<InternalWorkspaceTabs>
}

interface InternalWorkspaceTabs extends WorkspaceTabs {
	type:		string,
	children:	Array<WorkspaceLeaf>
}

interface InternalApp extends App {
	internalPlugins: {
		plugins: {
			"file-explorer": {
				instance: FileExplorerPlugin
			}
		}
	};
	setting: {
		open:		() => void,
		openTabById:	(id: string) => SettingTab,
	}
}

interface FileExplorerPlugin extends Plugin {
	revealInFolder: (file: TFile) => void;
}

interface InternalFileManager extends FileManager {
	promptForFileRename: (file: TFile) => void;
}

/*
interface CanvasWorkspaceLeaf extends WorkspaceLeaf {
	view: CanvasView;
}
*/

interface CanvasView extends View {
	canvas: Canvas;
}

type CanvasData = {
	nodes: Map<string, CanvasNode>
}

type CanvasNodeIndexData = {
	children: Array<CanvasNode | CanvasNodeIndexDataDepth1>;
}

type CanvasNodeIndexDataDepth1 = {
	children: Array<CanvasNode>;
}

interface Canvas {
	app: App;
	data: CanvasData;
	nodes: Map<string, CanvasNode>;
	cardMenuEl: HTMLElement;
	nodeIndex: {
		data: CanvasNodeIndexData
	};
	nodeInteractionLayer: {
		canvas:		Canvas,
		interactionEl:	HTMLElement,
		setTarget:	(el: CanvasNode) => void,
		target:		CanvasNode,
		render:		() => void
	};
	selection:	Set<CanvasNode> | InterceptedSet;
	draggingPin:	boolean | undefined;
	pointer:	Point | undefined;
	requestSave:	() => void;
	removeNode:	(node: CanvasNode) => void;
	zoomToBbox:	(bBox: BBox) => void;
	markMoved:	(node: CanvasNode) => void;
	createFileNode:	(nodeInfo: {
		pos: Point | undefined,
		size: { width: number, height: number },
		/* eslint-disable-next-line @typescript-eslint/no-empty-object-type --
		 * Either a TFile or an empty object can be passed in here
		 * "no file" cannot be anything other than `{}`
		**/
		file: TFile | {},
		save: boolean,
		focus: boolean
	}) => CanvasNode;
}

interface CanvasNode {
	id:		string,
	app:		App,
	canvas:		Canvas;
	width:		number;
	height:		number;
	x:		number;
	y:		number;
	nodeEl:		HTMLElement;
	file:		TFile | null;
	filePath:	string;
	zIndex:		number;
	renderedZIndex:	number;
	mapPinned:	boolean | undefined;
	clicked:	boolean | undefined;
	contextMenuOpen:boolean | undefined;
	childMapPins:	Set<CanvasNode>;
	unknownData:	{
		subtype:	string,
		mapPinName:	string,
		parent:		string,
		offsetTop:	number,
		offsetLeft:	number,
	};
	focus:		() => void;
	blur:		() => void;
	renderZIndex:	() => void;
	setFile:	(f: TFile) => void;
	onClick:	(e: MouseEvent | void) => Promise<void>;
	onContextMenu:	(e: MouseEvent) => void;
	getBBox:	() => BBox;
	getPoint:	() => Point;
}

export default class CanvasMapPinPlugin extends Plugin {
	settings!: CanvasMapPinSettings;
	mapPinSubtype: string = "map-pin";

	async onload() {
		await this.loadSettings();

		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
			const canvas: Canvas = (leaf?.view as CanvasView).canvas;
			if (!canvas) return;
			if (this.shouldModifyCanvas(canvas)) {
				if (Object.isEmpty(canvas.data)) {
					// only reliable way to await the canvas.nodes being populated
					void new Promise<void>((resolve, reject) => {
						let data: CanvasData = canvas.data;
						Object.defineProperty(canvas, "data", {
							get() { return data; },
							set(d: CanvasData) {
								if (d.nodes) resolve();
								data = d;
							}
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
				const mapPinSubtype = this.mapPinSubtype;
				canvas.nodeInteractionLayer.setTarget = function (e: CanvasNode) {
					if (e?.unknownData.subtype === mapPinSubtype || this.canvas.draggingPin) return;
					if (this.target !== e) {
						this.target = e;
						this.render();
					}
				};
			}
		}));

		this.addCommand({
			id: 'add-canvas-map-pin',
			name: 'Add a map pin on a canvas',
			repeatable: false,
			icon: 'map-pin-plus',
			// suggest users define this
			// hotkeys: [{key: 'M', modifiers: ['Ctrl']}],
			checkCallback: (checking: boolean) => {
				// N.B. `workspace.getActiveViewOfType(Object)` is an alias for `workspace.activeLeaf`
				// but the latter is deprecated.
				const canvasView = this.app.workspace.getActiveViewOfType(View);
				if (canvasView && canvasView.getViewType() === 'canvas') {
					if (!checking) {
						void this.promtCreateMapPin((canvasView as CanvasView).canvas);
					}
					return true;
				}
				return false;
			},
		});

		this.addSettingTab(new CanvasMapPinSettingsTab(this.app, this));

	}

	onunload() { }

	async loadSettings() {
		const loadedSettings = (await this.loadData()) as Partial<CanvasMapPinSettings>;

		this.settings = {} as CanvasMapPinSettings; 

		this.settings.MapPinFilename = {
			template:  loadedSettings.MapPinFilename?.template || DEFAULT_SETTINGS.MapPinFilename.template,
			generate: function(name: string) {
				return this.template.replaceAll("%n", name).concat(".md");
			}
		};

		let mapPinSize: number = 0;
		Object.defineProperty(this.settings, "MapPinSize", {
			get(): number { return mapPinSize; },
			set(v: number) {
				mapPinSize = v;
				document.documentElement.style.setProperty("--map-pin-size", v + "px");
/*
 * This code will render any canvases that have map pins if in view, whether focussed or not.
 * however, it causes canvases being loaded alongside this plugin (i.e. on normal start up) to throw an error since their data hasn't loaded yet.
 *  
				const canvases = [];
				this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
					if (leaf.width && (leaf.view as CanvasView).canvas) {
						canvases.push((leaf.view as CanvasView).canvas);
					}
				});
				if (canvases.length) canvases.forEach(canvas => processCanvas(canvas));
*/
			}
		});
		// induce side effect of setting CSS :root variable and modifying any open canvases
		this.settings.MapPinSize = loadedSettings.MapPinSize || DEFAULT_SETTINGS.MapPinSize;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	shouldModifyCanvas(canvas: Canvas) {
		// modify if...
		return (
			// ...canvas has no nodes (initialised for 1st time), or...
			!canvas.nodes.size ||
			// ...it contains uninitialised map pins
			Array.from(canvas.nodes.values()).find((node: CanvasNode) => node.unknownData.subtype === this.mapPinSubtype && !node.mapPinned)
		);
	}
	addStatusBarText(text: string) {
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(text);
		return statusBarItemEl;
	}
	removeStatusBarText(el: HTMLElement) {
		el.remove();
	}
	async promtCreateMapPin(canvas: Canvas): Promise<void> {
		const name = await this.getPinName();
		if (name) {
			await this.addMapPin(name, canvas, false);
		}
	}
	async getPinName(): Promise<string> {
		return new Promise((resolve, reject) => {
			new MapPinNameModal(this)
				.setValueCallback(value => resolve(value))
				.open();
		});
	}
	async addMapPin(name: string, canvas: Canvas, thenGetName: boolean) {
		const filename = this.settings.MapPinFilename.generate(name);

		const mapPinTFile: TFile | null = this.app.vault.getFileByPath(filename);

		const mapPin: CanvasNode = canvas.createFileNode({
                        pos: canvas.pointer,
                        size: { width: this.settings.MapPinSize, height: this.settings.MapPinSize },
                        file: mapPinTFile  || {},
                        save: true,
                        focus: false
		});

		if (!(mapPinTFile instanceof TFile)) {
			mapPin.file = null;
		}

		Object.assign(mapPin.unknownData, {
			subtype: this.mapPinSubtype,
			mapPinName: name
		});

		mapPin.nodeEl.classList.add("cmp-map-pin");

		try {
			await this.dragPin(mapPin, false);

			if (mapPin.file) return;

			if (thenGetName) {
				name = await this.getPinName();
				if (!name) throw new Error("Pin deleted. Map pin has no file");
				const newTFile: TFile = this.app.vault.getFileByPath(filename) ||
					await this.app.vault.create(
						this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path || "./").path + filename,
						"Add some info about " + name + "..."
					);
				mapPin.setFile(newTFile);
			} else {
				const newTFile: TFile = await this.app.vault.create(
					this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path || "./").path + filename,
					"Add some info about " + name + "..."
				);
				mapPin.setFile(newTFile);
			}
		} catch(e: unknown) {
			canvas.removeNode(mapPin);
			canvas.requestSave();
			if (e instanceof Error) new Notice(String(e), 3000).messageEl.addClass("cmp-mod-error");
			return;
		}

	}

	dragPin(mapPin: CanvasNode, returnToInitialPos: boolean): Promise<void> {
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

		// canvas.nodeIndex.data.children are sometimes Array<CanvasNode> and sometimes [{children:Array<CanvasNode>}]
		const nodes: Array<CanvasNode> = canvas
			.nodeIndex
			.data
			.children
			.flatMap((obj: CanvasNodeIndexDataDepth1 | CanvasNode): Array<CanvasNode> => 'children' in obj ? obj.children : [obj]);
		const dropZones = nodes
			.filter((n: CanvasNode) => n.id !== mapPin.id && n.file && imageExts.includes(n.file.extension))
			.sort((e: CanvasNode, t: CanvasNode) => t.zIndex - e.zIndex)
			.map((t: CanvasNode) => t.getBBox());

		if (!dropZones.find((z: BBox) => pointInBox(mapPin.getPoint(), z))) {mapPin.nodeEl.classList.add("cmp-no-drop");}

		let pointerValue: Point = {x:0, y:0};
		let lastCollision: boolean = false;
		Object.defineProperty(canvas, "pointer", {
			get() {	return pointerValue; },
			set(v: Point) {
				pointerValue = v;
				mapPin.x = Math.round(v.x);
				mapPin.y = Math.round(v.y);
				(this as Canvas).markMoved(mapPin);  // rerenders just this element in next frame ...I assume

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

		const resetPointer = (canvas: Canvas) => {
			const lastPointerValue = canvas.pointer;
			delete canvas.pointer;
			canvas.pointer = lastPointerValue;
		};

		const controller = new AbortController();

		let resolve: () => void;
		let reject: () => void;

		const pinDropped: Promise<void> = new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		});

		document.addEventListener("click", (e: Event) => {
			controller.abort();
			delete canvas.draggingPin;

			const parentMap: CanvasNode | undefined = nodes
				.filter((n: CanvasNode) => n.id !== mapPin.id && n.file && imageExts.includes(n.file.extension) && pointInBox(mapPin.getPoint(), n.getBBox()))
				.sort((e: CanvasNode, t: CanvasNode) => t.zIndex - e.zIndex)[0];
			if (!parentMap) {
				if (initialPos) {
					canvas.pointer = initialPos;	
				} else {
					canvas.removeNode(mapPin);
					canvas.requestSave();
				}
				resetPointer(canvas); // deregister our hijacking
				reject();
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
			resolve();
		}, {once: true, signal: controller.signal});

		document.addEventListener("keydown", ({key}: KeyboardEvent) => {
			if (!["Escape", "Delete", "Backspace"].includes(key)) return;
			controller.abort();
			delete canvas.draggingPin;
			if (initialPos) {
				// use side-effect of accessor prop to reset map pin position
				canvas.pointer = initialPos;	
			} else {
				canvas.removeNode(mapPin);
			}
			resetPointer(canvas);
			canvas.requestSave();
			reject();
		}, {signal: controller.signal});

		return pinDropped;
	}

	modifyCanvasMapPins(canvas: Canvas) {
		Array.from( canvas.nodes.values() )
			.filter((node: CanvasNode) => node.unknownData.subtype === this.mapPinSubtype)
			.forEach((pin: CanvasNode) => { this.mappinify(pin) });
		// stop the selection menu from coming up on map pins
		// only needed for newly created map pins
		canvas.selection = new InterceptedSet( Array.from(canvas.selection.values()), this.mapPinSubtype );

		canvas.cardMenuEl.createDiv(
			{cls: "canvas-card-menu-button mod-draggable"},
			(div: HTMLElement) => {
				div.setAttribute("aria-label", "Drag to add map pin");
				div.setAttribute("data-tooltip-position", "top");
				setIcon(div, "lucide-map-pin-plus");
				div.addEventListener("click", () => {
					void this.promtCreateMapPin(canvas);
		                });
				div.addEventListener("pointerdown", (e: MouseEvent) => {
					this.dragOrClick(div).then((drag: boolean) => {
						if (drag) void this.addMapPin("", canvas, true);
					})
					.catch(() => {});
				});
			}
		);
	}

	// returns true if drag, false if click
	dragOrClick(el: HTMLElement): Promise<boolean> {
		const abort = new AbortController();
		return new Promise((resolve, reject) => {
			el.addEventListener("mousemove", () => {resolve(true);  abort.abort();}, {once: true, signal: abort.signal});
			el.addEventListener("pointerup", () => {resolve(false); abort.abort();}, {once: true, signal: abort.signal});
		});
	}

	mappinify(mapPin: CanvasNode) {
		mapPin.width = this.settings.MapPinSize;
		mapPin.height = this.settings.MapPinSize;
		mapPin.canvas.markMoved(mapPin);
		mapPin.nodeEl.classList.add("cmp-map-pin");
		mapPin.nodeEl.dataset.mapPinName = mapPin.unknownData.mapPinName;
		mapPin.focus = () => {};
		mapPin.blur = () => {};
		// The following two event listeners need to be registered only for newly created pins
		// and pins that the canvas randomly decides don't get their own onClick and onContextMenu
		mapPin.nodeEl.addEventListener("contextmenu", (e: MouseEvent) => {e.preventDefault(); mapPin.onContextMenu(e);}, true);
		mapPin.nodeEl.addEventListener("click", (e: MouseEvent) => {e.preventDefault(); void mapPin.onClick()}, true);

		const dragPin = this.dragPin.bind(this);
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
							// prompt select file
							// this.setFile( ... );
						})
				);
	*/
				menu.addItem((item) =>
					item
						.setTitle('Rename file...')
						.setIcon('pen-line')
						.onClick(() => {
							if (this.file) (this.app.fileManager as InternalFileManager).promptForFileRename(this.file);
						})
				);

				menu.addItem((item) =>
					item
						.setTitle('Reveal file in navigation')
						.setIcon('folder-open')
						.onClick(() => {

							const fileExplorer: FileExplorerPlugin = (this.app as InternalApp)
								.internalPlugins
								.plugins["file-explorer"]
								.instance;
							if (this.file) fileExplorer.revealInFolder(this.file);
						})
				);

				menu.addSeparator();
			} else {
				// "add file"
			}



			menu.addItem((item) =>
				item
					.setTitle('Zoom to selection')
					.setIcon('zoom-to-selection')
					.onClick(() => {
						this.canvas.zoomToBbox(this.getBBox());
					})
			);

			menu.addItem((item) =>
				item
					.setTitle('Move pin')
					.setIcon('move')
					.onClick((e) => {
						e.stopPropagation(); // stop the current click from immediately placing the pin
						void dragPin(mapPin, true);
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
			window.setTimeout(() => {mapPin.clicked = false}, 0);

			const openPreview = (this.app.workspace
				.leftSplit as InternalWorkspaceSidedock)
				.children
				.filter((section: InternalWorkspaceTabs) => section.type === "tabs")[0]
				?.children
				.filter((leaf: WorkspaceLeaf) => (leaf.view as MarkdownView).file?.name === mapPin.filePath)[0];
			if (openPreview) {
				await this.app.workspace.revealLeaf(openPreview);
				return;
			}
			const preview = this.app.workspace.getLeftLeaf(false);
			if (!preview) {
				new Notice("Error: Could not get left leaf", 2000).messageEl.addClass("cmp-mod-error");
				return;
			}
			await preview.setViewState({
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
		const parent: CanvasNode | undefined = mapPin.canvas.nodes.get(mapPin.unknownData.parent);
		if (!parent) {
			new Notice("A map pin was found with no parent map", 2000).messageEl.addClass("cmp-mod-error");
			return;
		}
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
				(this as CanvasNode).childMapPins.forEach((c: CanvasNode) => {
					c.x += n - x;
					(this as CanvasNode).canvas.markMoved(c);
				});
				x=n;
			}
		});
		Object.defineProperty(parent, "y", {
			get() {return y;},
			set(n: number) {
				if (y===n) return;
				(this as CanvasNode).childMapPins.forEach((c: CanvasNode) => {
					c.y += n - y;
					(this as CanvasNode).canvas.markMoved(c);
				});
				y=n;
			}
		});
		Object.defineProperty(parent, "width", {
			get() {return width;},
			set(n: number) {
				if (width === n) return;
				(this as CanvasNode).childMapPins.forEach((c: CanvasNode) => {
					c.x = c.unknownData.offsetLeft * n + parent.x;
					(this as CanvasNode).canvas.markMoved(c);
				});
				width = n;
			}
		});
		Object.defineProperty(parent, "height", {
			get() {return height;},
			set(n: number) {
				if (height === n) return;
				(this as CanvasNode).childMapPins.forEach((c: CanvasNode) => {
					c.y = c.unknownData.offsetTop * n + parent.y;
					(this as CanvasNode).canvas.markMoved(c);
				});
				height = n;
			}
		});
		Object.defineProperty(parent, "renderedZIndex", {
			get() {return renderedZIndex;},
			set(n: number) {
				if (renderedZIndex === n) return;
				(this as CanvasNode).childMapPins.forEach((c: CanvasNode) => {
					c.zIndex = n + 1;
					c.renderZIndex();
				});
				renderedZIndex = n;
			}
		});
	}
}

class MapPinNameModal extends Modal {
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

class InterceptedSet extends Set<CanvasNode> {
	#mapPinSubtype: string;
	constructor(data: Array<CanvasNode>, mapPinSubtype: string) {
		super(data);
		this.#mapPinSubtype = mapPinSubtype;
	}
	add(v: CanvasNode): this {
		if (v.unknownData.subtype !== this.#mapPinSubtype) {
			return super.add(v);
		}
		return this;
	}
}