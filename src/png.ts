import * as bin from '@isopodlabs/binary';
import {BaseImage, Options, Result, PlaneName, concatenateBuffers, greyToRgb, putRgba} from './common';

const u8 = bin.UINT8;
const u16be = bin.UINT16_BE;
const u32be = bin.UINT32_BE;

const Pixel32Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: 8, g: 8, r: 8, a: 8 } as const));

//-----------------------------------------------------------------------------
// PNG
//-----------------------------------------------------------------------------

// bytes per pixel for each PNG color type
const channelCount = [1, 0, 3, 1, 2, 0, 4];

const PNGType = {	//Bit Depths
	gray:	    0,	// 1,2,4,8,16
	rgb:		2,	// 8,16
	indexed:	3,	// 1,2,4,8   
	graya:	    4,	// 8,16      
	rgba:	    6,	// 8,16
	//noalpha:	0,
	//alpha:	    2,
};
const PNGFilter = {
	None:		0,
	Sub:		1,
	Up:			2,
	Average:	3,
	Paeth:		4,
};
const PNGInterlace = {
	NoInterlace:0,
	Adam7:		1,
};
const PNGCompression = {
	zlib:		0
};

const PNGIntent = {
	Perceptual:				0,
	RelativeColorimetric:	1,
	Saturation:				2,
	AbsoluteColorimetric:	3,
};

const PNGChrom = {
	x: u32be, y: u32be
};


const PNGChunk = {
	length: u32be,
	type:	bin.String(4),
	_:		bin.Merge(bin.Size('length', bin.Switch('type', {
		IHDR: {
			width:			u32be,
			height:			u32be,
			bitDepth:		u8,
			colorType:		bin.as(u8, bin.EnumV(PNGType)),
			compression:	bin.as(u8, bin.EnumV(PNGCompression)),
			filter:			bin.as(u8, bin.EnumV(PNGFilter)),
			interlace:		bin.as(u8, bin.EnumV(PNGInterlace)),
		},
		PLTE: { palette: bin.RemainingBuffer(Pixel32Array) },
		IDAT: { data:	bin.Remainder },
		tEXt: { text:	bin.RemainingString() },
		gAMA: { gamma:	bin.as(u32be, v => v / 100000) },
		tIME: { year: u16be, month: u8, day: u8, hour: u8, minute: u8, second: u8 },
		tRNS: { alpha: bin.RemainingBuffer(Uint8Array), trans: bin.as(u16be, v => v) },
		cHRM: { white: PNGChrom, red: PNGChrom, green: PNGChrom, blue: PNGChrom },
		sRGB: {	intent : bin.as(u8, bin.EnumV(PNGIntent)) },
		pHYs: {
			pixelsPerUnitX: u32be,
			pixelsPerUnitY: u32be,
			unit: 	u8,	//0: unknown, 1: meter
		},
		/*
		iCCP: {
			embedded_string	ProfileName;
			//Compression	CompressionMethod;
			//CompressedProfile: n bytes
		},
		zTXt: {
			embedded_string	Keyword;
			//Compression		CompressionMethod;
			//embedded_string	Text;
		};
		iTXt: {
			embedded_string	Keyword;
			//uint8				CompressionFlag;
			//Compression		CompressionMethod;
			//embedded_string	LanguageTag;
			//embedded_string	TranslatedKeyword;
			//embedded_string	Text;
		},
		bKGD: {
			uint8		index;	//3
			uint16be	Gray;	//0, 4
			rgb16		col;	//2, 6
		},
		sBIT: {
			uint8	gray_bits;			//0
			rgb8	col_bits;			//2,3
			ia8		gray_alpha_bits;	//4
			rgba8	col_alpha_bits;		//6
		},
		sPLT: {
			embedded_string	PaletteName;
			uint8			SampleDepth;
			struct Entry8	{ rgb8	col8;	uint16 freq; };
			struct Entry16	{ rgb16	col16;	uint16 freq; };
			union {
				Entry8	entries8[];
				Entry16	entries16[];
			}
		},
		hIST: {},
		CgBI: {
			enum {
				val1	= 0x06200050,
				val2	= 0x02200050,
			};
			//CGBitmapInfo bitmask.
			uint32be	cgbi;	// 0x50 0x00 0x20 0x06 or 0x50 0x00 0x20 0x02 
		},
		*/
		default: bin.Remainder,
	}))),
	crc: u32be,
};

export type PNGChunk = bin.ReadType<typeof PNGChunk>;

const PNGSpec = {
	sig:	bin.Expect(bin.String(8, 'latin1'), "\x89PNG\r\n\x1A\n"),
	chunks: bin.RemainingArray(PNGChunk),
};

export type PNGSpec = bin.ReadType<typeof PNGSpec>;


function paethPredictor(a: number, b: number, c: number) {
	const p = a + b - c;
	const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

const PNGPlanes: (PlaneName|undefined)[] = [
	'Y',	// 1,2,4,8,16
	undefined,
	'RGB',	// 8,16
	'I',	// 1,2,4,8   
	'YA',	// 8,16   
	undefined, 
	'RGBA',	// 8,16
];
export class PNG extends BaseImage {
	palette?: bin.utils.TypedArray<{r: number, g: number, b: number, a: number }>;
	colorType: number;
	bitDepth: number;

	constructor(ihdr: Extract<PNGChunk, {type: "IHDR"}>, pixels: Uint8Array, palette?: bin.utils.TypedArray<{r: number, g: number, b: number, a: number }>) {
		const {width, height, colorType, bitDepth} = ihdr;
		const planes = PNGPlanes[colorType]!;
		super('2d', width, height, {
			[planes]: {
				width, height,
				mips: [pixels],
			}
		});
		this.palette = palette;
		this.colorType = colorType;
		this.bitDepth = bitDepth;
	}
	async getPixels(options: Options): Promise<Result> {
		const bytes = (Object.values(this.planes)[0]).mips[0];
		const pixels = new Uint8Array(this.width * this.height * 4);
		switch (Object.keys(this.planes)[0] as PlaneName) {
			case 'Y':
				for (let i = 0, j = 0; i < bytes.length; i += 1, j += 4) {
					greyToRgb(pixels, j, bytes[i]);
					pixels[j + 3] = 255;
				}
				break;
			case 'RGB':
				for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4)
					putRgba(pixels, j, bytes[i], bytes[i + 1], bytes[i + 2], 255);
				break;
			case 'I':
				for (let i = 0, j = 0; i < bytes.length; i += 1, j += 4) {
					const col = this.palette![bytes[i]];
					putRgba(pixels, j, col.r, col.g, col.b, col.a);
				}
				break;
			case 'YA':
				for (let i = 0, j = 0; i < bytes.length; i += 2, j += 4) {
					greyToRgb(pixels, j, bytes[i]);
					pixels[j + 3] = bytes[i + 1];
				}
				break;
			case 'RGBA':
				for (let i = 0, j = 0; i < bytes.length; i += 4, j += 4)
					putRgba(pixels, j, bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
				break;
			default:
				throw new Error(`Unsupported PNG color type: ${this.colorType}`);
		}
		return {width: this.width, height: this.height, pixels};
	}

	static async load(data: Uint8Array): Promise<PNG> {
		const png = bin.read(new bin.stream(data), PNGSpec);
		const ihdr 		= png.chunks.find(c => c.type === 'IHDR');;

		if (!ihdr)
			throw new Error('PNG missing IHDR chunk');

		// Concatenate all IDAT chunks
		const compressed = concatenateBuffers(png.chunks.filter(c => c.type === 'IDAT').map(c => c.data));
		
		// Decompress and unfilter
		const raw		= await bin.decompress('deflate')(compressed);
		const bpp		= (channelCount[ihdr.colorType] * ihdr.bitDepth) >> 3;
		const width		= ihdr.width;
		const stride	= width * bpp;
		const pixels	= new Uint8Array(stride * ((raw.length / (stride + 1)) | 0));

		for (let y = 0, src = 0, dst = 0; dst < pixels.length; y++, dst += stride) {
			const filter = raw[src++];
			const row	= raw.subarray(src, src += stride);
			const prev	= y > 0 ? pixels.subarray(dst - stride, dst) : null;
			const cur	= pixels.subarray(dst, dst + stride);

			for (let x = 0; x < stride; x++) {
				const a = x >= bpp ? cur[x - bpp] : 0;
				const b = prev ? prev[x] : 0;
				const c = prev && x >= bpp ? prev[x - bpp] : 0;
				cur[x]	= filter === PNGFilter.None    ? row[x]
						: filter === PNGFilter.Sub     ? (row[x] + a) & 0xFF
						: filter === PNGFilter.Up      ? (row[x] + b) & 0xFF
						: filter === PNGFilter.Average ? (row[x] + ((a + b) >> 1)) & 0xFF
						: (row[x] + paethPredictor(a, b, c)) & 0xFF; // filter 4
			}
		}

		return new PNG(ihdr, pixels, png.chunks.find(c => c.type === 'PLTE')?.palette);
	}
};
