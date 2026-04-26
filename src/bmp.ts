import * as bin from '@isopodlabs/binary';
import {BaseImage, Options, Result, PlaneName, concatenateBuffers, greyToRgb, putRgb, putRgba} from './common';

//-----------------------------------------------------------------------------
// BMP
//-----------------------------------------------------------------------------

const u16 = bin.UINT16_LE;
const u32 = bin.UINT32_LE;
const s32 = bin.INT32_LE;

const Channel5Bit 	= bin.BitField(5, {to: i => i << 3, from: v => v >> 3});
const Pixel16Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: Channel5Bit, g: Channel5Bit, r: Channel5Bit, x: 1 } as const));
const Pixel24Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: 8, g: 8, r: 8 } as const));
const Pixel32Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: 8, g: 8, r: 8, a: 8 } as const));
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

export class BMP extends BaseImage {
	palette?: bin.utils.TypedArray<{r: number, g: number, b: number, a: number }>;

	constructor(bmp: bin.ReadType<typeof BMPSpec>) {
		const bitsPerPixel = bmp.header.bitsPerPixel;
		const planeName: PlaneName = bitsPerPixel <= 8 ? (bmp.palette ? 'I' : 'Y') : bitsPerPixel === 24 ? 'RGB' : 'RGBA';
		super('2d', bmp.header.width, bmp.header.height, {
			[planeName]: {
				width:	bmp.header.width,
				height:	bmp.header.height,
				mips:	[concatenateBuffers(bmp.pixels.reverse())],
			}
		});
		this.palette = bmp.palette;
	}
	async getPixels(options: Options): Promise<Result> {
		const bpp		= options.plane === 'RGB' ? 3 : 4;
		const pixels	= new Uint8Array(this.width * this.height * bpp);

		if (this.planes.I) {
			const raw = this.planes.I.mips[0];
			const palette = this.palette!;
			switch (options.plane) {
				case 'RGB':
					for (let i = 0, j = 0; i < raw.length; i += 1, j += 3) {
						const col = palette[raw[i]];
						putRgb(pixels, j, col.r, col.g, col.b);
					}
					break;
				case 'RGBA':
					for (let i = 0, j = 0; i < raw.length; i += 1, j += 4) {
						const col = palette[raw[i]];
						putRgba(pixels, j, col.r, col.g, col.b, col.a);
					}
					break;
			}
		} else if (this.planes.RGB) {
			const raw		= this.planes.RGB.mips[0];
			switch (options.plane) {
				case 'RGB':
					for (let i = 0, j = 0; i < raw.length; i++, j += 3)
						putRgb(pixels, j, raw[i].r, raw[i].g, raw[i].b);
					break;
				case 'RGBA':
					for (let i = 0, j = 0; i < raw.length; i++, j += 4)
						putRgba(pixels, j, raw[i].r, raw[i].g, raw[i].b, 255);
					break;
			}

		} else if (this.planes.RGBA) {
			const raw		= this.planes.RGBA.mips[0];
			switch (options.plane) {
				case 'RGB':
					for (let i = 0, j = 0; i < raw.length; i++, j += 3)
						putRgb(pixels, j, raw[i].r, raw[i].g, raw[i].b);
					break;
				case 'RGBA':
					for (let i = 0, j = 0; i < raw.length; i++, j += 4)
						putRgba(pixels, j, raw[i].r, raw[i].g, raw[i].b, raw[i].a);
					break;
			}
		} else if (this.planes.Y) {
			const raw		= this.planes.Y.mips[0];
			switch (options.plane) {
				case 'RGB':
					for (let i = 0, j = 0; i < raw.length; i++, j += 3)
						greyToRgb(pixels, j, raw[i]);
					break;
				case 'RGBA':
					for (let i = 0, j = 0; i < raw.length; i++, j += 4) {
						greyToRgb(pixels, j, raw[i]);
						pixels[j + 3] = 255;
					}
					break;
			}
		} else {
			throw new Error(`Unsupported`);
		}
		return {width: this.width, height: this.height, pixels};
	}

	static load(data: Uint8Array): BMP {
		return new BMP(bin.read(new bin.stream(data), BMPSpec));
	}
};
