import * as bin from '@isopodlabs/binary';
import {Image, Options, to255, putRgb, putRgba} from './common';

//-----------------------------------------------------------------------------
// BMP
//-----------------------------------------------------------------------------

const u16 = bin.UINT16_LE;
const u32 = bin.UINT32_LE;
const s32 = bin.INT32_LE;

const Pixel16Array	= bin.utils.BitFieldsTypedArray({ b: to255(5), g: to255(5), r: to255(5), x: 1 } as const);
const Pixel24Array	= bin.utils.BitFieldsTypedArray({ b: 8, g: 8, r: 8 } as const);
const Pixel32Array	= bin.utils.BitFieldsTypedArray({ b: 8, g: 8, r: 8, a: 8 } as const);
const Uint1Array	= bin.utils.UintTypedArray(1);
const Uint4Array	= bin.utils.UintTypedArray(4);

const BMPcompression = {
	RGB:      		0,
	RLE8:     		1,
	RLE4:     		2,
	BITFIELDS:		3,
	JPEG:     		4,
	PNG:      		5,
};
const BMPheader = {
	width:			s32,
	height:			s32,
	planes:			u16,
	bitsPerPixel:	u16,
	compression:	bin.as(u32, bin.EnumV(BMPcompression)),
	imageSize:		u32,
	xPPM:			s32,
	yPPM:			s32,
	colorsUsed:		u32,
	colorsImportant:u32,
};

const BMPSpec = {
	magic:			bin.Expect(bin.String(2), 'BM'),
	fileSize:		u32,
	reserved:		u32,
	dataOffset:		u32,
	dibSize:		u32,
	header:			BMPheader,

	palette: bin.Optional(
		s => s.obj.bitsPerPixel <= 8,
		bin.Buffer(
			s => s.obj.colorsUsed || (1 << s.obj.bitsPerPixel),
			Pixel32Array
		)
	),

	pixels: bin.Offset(s => s.obj.dataOffset, bin.Array(s => Math.abs(s.obj.header.height),
		bin.Aligned(4, bin.Switch(s => s.obj.header.bitsPerPixel, {
			1:	bin.Buffer(s => s.obj.header.width, Uint1Array),
			4:	bin.Buffer(s => s.obj.header.width, Uint4Array),
			8:	bin.Buffer(s => s.obj.header.width, Uint8Array),
			16: bin.Buffer(s => s.obj.header.width, Pixel16Array),
			24: bin.Buffer(s => s.obj.header.width, Pixel24Array),
			32: bin.Buffer(s => s.obj.header.width, Pixel32Array),
		}))
	)),
};

export class BMP extends Image {
//	palette?: bin.utils.TypedArray<{r: number, g: number, b: number, a: number }>;

	constructor(bmp: bin.ReadType<typeof BMPSpec>) {
		const width		= bmp.header.width;
		const height	= bmp.header.height;
		super('2d', width, height);
		if (bmp.palette)
			this.unpalette = i => {
				const col = bmp.palette![i];
				return [col.r, col.g, col.b];
			};

		switch (bmp.header.bitsPerPixel) {
			case 1:
			case 4:
			case 8:
				this.planes[bmp.palette ? 'I' : 'Y'] = {
					width, height,
					async getPixels(options: Options) {
						const out = new Uint8Array(width * height);
						for (let row = 0; row < height; row++)
							out.set(bmp.pixels[height - 1 - row] as bin.utils.TypedArray<number>, row * width);
						return out;
					}
				};
				break;
					
			case 16: 
			case 24:
				this.planes.RGB = {
					width, height,
					async getPixels(options: Options) {
						const out = new Uint8Array(width * height * 3);
						for (let row = 0, j = 0; row < height; row++) {
							const src = bmp.pixels[height - 1 - row];
							for (let i = 0; i < src.length; i++, j += 3) {
								const p = src[i] as any;
								putRgb(out, j, p.r, p.g, p.b);
							}
						}
						return out;
					}
				};
				break;
			case 32:
				this.planes.RGBA = {
					width, height,
					async getPixels(options: Options) {
						const out = new Uint8Array(width * height * 4);
						for (let row = 0, j = 0; row < height; row++) {
							const src = bmp.pixels[height - 1 - row];
							for (let i = 0; i < src.length; i++, j += 4) {
								const p = src[i] as any;
								putRgba(out, j, p.r, p.g, p.b, p.a);
							}
						}
						return out;
					}
				};
				break;
		}
	}
	static load(data: Uint8Array): BMP {
		return new BMP(bin.read(new bin.stream(data), BMPSpec));
	}
};
