import * as bin from '@isopodlabs/binary';
import {Image, putRgb, to255} from './common';

const u8  = bin.UINT8;
const u16 = bin.UINT16_LE;

const TGAImageType = {
	NoImage:		0,
	ColorMapped:	1,
	TrueColor:		2,
	Grayscale:		3,
	RLEColorMapped:	9,
	RLETrueColor:	10,
	RLEGrayscale:	11,
} as const;

const TGAColorMapType = {
	None:			0,
	Present:		1,
} as const;

const BGR15Array	= bin.typedArray.BitFields({ b: to255(5), g: to255(5), r: to255(5), x: 1 } as const);
const BGR24Array	= bin.typedArray.BitFields({ b: 8, g: 8, r: 8 } as const);
const BGRA32Array	= bin.typedArray.BitFields({ b: 8, g: 8, r: 8, a: 8 } as const);

function decodeRLE(raw: Uint8Array, bytesPerPixel: number, numPixels: number): Uint8Array {
	const out = new Uint8Array(numPixels * bytesPerPixel);
	let src = 0, dst = 0;
	while (dst < out.length) {
		const rep = raw[src++];
		if (rep & 0x80) {
			const count = (rep & 0x7f) + 1;
			for (let i = 0; i < count; i++, dst += bytesPerPixel)
				out.set(raw.subarray(src, src + bytesPerPixel), dst);
			src += bytesPerPixel;
		} else {
			const count = (rep + 1) * bytesPerPixel;
			out.set(raw.subarray(src, src + count), dst);
			src += count;
			dst += count;
		}
	}
	return out;
}

function RLEPixels<T extends bin.typedArray.TypedArray<any>>(arrayType: bin.typedArray.TypedArrayConstructor<T>) {
	const bpp = arrayType.BYTES_PER_ELEMENT!;
	return {pixels: bin.as(bin.Remainder, (raw: Uint8Array, s) => {
		const {width, height} = s.obj.obj;
		return arrayType.from(decodeRLE(raw, bpp, width * height));
	})};
}

function rawPixels<T extends bin.typedArray.TypedArray<any>>(arrayType: bin.typedArray.TypedArrayConstructor<T>) {
	return {pixels: bin.Buffer(s => s.obj.obj.width * s.obj.obj.height, arrayType)};
}

const TGASpec = {
	idLength:			u8,
	colorMapType:		bin.as(u8, bin.EnumV(TGAColorMapType)),
	imageType:			bin.as(u8, bin.EnumV(TGAImageType)),
	colorMapOrigin:		u16,
	colorMapLength:		u16,
	colorMapDepth:		u8,
	xOrigin:			u16,
	yOrigin:			u16,
	width:				u16,
	height:				u16,
	bitsPerPixel:		u8,
	imageDescriptor:	bin.BitFields({
		attributeBits:	4,	// number of attribute bits per pixel (alpha channel depth)
		originRight:	1,
		originTop:		1,
		reserved:		2,
	} as const),
	
	imageId:	bin.Buffer(s => s.obj.idLength),

	colorMap:	bin.Optional(s => s.obj.colorMapType === TGAColorMapType.Present, bin.Switch(s => s.obj.colorMapDepth, {
		15: bin.Buffer(s => s.obj.colorMapLength, BGR15Array),
		16: bin.Buffer(s => s.obj.colorMapLength, BGR15Array),
		24: bin.Buffer(s => s.obj.colorMapLength, BGR24Array),
		32: bin.Buffer(s => s.obj.colorMapLength, BGRA32Array),
	})),
	_:		bin.Switch('imageType', {
		[TGAImageType.Grayscale]:		rawPixels(Uint8Array),
		[TGAImageType.ColorMapped]:		rawPixels(Uint8Array),
		[TGAImageType.TrueColor]:		bin.Switch(s => s.obj.bitsPerPixel, {
			15: rawPixels(BGR15Array),
			16: rawPixels(BGR15Array),
			24: rawPixels(BGR24Array),
			32: rawPixels(BGRA32Array),
		}),
		[TGAImageType.RLEGrayscale]:	RLEPixels(Uint8Array),
		[TGAImageType.RLEColorMapped]:	RLEPixels(Uint8Array),
		[TGAImageType.RLETrueColor]:	bin.Switch(s => s.obj.bitsPerPixel, {
			15: RLEPixels(BGR15Array),
			16: RLEPixels(BGR15Array),
			24: RLEPixels(BGR24Array),
			32: RLEPixels(BGRA32Array),
		})
	}),
};

export type TGAData = bin.ReadType<typeof TGASpec>;

export class TGA extends Image {
	constructor(tga: TGAData) {
		const {width, height, bitsPerPixel, imageType} = tga;
		super('2d', width, height);

		const flipRow: (i: number)=>number = tga.imageDescriptor.originTop ? i => i : i => height - 1 - i;
		switch (imageType) {
			case TGAImageType.Grayscale:
			case TGAImageType.RLEGrayscale:
				this.planes.Y = { width, height, getPixels: async () =>
					bin.typedArray.concatenate(Array.from({length: height}, (_, row) => tga.pixels.subarray(flipRow(row) * width, (flipRow(row) + 1) * width)))
				};
				break;

			case TGAImageType.TrueColor:
			case TGAImageType.RLETrueColor: {
				const hasAlpha = bitsPerPixel === 32;
				const channels = hasAlpha ? 4 : 3;
				this.planes[hasAlpha ? 'RGBA' : 'RGB'] = {
					width, height,
					getPixels: async() => bin.typedArray.concatenate(Array.from({length: height}, (_, row) => {
						const src = tga.pixels.subarray(flipRow(row) * width, (flipRow(row) + 1) * width);
						const out = new Uint8Array(width * channels);
						for (let i = 0, j = 0; i < src.length; i++, j += channels) {
							const p = src[i];
							putRgb(out, j, p.r, p.g, p.b);
							if (hasAlpha)
								out[j + 3] = (p as any).a;
						}
						return out;
					}))
				};
				break;
			}

			case TGAImageType.ColorMapped:
			case TGAImageType.RLEColorMapped: {
				const colorMap	= tga.colorMap;
				const origin	= tga.colorMapOrigin;
				this.unpalette	= i => {
					const p = colorMap![i - origin];
					return [p.r, p.g, p.b];
				};
				this.planes.I = {
					width, height,
					getPixels: async() => bin.typedArray.concatenate(Array.from({length: height}, (_, row) => tga.pixels.subarray(flipRow(row) * width, (flipRow(row) + 1) * width)))
				};
				break;
			}
		}
	}

	static load(data: Uint8Array): TGA {
		return new TGA(bin.read(new bin.stream(data), TGASpec));
	}
}
