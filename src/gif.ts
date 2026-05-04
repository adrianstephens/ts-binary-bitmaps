import * as bin from '@isopodlabs/binary';
import {Image, Options, Result, concatenateBuffers} from './common';

const u8 = bin.UINT8;
const u16 = bin.UINT16_LE;

const Pixel24Array	= bin.utils.BitFieldsTypedArray({ b: 8, g: 8, r: 8 } as const);

//-----------------------------------------------------------------------------
// GIF
//-----------------------------------------------------------------------------

function decompressGIFLZW(minCodeSize: number, data: Uint8Array, out: Uint8Array) {
	const clear		= 1 << minCodeSize;
	const end		= clear + 1;
	const prefix	= new Int32Array(4096);
	const suffix	= new Uint8Array(4096);
	const stack		= new Uint8Array(4096);

	const reset = () => {
		for (let i = 0; i < clear; i++) {
			prefix[i] = -1;
			suffix[i] = i;
		}
		return {next: end + 1, codeSize: minCodeSize + 1};
	};

	let {next, codeSize} = reset();
	let bit = 0;
	let length = 0;
	let prev = -1;
	let first = 0;

	const push = (value: number) => {
		if (length >= out.length) {
			const grown = new Uint8Array(out.length << 1);
			grown.set(out);
			out = grown;
		}
		out[length++] = value;
	};

	const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

	while (bit + codeSize <= data.length * 8) {
		const code = bin.utils.getUintBits(dv, bit, codeSize, true);
		bit += codeSize;

		if (code === clear) {
			({next, codeSize} = reset());
			prev = -1;
			continue;
		}
		if (code === end)
			break;

		let cur = code;
		let top = 0;

		if (cur >= next) {
			if (prev < 0)
				throw new Error('Invalid GIF LZW stream');
			stack[top++] = first;
			cur = prev;
		}

		while (cur >= clear) {
			stack[top++] = suffix[cur];
			cur = prefix[cur];
		}

		first = suffix[cur];
		stack[top++] = first;
		while (top)
			push(stack[--top]);

		if (prev >= 0 && next < 4096) {
			prefix[next] = prev;
			suffix[next] = first;
			next++;
			if (next === 1 << codeSize && codeSize < 12)
				codeSize++;
		}
		prev = code;
	}

	return length;
}

const GIFSubBlocks = bin.as(bin.RemainingArray(bin.FuncType(s => {
	const blockSize = bin.read(s, u8);
	return blockSize ? bin.Buffer(blockSize) : undefined;
})), concatenateBuffers);

const GIFImage = {
	left:			u16,
	top:			u16,
	width:			u16,
	height:			u16,
	packed:			bin.BitFields({
		localColorTableSize:	3, // 2^(n+1) entries
		reserved:				2,
		sortFlag:				1,
		interlaceFlag:			1,
		localColorTableFlag:	1,
	} as const),

	localPalette: 	bin.Optional(s => s.obj.packed.localColorTableFlag, bin.Buffer(s => 1 << (s.obj.packed.localColorTableSize + 1), Pixel24Array)),
	lzwMinCodeSize:	u8,
	indices:		bin.as(GIFSubBlocks, (lzwData: Uint8Array, s) => {
		const {width, height, packed, lzwMinCodeSize } = s.obj as any;
		const indices 	= new Uint8Array(width * height);
		const len		= decompressGIFLZW(lzwMinCodeSize, lzwData, indices);
		if (len !== width * height)
			throw new Error(`Invalid GIF LZW output length ${len}, expected ${width * height}`);

		if (packed.interlaceFlag) {
			const out = new Uint8Array(width * height);
			let offset = 0;
			for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) {
				for (let y = start; y < height && offset < indices.length; y += step, offset += width) 
					out.set(indices.subarray(offset, offset + width), y * width);
			}
			return out;
		}
		return indices;
	}),
};

/*	enum DISPOSAL {
	NONE,			//0: No disposal specified. The decoder is not required to take any action.
	NO_DISPOSE,		//1: Do not dispose. The graphic is to be left in place.
	RESTORE_BG,		//2: Restore to background color. The area used by the graphic must be restored to the background color.
	RESTORE_PREV,	//3: Restore to previous. The decoder is required to restore the area overwritten by the graphic with what was there prior to rendering the graphic.
	//4-7: To be defined.
};*/

const GIFExtensionType = {
	text:		0x01,
	control:	0xf9,
	comment:	0xfe,
	app:		0xff,
} as const;

const GIFExtension = {
	label:	u8,
	data:	bin.as(GIFSubBlocks, (data, s) => new bin.stream(data as Uint8Array).read(bin.Switch('label', {
		[GIFExtensionType.text]: {
			left:			u16,
			top:			u16,
			width:			u16,
			height:			u16,
			cell_width:		u8, cell_height: u8,
			flags:			u8,
			foreground:		u8, background: u8
		},
		[GIFExtensionType.control]: {
			packed:			bin.BitFields({has_transparent:1, userinput:1, disposal:3, unused:3}),
			delay:			u16,
			transparent:	u8,
		},
		[GIFExtensionType.comment]: {
			comment:		bin.RemainingString(),
		},
		[GIFExtensionType.app]: {//app
			app:			bin.String(8),
			authentication: bin.String(3),
			rest:			bin.Remainder,
		}
	}), s.obj))
};


const GIFBlockType = {
	image:		0x2C,
	extension:	0x21,
	eof:		0x3B,
} as const;

const GIFSpec = {
	signature:		bin.Expect(bin.String(3), 'GIF'),
	version:		bin.String(3), // '87a' or '89a'

	width:			u16,
	height:			u16,
	packed:			bin.BitFields({
		globalColorTableSize:	3, // 2^(n+1) entries
		sortFlag:				1,
		colorResolution:		3,
		globalColorTableFlag:	1,
	} as const),
	bgColorIndex:	u8,
	pixelAspect:	u8,
	globalPalette:	bin.Optional(s => s.obj.packed.globalColorTableFlag, bin.Buffer(s => 1 << (s.obj.packed.globalColorTableSize + 1), Pixel24Array)),

	blocks:		bin.RemainingArray({
		token: bin.as(u8, bin.EnumV(GIFBlockType)), _: bin.Switch('token', {
		[GIFBlockType.image]:		GIFImage,
		[GIFBlockType.extension]:	GIFExtension,
		[GIFBlockType.eof]:			bin.Const(undefined),
	})}),
};

class GIFFrame extends Image {
	constructor(img: bin.ReadType<typeof GIFImage>, public delay: number, globalPalette: bin.utils.TypedElement<typeof Pixel24Array>) {
		const {width, height} = img;
		super('2d', width, height, {
			I: {
				width, height,
				getPixels: async (options) => img.indices
			}
		});

		const palette = img.localPalette ?? globalPalette;
		this.unpalette = i => {
			const col = palette[i];
			return [col.r, col.g, col.b];
		};
	}
}

export class GIF extends Image {
	frames:	GIFFrame[] = [];
	constructor(gif: bin.ReadType<typeof GIFSpec>) {
		const {width, height}		= gif;
		const frames: GIFFrame[]	= [];

		let delay = 0;
		for (const b of gif.blocks) {
			if (b.token === GIFBlockType.extension) {
				if (b.label === GIFExtensionType.control)
					delay = b.data.delay;

			} else if (b.token === GIFBlockType.image) {
				frames.push(new GIFFrame(b, delay, gif.globalPalette));
			}
		}

		if (frames.length === 1) {
			super('2d', width, height, frames[0].planes);
		} else {
			super('2d-array', width, height, frames[0].planes);
			this.depth = frames.length;
			this.frames = frames;
		}

		this.unpalette = i => {
			const col = gif.globalPalette[i];
			return [col.r, col.g, col.b];
		};
	}

	getLayer(layer: string | number): Image | undefined {
		return this.frames[+layer];
	}

	getPixels(options: Options): Promise<Result> {
		let time = options.time;
		if (time !== undefined) {
			for (const f of this.frames) {
				if (time < f.delay)
					return f.getPixels(options);
				time -= f.delay;
			}
		}
		return super.getPixels(options);
	}

	static load(data: Uint8Array): GIF {
		return new GIF(bin.read(new bin.stream(data), GIFSpec));
	}
};
