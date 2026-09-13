import { CanvasNode } from './types';

export class InterceptedSet extends Set<CanvasNode> {
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