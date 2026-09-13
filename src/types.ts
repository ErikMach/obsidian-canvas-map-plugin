export type {
	Point,
	BBox,
	InternalWorkspaceSidedock,
	InternalWorkspaceTabs,
	InternalApp,
	FileExplorerPlugin,
	InternalFileManager,
	InternalWorkspaceLeaf,
	CanvasView,
	CanvasData,
	CanvasNodeIndexDataDepth1,
	Canvas,
	CanvasNode,
};
import {
	App,
	SettingTab,	
	TFile,
	View,
	FileManager,
	WorkspaceSidedock,
	WorkspaceTabs,
	WorkspaceLeaf,
} from 'obsidian';
import { InterceptedSet } from './canvasNodeOverride';

type Point = { x: number; y: number };

type BBox = { minX: number; maxX: number, minY: number , maxY: number };

interface InternalWorkspaceSidedock extends WorkspaceSidedock {
	children: Array<InternalWorkspaceTabs>
}

interface InternalWorkspaceTabs extends WorkspaceTabs {
	type:		string,
	children:	Array<WorkspaceLeaf>
}

interface InternalWorkspaceLeaf extends WorkspaceLeaf {
	width: number;
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

interface FileExplorerPlugin {
	revealInFolder: (file: TFile) => void;
}

interface InternalFileManager extends FileManager {
	promptForFileRename: (file: TFile) => void;
}

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
	addMapPinEl: HTMLElement | undefined;
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