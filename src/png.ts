import * as bin from '@isopodlabs/binary';
import {Image, Options, PlaneName, concatenateBuffers} from './common';

const u8 = bin.UINT8;
const u16be = bin.UINT16_BE;
const u32be = bin.UINT32_BE;

const Pixel32Array	= bin.utils.BitFieldsTypedArray({ b: 8, g: 8, r: 8, a: 8 } as const);

//-----------------------------------------------------------------------------
// PNG
//-----------------------------------------------------------------------------

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

const channelCount = [1, 0, 3, 1, 2, 0, 4];

const PNGPlanes: (PlaneName|undefined)[] = [
	'Y',	// 1,2,4,8,16
	undefined,
	'RGB',	// 8,16
	'I',	// 1,2,4,8   
	'YA',	// 8,16   
	undefined, 
	'RGBA',	// 8,16
];

export class PNG extends Image {
	palette?: bin.utils.TypedArray<{r: number, g: number, b: number, a: number }>;
	colorType: number;
	bitDepth: number;

	constructor(ihdr: Extract<PNGChunk, {type: "IHDR"}>, pixels: Uint8Array, palette?: bin.utils.TypedArray<{r: number, g: number, b: number, a: number }>) {
		const {width, height, colorType, bitDepth} = ihdr;
		super('2d', width, height);
		this.planes[PNGPlanes[colorType]!] = {
			width,
			height,
			getPixels: async (_options: Options) => pixels
		};
		if (palette) {
			this.unpalette = i => {
				const col = palette[i];
				return [col.r, col.g, col.b];
			};
		}
		this.palette	= palette;
		this.colorType	= colorType;
		this.bitDepth	= bitDepth;
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
		const bpp		= (channelCount[ihdr.colorType] * ihdr.bitDepth + 7) >> 3;
		const stride	= (ihdr.width * channelCount[ihdr.colorType] * ihdr.bitDepth + 7) >> 3;
		const pixels	= new Uint8Array(stride * ((raw.length / (stride + 1)) | 0));

		for (let y = 0, src = 0, dst = 0; dst < pixels.length; y++, dst += stride) {
			const filter = raw[src++];
			const row	= raw.subarray(src, src += stride);
			const prev	= y > 0 ? pixels.subarray(dst - stride, dst) : null;
			const cur	= pixels.subarray(dst, dst + stride);

			const filters: Record<number, (x: number)=>number> =  {
				[PNGFilter.None]:		x => row[x],
				[PNGFilter.Sub]:		x => (row[x] + (x >= bpp ? cur[x - bpp] : 0)) & 0xFF,
				[PNGFilter.Up]:			x => (row[x] + (prev ? prev[x] : 0)) & 0xFF,
				[PNGFilter.Average]:	x => (row[x] + (((x >= bpp ? cur[x - bpp] : 0) + (prev ? prev[x] : 0)) >> 1)) & 0xFF,
				[PNGFilter.Paeth]:		x => (row[x] + paethPredictor(x >= bpp ? cur[x - bpp] : 0, prev ? prev[x] : 0, prev && x >= bpp ? prev[x - bpp] : 0)) & 0xFF
			};
			const f = filters[filter];
			for (let x = 0; x < stride; x++)
				cur[x]	= f(x);
		}

		return new PNG(ihdr, pixels, png.chunks.find(c => c.type === 'PLTE')?.palette);
	}
};
