import * as bin from '@isopodlabs/binary';
import {Image, Options, Result, PlaneName, to255, clamp8, greyToRgb, putRgb, labToRgb, cmykToRgb, convertInterleaved, convertPlanes, fillChannel} from './common';
import { JPEG } from './jpeg';

const u8 = bin.UINT8;
const u16 = bin.UINT16;
const u32 = bin.UINT32;

type Values<T> = T[keyof T]

//-----------------------------------------------------------------------------
// TIFF constants
//-----------------------------------------------------------------------------

const TIFFCompression = {
	None:		1,
	CCITT:		2,
	T4:			3,
	T6:			4,
	LZW:		5,
	JPEGold:	6,
	JPEG:		7,
	PackBits:	32773,
	Deflate:	32946,
	AdobeDeflate: 8,
} as const;

const TIFFPhotometric = {
	WhiteIsZero:	0,
	BlackIsZero:	1,
	RGB:			2,
	Palette:		3,
	TransparencyMask: 4,
	CMYK:			5,
	YCbCr:			6,
	CIELab:			8,
} as const;

const TIFFPlanarConfig = {
	Chunky:			1,	// RGBRGBRGB...
	Planar:			2,	// RRR...GGG...BBB...
} as const;

const TIFFResolutionUnit = {
	None:			1,
	Inch:			2,
	Centimeter:		3,
} as const;

const TIFFOrientation = {
	TopLeft:		1,
	TopRight:		2,
	BottomRight:	3,
	BottomLeft:		4,
	LeftTop:		5,
	RightTop:		6,
	RightBottom:	7,
	LeftBottom:		8,
} as const;

const TIFFSampleFormat = {
	UInt:			1,
	Int:			2,
	Float:			3,
	Undefined:		4,
} as const;

const TIFFExtraSamples = {
	Unspecified:			0,
	AssociatedAlpha:		1,	// pre-multiplied
	UnassociatedAlpha:		2,	// straight alpha
} as const;

const TIFFTag = {
	SubfileType:				{tag: 0x00fe, default: 0 as number},
	ImageWidth:					{tag: 0x0100, default: 0 as number},
	ImageLength:				{tag: 0x0101, default: 0 as number},
	BitsPerSample:				{tag: 0x0102, default: [8] as number[]},
	Compression:				{tag: 0x0103, default: TIFFCompression.None as Values<typeof TIFFCompression>},
	PhotometricInterpretation:	{tag: 0x0106, default: TIFFPhotometric.BlackIsZero as Values<typeof TIFFPhotometric>},
	Thresholding:				{tag: 0x0107, default: 0 as number},
	CellWidth:					{tag: 0x0108, default: 0 as number},
	CellLength:					{tag: 0x0109, default: 0 as number},
	FillOrder:					{tag: 0x010a, default: 0 as number},
	DocumentName:				{tag: 0x010d, default: '' as string},
	ImageDescription:			{tag: 0x010e, default: '' as string},
	Make:						{tag: 0x010f, default: '' as string},
	Model:						{tag: 0x0110, default: '' as string},
	StripOffsets:				{tag: 0x0111, default: [] as number[]},
	Orientation:				{tag: 0x0112, default: TIFFOrientation.TopLeft as Values<typeof TIFFOrientation>},
	SamplesPerPixel:			{tag: 0x0115, default: 1 as number},
	RowsPerStrip:				{tag: 0x0116, default: 0 as number},
	StripByteCounts:			{tag: 0x0117, default: [] as number[]},
	XResolution:				{tag: 0x011a, default: 0 as number},
	YResolution:				{tag: 0x011b, default: 0 as number},
	PlanarConfiguration:		{tag: 0x011c, default: TIFFPlanarConfig.Chunky as number},
	ResolutionUnit:				{tag: 0x0128, default: TIFFResolutionUnit.None as Values<typeof TIFFResolutionUnit>},
	PageNumber:					{tag: 0x0129, default: [] as number[]},
	ColorResponseUnit:			{tag: 0x012c, default: undefined},
	TransferFunction:			{tag: 0x012d, default: undefined},
	Software:					{tag: 0x0131, default: '' as string},
	DateTime:					{tag: 0x0132, default: '' as string},
	Artist:						{tag: 0x013b, default: '' as string},
	ColorMap:					{tag: 0x0140, default: undefined as number[] | undefined},
	TileWidth:					{tag: 0x0142, default: 0 as number},
	TileLength:					{tag: 0x0143, default: 0 as number},
	TileOffsets:				{tag: 0x0144, default: undefined as number[] | undefined},
	TileByteCounts:				{tag: 0x0145, default: [] as number[]},
	ExtraSamples:				{tag: 0x0152, default: TIFFExtraSamples.Unspecified as Values<typeof TIFFExtraSamples>},
	SampleFormat:				{tag: 0x0153, default: TIFFSampleFormat.UInt as Values<typeof TIFFSampleFormat>},
	JPEGTables:					{tag: 0x015b, default: undefined as Uint8Array | undefined},
	YCbCrCoefficients:			{tag: 0x0211, default: undefined as number[] | undefined},
	YCbCrSubSampling:			{tag: 0x0212, default: [2, 2] as number[]},
	YCbCrPositioning:			{tag: 0x0213, default: 1 as number},
	ReferenceBlackWhite:		{tag: 0x0214, default: undefined as number[] | undefined},
	ICCProfile:					{tag: 0x8773, default: undefined as Uint8Array | undefined},
} as const;

type Tags = {[K in keyof typeof TIFFTag]: (typeof TIFFTag)[K]['default'];}
const defaultTags = Object.fromEntries(Object.entries(TIFFTag).map(([k, v]) => [k, v.default])) as Tags;
const reverseTags = Object.fromEntries(Object.entries(TIFFTag).map(([k, v]) => [v.tag, k]));

//-----------------------------------------------------------------------------
// IFD tag reading
//-----------------------------------------------------------------------------

const TIFFFieldType = {
	BYTE:		1,
	ASCII:		2,
	SHORT:		3,
	LONG:		4,
	RATIONAL:	5,
	SBYTE:		6,
	UNDEFINED:	7,
	SSHORT:		8,
	SLONG:		9,
	SRATIONAL:	10,
	FLOAT:		11,
	DOUBLE:		12,
} as const;

const fieldValueType: Record<number, bin.TypeT<number>> = {
	[TIFFFieldType.BYTE]:		u8,
	[TIFFFieldType.ASCII]:		u8,
	[TIFFFieldType.SHORT]:		u16,
	[TIFFFieldType.LONG]:		u32,
	[TIFFFieldType.RATIONAL]:	bin.as([u32, u32] as const, x => x[0] / x[1]),
	[TIFFFieldType.SBYTE]:		bin.INT8,
	[TIFFFieldType.UNDEFINED]:	u8,
	[TIFFFieldType.SSHORT]:		bin.INT16,
	[TIFFFieldType.SLONG]:		bin.INT32,
	[TIFFFieldType.SRATIONAL]:	bin.as([bin.INT32, bin.INT32] as const, x => x[0] / x[1]),
	[TIFFFieldType.FLOAT]:		bin.Float32,
	[TIFFFieldType.DOUBLE]:		bin.Float64,
} as const;

// An IFD entry: reads its values either inline (≤4 bytes) or via offset
const TIFFEntry = {
	tag:		u16,
	type:		u16,//bin.as(u16, i => fieldValueType[i] ?? u8),
	count:		u32,
	values:		bin.FuncType(s => {
		const {type, count} = s.obj;
		const valType	= fieldValueType[type] ?? u8;
		const arrayType	= type === TIFFFieldType.ASCII ? bin.String(count)
						: type === TIFFFieldType.UNDEFINED ? bin.Buffer(count)
						: count === 1 ? valType
						: bin.Array(count, valType);

		return bin.measure(valType) * count <= 4
			? bin.Size(4, arrayType)
			: bin.Offset(s => u32.get(s) - s.masterOffset, arrayType);
	}),
};

const TIFFIFDSpec0 = {};
const TIFFIFDSpec = Object.assign(TIFFIFDSpec0, {
	entries:	bin.as(bin.Array(u16, TIFFEntry),
		entries => Object.fromEntries(entries.map(e => [reverseTags[e.tag] ?? e.tag, e.values])) as unknown as Tags
	),
	next: bin.Offset(s => {const off = u32.get(s); return off ? off - s.masterOffset : 0; }, TIFFIFDSpec0, true)
});

const TIFFSpec = {
	byteOrder:	bin.String(2),	// 'II' = LE, 'MM' = BE
	magic:		u16,			// 42
	ifd:		bin.Offset(u32, TIFFIFDSpec),
};

//-----------------------------------------------------------------------------
// decompression
//-----------------------------------------------------------------------------

function decodePackBits(src: Uint8Array, expectedBytes: number): Uint8Array {
	const out = new Uint8Array(expectedBytes);
	let i = 0, j = 0;
	while (i < src.length && j < expectedBytes) {
		const n = src[i++];
		if (n <= 127) {
			const count = n + 1;
			out.set(src.subarray(i, i + count), j);
			i += count;
			j += count;
		} else if (n !== 128) {
			const count = 257 - n;
			out.fill(src[i++], j, j + count);
			j += count;
		}
	}
	return out;
}

function decodeLZW(src: Uint8Array, expectedBytes: number): Uint8Array {
	const ClearCode = 256, EOICode = 257;
	const table: Uint8Array[] = [];

	const reset = () => {
		table.length = 0;
		for (let i = 0; i < 256; i++)
			table.push(new Uint8Array([i]));
		table.push(new Uint8Array(0)); // ClearCode placeholder
		table.push(new Uint8Array(0)); // EOICode placeholder
	};
	reset();

	const out = new Uint8Array(expectedBytes);
	let dst = 0, bitPos = 0, codeSize = 9, prev = -1;

	const readCode = (): number => {
		const byteIdx = bitPos >> 3;
		const bitIdx  = bitPos & 7;
		// TIFF LZW is MSB-first
		const val = ((src[byteIdx] << 16) | (src[byteIdx + 1] << 8) | src[byteIdx + 2]) >>> (24 - bitIdx - codeSize);
		bitPos += codeSize;
		return val & ((1 << codeSize) - 1);
	};

	while (bitPos < src.length * 8) {
		const code = readCode();
		if (code === EOICode)
			break;

		if (code === ClearCode) {
			reset();
			codeSize = 9;
			prev = -1;

		} else {
			const entry = code < table.length ? table[code] : (prev >= 0 ? new Uint8Array([...table[prev], table[prev][0]]) : new Uint8Array());
			out.set(entry, dst);
			dst += entry.length;

			if (prev >= 0)
				table.push(new Uint8Array([...table[prev], entry[0]]));

			prev = code;
			if (table.length + 1 >= (1 << codeSize) && codeSize < 12)
				codeSize++;
		}
	}
	return out;
}

function chunkGetter(data: Uint8Array, tags: Tags): (bitsPerPixel: number, plane: number) => Promise<Uint8Array> {
	let decompress: (data: Uint8Array, expectedBytes: number) => Promise<Uint8Array>;
	switch (tags.Compression) {
		case TIFFCompression.None: 			decompress = async data => data; break;
		case TIFFCompression.PackBits:		decompress = async (data, expectedBytes) => decodePackBits(data, expectedBytes); break;
		case TIFFCompression.LZW:			decompress = async (data, expectedBytes) => decodeLZW(data, expectedBytes); break;
		case TIFFCompression.Deflate:		decompress = async data => bin.decompress('deflate-raw')(data); break;
		case TIFFCompression.AdobeDeflate:	decompress = async data => bin.decompress('deflate-raw')(data); break;
		case TIFFCompression.JPEG: {
			const tables = tags.JPEGTables;
			decompress = async data => {
				const jpg = JPEG.load(bin.typedArray.concatenate([tables!, data]));
				const result = await jpg.getPixels({plane: 'YCbCr'});
				return new Uint8Array(result.pixels);
			};
			break;
		}
		default:
			throw new Error(`Unsupported TIFF compression: ${tags.Compression}`);
	}

	const width = tags.ImageWidth, height = tags.ImageLength;

	return tags.TileOffsets
		? async (bitsPerPixel, plane) => {
			const tileOffsets		= tags.TileOffsets!;
			const rowBytes			= ((width * bitsPerPixel) + 7) >> 3;
			const raw				= new Uint8Array(height * rowBytes);
			const tileRowBytes		= ((tags.TileWidth * bitsPerPixel) + 7) >> 3;
			const tilesX			= Math.ceil(width / tags.TileWidth);
			const tilesY			= Math.ceil(height / tags.TileLength);
			for (let ty = 0; ty < tilesY; ty++) {
				for (let tx = 0; tx < tilesX; tx++) {
					const idx		= (plane * tilesY + ty * tilesX) + tx;
					const decoded	= await decompress(data.subarray(tileOffsets[idx], tileOffsets[idx] + tags.TileByteCounts[idx]), tileRowBytes * tags.TileLength);
					const rows		= Math.min(tags.TileLength, height - ty * tags.TileLength);
					for (let row = 0; row < rows; row++) {
						const cols		= Math.min(tags.TileWidth, width - tx * tags.TileWidth);
						const colBytes	= ((cols * bitsPerPixel) + 7) >> 3;
						const dstY		= plane * height + ty * tags.TileLength + row;
						raw.set(decoded.subarray(row * tileRowBytes, row * tileRowBytes + colBytes), dstY * rowBytes + tx * tileRowBytes);
					}
				}
			}
			return raw;

		} : async (bitsPerPixel, plane) => {
			const rowBytes			= ((width * bitsPerPixel) + 7) >> 3;
			const raw				= new Uint8Array(height * rowBytes);
			const rowsPerStrip		= tags.RowsPerStrip || height;
			const stripsPerPlane	= Math.ceil(height / rowsPerStrip);
			for (let sy = 0; sy < stripsPerPlane; sy++) {
				const idx		= plane * stripsPerPlane + sy;
				const rows		= Math.min(rowsPerStrip, height - sy * rowsPerStrip);
				const decoded	= await decompress(data.subarray(tags.StripOffsets[idx], tags.StripOffsets[idx] + tags.StripByteCounts[idx]), rowBytes * rows);
				raw.set(decoded.subarray(0, rows * rowBytes), sy * rowsPerStrip * rowBytes);
			}
			return raw;
		};
}

function makeYCbCrToRgb(coeffs = [0.299, 0.587, 0.114], refBW = [0, 255, 128, 255, 128, 255]) {
	const [Kr, , Kb] = coeffs;
	const Kg = 1 - Kr - Kb;
	const [refBlackY, refWhiteY, refBlackCb, refWhiteCb, refBlackCr, refWhiteCr] = refBW;
	const scaleY  = 255 / (refWhiteY  - refBlackY);
	const scaleCb = 255 / (refWhiteCb - refBlackCb);
	const scaleCr = 255 / (refWhiteCr - refBlackCr);
	const cr2r = 2 * (1 - Kr);
	const cb2b = 2 * (1 - Kb);
	const cr2g = Kr / Kg * cr2r;
	const cb2g = Kb / Kg * cb2b;

	return (pixels: Uint8Array, i: number, Y: number, Cb: number, Cr: number) => {
		const y  = (Y  - refBlackY)  * scaleY;
		const cb = (Cb - refBlackCb) * scaleCb - 128;
		const cr = (Cr - refBlackCr) * scaleCr - 128;
		pixels[i + 0] = clamp8((y + cr * cr2r             + 0.5) | 0);
		pixels[i + 1] = clamp8((y - cr * cr2g - cb * cb2g + 0.5) | 0);
		pixels[i + 2] = clamp8((y + cb * cb2b             + 0.5) | 0);
	};
}

//-----------------------------------------------------------------------------
// TIFF class
//-----------------------------------------------------------------------------

export class TIFF extends Image {
	toRgb?: (options: Options) => Promise<Result>;

	constructor(data: Uint8Array, tags: Tags) {
		const width = tags.ImageWidth, height = tags.ImageLength;
		super('2d', width, height);

		const colorMap			= tags.ColorMap;
		if (colorMap) {
			this.unpalette = (i: number) => [
				colorMap[i] >> 8,
				colorMap[colorMap.length / 3 + i] >> 8,
				colorMap[colorMap.length / 3 * 2 + i] >> 8,
			];
		}

		const aget = chunkGetter(data, tags);

		const bitsPerSample		= tags.BitsPerSample[0];
		const samplesPerPixel	= tags.SamplesPerPixel;
		const arrayType			= bin.typedArray.BitFields(to255(bitsPerSample));
		const numPixels			= width * height;
		const photometric		= tags.PhotometricInterpretation;

		let toRgb: ((pixels: Uint8Array, i: number, ...args: number[]) => void) | undefined;
		let planeName: PlaneName = 'Y';

		switch (photometric) {
			case TIFFPhotometric.WhiteIsZero:
			case TIFFPhotometric.BlackIsZero:
				toRgb = (pixels, i, x) => greyToRgb(pixels, i, x);
				break;
			case TIFFPhotometric.RGB:
				planeName = 'RGB';
				toRgb = (pixels, i, r, g, b) => putRgb(pixels, i, r, g, b);
				break;
			case TIFFPhotometric.Palette:
				planeName = 'I';
				toRgb = (pixels, i, x) => {const c = this.unpalette!(x); putRgb(pixels, i, c[0], c[1], c[2]); };
				break;
			case TIFFPhotometric.CMYK:
				planeName = 'CyMaYeK';
				toRgb = (pixels, i, c, m, y, k) => cmykToRgb(pixels, i, c, m, y, k);
				break;
			case TIFFPhotometric.YCbCr:
				planeName = 'YCbCr';
				toRgb = makeYCbCrToRgb(tags.YCbCrCoefficients, tags.ReferenceBlackWhite);
				break;
			case TIFFPhotometric.CIELab:
				planeName = 'LLaLb';
				toRgb = (pixels, i, l, a, b) => labToRgb(pixels, i, l, a, b);
				break;
		}

		if (tags.ExtraSamples !== TIFFExtraSamples.Unspecified)
			planeName = planeName + 'A' as PlaneName;

		if (photometric == TIFFPhotometric.WhiteIsZero) {
			const araw = aget(bitsPerSample, 0);
			this.planes.Y = {width, height, getPixels: async () => {
				const raw	= await araw;
		        return Uint8Array.from(new arrayType(raw.buffer, raw.byteOffset, numPixels), v => 255 - v);
			}};
			
		} else if (tags.PlanarConfiguration === TIFFPlanarConfig.Planar) {
			const planeNames = [...planeName.matchAll(/[A-Z][a-z]*/g)].map(c => c[0] as PlaneName);

			for (let plane = 0; plane < samplesPerPixel; plane++) {
				const araw = aget(bitsPerSample, plane);
				this.planes[planeNames[plane]] = {width, height, getPixels: async () => {
					const raw	= await araw;
					return new Uint8Array(new arrayType(raw.buffer, raw.byteOffset, numPixels));
				}};
			}
			this.toRgb = async (options: Options) => convertPlanes(options.plane, Object.values(this.planes), width, height, options.plane === 'RGBA' ? 4 : 3, options, toRgb!);

		} else {
			const araw	= aget(samplesPerPixel * bitsPerSample, 0);
			const plane = {width, height, getPixels: async () => {
				const raw	= await araw;
				return new Uint8Array(new arrayType(raw.buffer, raw.byteOffset, numPixels * samplesPerPixel));
			}};
			this.planes[planeName] = plane;
			this.toRgb = async (options: Options) => convertInterleaved(options.plane, plane, options.plane === 'RGBA' ? 4 : 3, options, toRgb!);
		}
	}

	async getPixels(options: Options) {
		if ((options.plane === 'RGBA' || options.plane === 'RGB') && this.toRgb) {
			const result = await this.toRgb(options);
			if (options.plane === 'RGBA')
				fillChannel(result, 4, await this.planes.A?.getPixels?.(options) ?? 255, 3);
			return result;
		}
		return super.getPixels(options);
	}

	static load(data: Uint8Array): TIFF {
		// peek byte order before setting stream endianness
		const s = new bin.stream(data, data[0] === 0x4D);
		const tiff = s.read(TIFFSpec);
		if (tiff.magic !== 42)
			throw new Error('Not a valid TIFF file');

		const images: TIFF[] = [];
		for (let ifd = tiff.ifd; ifd; ifd = ifd.next as typeof ifd)
			images.push(new TIFF(data, {...defaultTags, ...ifd.entries}));

		if (images.length === 1)
			return images[0];

		return new TIFFMulti(images);
	}
}

export class TIFFMulti extends Image {
	constructor(public layers: TIFF[]) {
		super('2d-array', layers[0].width, layers[0].height);
		this.depth = layers.length;
	}
	getLayer(layer: string | number): Image | undefined {
		return this.layers[+layer];
	}
	async getPixels(options: Options) {
		if (options.layer !== undefined) {
			const layer = this.getLayer(options.layer);
			if (!layer)
				throw new Error(`Layer ${options.layer} not found`);
			return layer.getPixels(options);
		}
		const results = await Promise.all(this.layers.map(layer => layer.getPixels(options)));
		return {
			plane: options.plane,
			width: this.width,
			height: this.height * results.length,
			pixels: bin.typedArray.concatenate(results.map(r => r.pixels)),
		};
	}
}