import {
	Editor,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
	FileSystemAdapter,
	FileManager,
	TFile,
} from 'obsidian';
import 	* as obb from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from './settings';

export default class CanvasMapPinPlugin extends Plugin {
	settings!;

	async onload() {
		await this.loadSettings();

		window.mapPinSubtype = "map-pin";
		window.mapPinSize = 60;
		
		this.registerEvent(app.workspace.on("active-leaf-change", (leaf) => {
			const canvas = leaf.view.canvas;
			if (!canvas) return;
			if (!canvas.mapPinned) {
				canvas.mapPinned = true;
				console.log("Updating Canvas");
				// only reliable way to await the canvas.nodes being populated
				new Promise((resolve, reject) => {
					let data = canvas.data;
					Object.defineProperty(canvas, "data", {
						get() { return data; },
						set(d) { d.nodes ? resolve() : {}; data=d; }
					});
				}).then(() => {
					canvas
						.nodes
						.values()
						.filter(node => node.unknownData.subtype === window.mapPinSubtype)
						.forEach(pin => mappinify(pin));
					// reset the data property
					Object.defineProperty(canvas, "data", {
						value: canvas.data,
						writable: true,
						configurable: true,
						enumerable: true
					});
				});
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
		this.addSettingTab(new SampleSettingTab(this.app, this));


		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000),
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
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

		const filename = "map-pin - " + name + ".md";

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

		mapPin.nodeEl.classList.add("cmp-map-pin");
		mapPin.focus = () => {};
		mapPin.blur = () => {};	

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
		const collides = (e, t) => {
			return t.minX <= e.maxX && t.minY <= e.maxY && t.maxX >= e.minX && t.maxY >= e.minY;
		};
		// canvas.nodeIndex.data.children are sometimes [TFile] and sometimes [{children:[TFile]}]
		const nodes = canvas.nodeIndex.data.children.flatMap(obj => obj.children ? obj.children : obj);
		const dropZones = nodes
			.filter(n => n.id !== mapPin.id && imageExts.includes(n.file?.extension))
			.sort((e, t) => t.zIndex - e.zIndex)
			.map(t => t.getBBox());

		if (!dropZones.find(z => collides(z, mapPin.getBBox()))) {mapPin.nodeEl.classList.add("cmp-no-drop");}


		let pointerValue = {x:0, y:0};
		const halfSize = mapPinSize / 2;
		let lastCollision = false;
		Object.defineProperty(canvas, "pointer", {
			get() {	return pointerValue; },
			set(v) {
				pointerValue = v;
				mapPin.x = Math.round(v.x);
				mapPin.y = Math.round(v.y);
				this.markMoved(mapPin);  // rerenders just this element in next frame ...I assume

				const collision = dropZones.find(z => collides(z, mapPin.getBBox()));
				if (collision && !lastCollision) {
					mapPin.nodeEl.classList.remove("cmp-no-drop");
					lastCollision = true;
				} else if (!collision && lastCollision) {
					mapPin.nodeEl.classList.add("cmp-no-drop");
					lastCollision = false;
				}
			},
		});

		const controller = new AbortController();

		this.registerDomEvent(document, "click", () => {
			controller.abort();
			delete canvas.pointer; // deregister our hijacking
			this.removeStatusBarText(statusBarText);

			const parentMap =  nodes
				.filter(n => n.id !== mapPin.id && imageExts.includes(n.file?.extension) && collides(n.getBBox(), mapPin.getBBox()))
				.sort((e, t) => t.zIndex - e.zIndex)[0];
			if (!parentMap) {
				canvas.removeNode(mapPin);
				return;
			}
			const offsetLeft = (mapPin.x - parentMap.x) / parentMap.width;
			const offsetTop = (mapPin.y - parentMap.y) / parentMap.height;
			console.log(parentMap, offsetLeft, offsetTop);
			Object.assign(mapPin.unknownData, {
				subtype: mapPinSubtype,
				parent: parentMap.id,
				offsetTop: offsetTop,
				offsetLeft: offsetLeft
			});
			mappinify(mapPin);
			canvas.requestSave();
		}, {once: true, signal: controller.signal});

		this.registerDomEvent(document, "keydown", ({key}) => {
			if (!["Escape", "Delete", "Backspace"].includes(key)) return;
			controller.abort();
			delete canvas.pointer;
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

class InterceptedNodeMap extends Map {
	constructor() {
		super();
	}
	set(k, v) {
		console.log(`Node insert: ${k}:${v}`);
		this.prototype.set(k,v);
	}
}

function mappinify(mapPin: Tfile) {
console.log(mapPin);
	mapPin.nodeEl.classList.add("cmp-map-pin");
	mapPin.focus = () => {};
	mapPin.blur = () => {};
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



/* Canvas.createFileNode
e.prototype.createFileNode = function(e) {
                var t = e.pos
                  , n = e.size
                  , i = e.position
                  , r = e.file
                  , o = e.subpath
                  , a = e.save
                  , s = e.focus
                  , l = new j7(this); // j7 returns a TFile
                return n || (n = this.config.defaultFileNodeDimensions),
                l.moveAndResize(R8(t, n, i)),
                l.setFile(r, o),
                this.addNode(l),
                !1 !== a && this.requestSave(),
                !1 !== s && this.selectOnly(l),
                l // return the TFile
            }
*/
