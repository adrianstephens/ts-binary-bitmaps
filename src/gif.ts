import * as bin from '@isopodlabs/binary';
import {BaseImage, Options, Result,  concatenateBuffers, putRgba} from './common';

const u8 = bin.UINT8;
const u16 = bin.UINT16_LE;

const Pixel24Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: 8, g: 8, r: 8 } as const));

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

	localPalette: 	bin.Optional(s => s.obj.packed.localColorTableFlag, bin.Buffer(s => 3 * (1 << (s.obj.packed.localColorTableSize + 1)))),
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

const GIFExtension = {
	label:	u8,
	data:	GIFSubBlocks,
};

const GIFblockType = {
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
		token: bin.as(u8, bin.EnumV(GIFblockType)), _: bin.Switch('token', {
		[GIFblockType.image]:		GIFImage,
		[GIFblockType.extension]:	GIFExtension,
		[GIFblockType.eof]:			bin.Const(undefined),
	})}),
};


export class GIF extends BaseImage {
	palette: bin.utils.TypedArray<{r: number, g: number, b: number}>;

	constructor(gif: bin.ReadType<typeof GIFSpec>) {
		const images = gif.blocks.filter(b => b.token === GIFblockType.image);
		super('2d', gif.width, gif.height, {
			I: {
				width: gif.width,
				height: gif.height,
				mips: [images[0].indices],
			}
		});
		this.palette = gif.globalPalette;
	}
	async getPixels(options: Options): Promise<Result> {
		const bytes = this.planes.I!.mips[0];
		const pixels = new Uint8Array(bytes.length * 4);
		for (let i = 0, j = 0; i < bytes.length; i += 1, j += 4) {
			const col = this.palette[bytes[i]];
			putRgba(pixels, j, col.r, col.g, col.b, 255);
		}
		return {width: this.width, height: this.height, pixels};
	}

	static load(data: Uint8Array): GIF {
		return new GIF(bin.read(new bin.stream(data), GIFSpec));
	}
};
