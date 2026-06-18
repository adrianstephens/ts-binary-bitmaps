import * as bin from '@isopodlabs/binary';
import {Image, Options, PlaneName, PlaneType, Result, Type, putRgb, putRgba, ycbcrToRgb, to255, mipSize} from './common';

const u32 = bin.UINT32_LE;

//-----------------------------------------------------------------------------
// DDS
//----------------------------------------------------------------------------- 

const DXGI_FORMAT = {
	UNKNOWN:					0,
	R32G32B32A32_TYPELESS:		1,
	R32G32B32A32_FLOAT:			2,
	R32G32B32A32_UINT:			3,
	R32G32B32A32_SINT:			4,
	R32G32B32_TYPELESS:			5,
	R32G32B32_FLOAT:			6,
	R32G32B32_UINT:				7,
	R32G32B32_SINT:				8,
	R16G16B16A16_TYPELESS:		9,
	R16G16B16A16_FLOAT:			10,
	R16G16B16A16_UNORM:			11,
	R16G16B16A16_UINT:			12,
	R16G16B16A16_SNORM:			13,
	R16G16B16A16_SINT:			14,
	R32G32_TYPELESS:			15,
	R32G32_FLOAT:				16,
	R32G32_UINT:				17,
	R32G32_SINT:				18,
	R32G8X24_TYPELESS:			19,
	D32_FLOAT_S8X24_UINT:		20,
	R32_FLOAT_X8X24_TYPELESS:	21,
	X32_TYPELESS_G8X24_UINT:	22,
	R10G10B10A2_TYPELESS:		23,
	R10G10B10A2_UNORM:			24,
	R10G10B10A2_UINT:			25,
	R11G11B10_FLOAT:			26,
	R8G8B8A8_TYPELESS:			27,
	R8G8B8A8_UNORM:				28,
	R8G8B8A8_UNORM_SRGB:		29,
	R8G8B8A8_UINT:				30,
	R8G8B8A8_SNORM:				31,
	R8G8B8A8_SINT:				32,
	R16G16_TYPELESS:			33,
	R16G16_FLOAT:				34,
	R16G16_UNORM:				35,
	R16G16_UINT:				36,
	R16G16_SNORM:				37,
	R16G16_SINT:				38,
	R32_TYPELESS:				39,
	D32_FLOAT:					40,
	R32_FLOAT:					41,
	R32_UINT:					42,
	R32_SINT:					43,
	R24G8_TYPELESS:				44,
	D24_UNORM_S8_UINT:			45,
	R24_UNORM_X8_TYPELESS:		46,
	X24_TYPELESS_G8_UINT:		47,
	R8G8_TYPELESS:				48,
	R8G8_UNORM:					49,
	R8G8_UINT:					50,
	R8G8_SNORM:					51,
	R8G8_SINT:					52,
	R16_TYPELESS:				53,
	R16_FLOAT:					54,
	D16_UNORM:					55,
	R16_UNORM:					56,
	R16_UINT:					57,
	R16_SNORM:					58,
	R16_SINT:					59,
	R8_TYPELESS:				60,
	R8_UNORM:					61,
	R8_UINT:					62,
	R8_SNORM:					63,
	R8_SINT:					64,
	A8_UNORM:					65,
	R1_UNORM:					66,
	R9G9B9E5_SHAREDEXP:			67,
	R8G8_B8G8_UNORM:			68,
	G8R8_G8B8_UNORM:			69,
	BC1_TYPELESS:				70,
	BC1_UNORM:					71,
	BC1_UNORM_SRGB:				72,
	BC2_TYPELESS:				73,
	BC2_UNORM:					74,
	BC2_UNORM_SRGB:				75,
	BC3_TYPELESS:				76,
	BC3_UNORM:					77,
	BC3_UNORM_SRGB:				78,
	BC4_TYPELESS:				79,
	BC4_UNORM:					80,
	BC4_SNORM:					81,
	BC5_TYPELESS:				82,
	BC5_UNORM:					83,
	BC5_SNORM:					84,
	B5G6R5_UNORM:				85,
	B5G5R5A1_UNORM:				86,
	B8G8R8A8_UNORM:				87,
	B8G8R8X8_UNORM:				88,
	R10G10B10_XR_BIAS_A2_UNORM:	89,
	B8G8R8A8_TYPELESS:			90,
	B8G8R8A8_UNORM_SRGB:		91,
	B8G8R8X8_TYPELESS:			92,
	B8G8R8X8_UNORM_SRGB:		93,
	BC6H_TYPELESS:				94,
	BC6H_UF16:					95,
	BC6H_SF16:					96,
	BC7_TYPELESS:				97,
	BC7_UNORM:					98,
	BC7_UNORM_SRGB:				99,
	AYUV:						100,
	Y410:						101,
	Y416:						102,
	NV12:						103,
	P010:						104,
	P016:						105,
	OPAQUE_420:					106,
	YUY2:						107,
	Y210:						108,
	Y216:						109,
	NV11:						110,
	AI44:						111,
	IA44:						112,
	P8:							113,
	A8P8:						114,
	B4G4R4A4_UNORM:				115,
	P208:						130,
	V208:						131,
	V408:						132,
	A4B4G4R4_UNORM:				191,

	BC2_PREMUL:				0x80000000, // not an official DXGI format, but commonly used in legacy DXT2 files
	BC3_PREMUL:				0x80000001, // not an official DXGI format, but commonly used in legacy DXT4 files
} as const;

const rgb565 = bin.bitfields.BitFields(0, { r: to255(5), g: to255(6), b: to255(5) } as const);

const BC1 = {
	color0:	16,
	color1:	16,
	indices: bin.bitfields.Array(16, 2),
} as const;

const BC4 = {
	a0:		8,
	a1:		8,
	indices: bin.bitfields.Array(16, 3),
} as const;

function BCcolors(color0: number, color1: number, alt = false) {
	const c0 = rgb565.to(color0);
	const c1 = rgb565.to(color1);
	return alt ? [
		c0,
		c1,
		{r: ((c0.r + c1.r) / 2) | 0, g: ((c0.g + c1.g) / 2) | 0, b: ((c0.b + c1.b) / 2) | 0},
		{r: 0, g: 0, b: 0}
	] : [
		c0,
		c1,
		{r: ((2 * c0.r + c1.r) / 3) | 0, g: ((2 * c0.g + c1.g) / 3) | 0, b: ((2 * c0.b + c1.b) / 3) | 0},
		{r: ((c0.r + 2 * c1.r) / 3) | 0, g: ((c0.g + 2 * c1.g) / 3) | 0, b: ((c0.b + 2 * c1.b) / 3) | 0}
	];
}

function BCalphas(a0: number, a1: number) {
	return a0 > a1 ? [
		a0,
		a1,
		((6 * a0 + 1 * a1) / 7) | 0,
		((5 * a0 + 2 * a1) / 7) | 0,
		((4 * a0 + 3 * a1) / 7) | 0,
		((3 * a0 + 4 * a1) / 7) | 0,
		((2 * a0 + 5 * a1) / 7) | 0,
		((1 * a0 + 6 * a1) / 7) | 0
	] : [
		a0,
		a1,
		((4 * a0 + 1 * a1) / 5) | 0,
		((3 * a0 + 2 * a1) / 5) | 0,
		((2 * a0 + 3 * a1) / 5) | 0,
		((1 * a0 + 4 * a1) / 5) | 0,
		0,
		255
	];
}

const r8g8b8a8		= bin.typedArray.BitFields({ r: 8,	g: 8, b: 8, a: 8 } as const);
const r8g8			= bin.typedArray.BitFields({ r: 8,	g: 8 } as const);
const r10g10b10a2	= bin.typedArray.BitFields({ r: 10, g: 10, b: 10, a: 2	} as const);
const r16g16b16a16	= bin.typedArray.BitFields({ r: 16, g: 16, b: 16, a: 16 } as const);
const r16g16		= bin.typedArray.BitFields({ r: 16, g: 16 } as const);
const r4g4			= bin.typedArray.BitFields({ r: 4,	g: 4 } as const);
const g4r4			= bin.typedArray.BitFields({ g: 4,	r: 4 } as const);

const BC1BlockPixels = bin.bitfields.Chain(BC1, {
	to(block) {
		const alt		= block.color0 <= block.color1;
		const colors	= BCcolors(block.color0, block.color1, alt);
		const out		= new r8g8b8a8(16);
		for (let i = 0; i < 16; i++) {
			const x = block.indices[i];
			out[i] = {...colors[x], a: alt && x === 3 ? 0 : 255};
		}
		return {block: out};
	},
	from() { throw new Error('DXT1 block write not supported'); },
});

const BC2BlockPixels = bin.bitfields.Chain({alpha: bin.bitfields.Array(16,4), col: BC1} as const, {
	to(block) {
		const colors	= BCcolors(block.col.color0, block.col.color1, false);
		const out		= new r8g8b8a8(16);
		for (let i = 0; i < 16; i++)
			out[i] = {...colors[block.col.indices[i]], a: block.alpha[i] * 17};
		return {block: out};
	},
	from() { throw new Error('DXT3 block write not supported'); },
});

const BC3BlockPixels = bin.bitfields.Chain({alpha: BC4, col: BC1} as const, {
	to(block) {
		const alphas	= BCalphas(block.alpha.a0, block.alpha.a1);
		const colors	= BCcolors(block.col.color0, block.col.color1, false);
		const out		= new r8g8b8a8(16);
		for (let i = 0; i < 16; i++)
			out[i] = {...colors[block.col.indices[i]], a: alphas[block.alpha.indices[i]]};
		return {block: out};
	},
	from() { throw new Error('DXT5 block write not supported'); }
});

const BC4BlockPixels = bin.bitfields.Chain(BC4, {
	to(block) {
		const alphas	= BCalphas(block.a0, block.a1);
		const out		= new Uint8Array(16);
		for (let i = 0; i < 16; i++)
			out[i] = alphas[block.indices[i]];
		return {block: out};
	},
	from() { throw new Error('BC4 block write not supported'); }
});

const BC5BlockPixels = bin.bitfields.Chain({r: BC4, g: BC4} as const, {
	to(block) {
		const reds	= BCalphas(block.r.a0, block.r.a1);
		const greens	= BCalphas(block.g.a0, block.g.a1);
		const out		= new r8g8(16);
		for (let i = 0; i < 16; i++)
			out[i] = {r: reds[block.r.indices[i]], g: greens[block.g.indices[i]]};
		return {block: out};
	},
	from() { throw new Error('BC5 block write not supported'); }
});

interface LAYOUT {
	plane:	PlaneName;
	array:	bin.typedArray.TypedArrayConstructor<any>;
	hscale?: number;
	vscale?: number;
};

const LayoutInfo: Record<string, LAYOUT | LAYOUT[]> = {
	UNKNOWN:			{ plane: '?', 		array: Uint8Array },
	R32G32B32A32:		{ plane: 'RGBA', 	array: bin.typedArray.BitFields({ r: 32, g: 32, b: 32, a: 32	})},
	R32G32B32:			{ plane: 'RGB', 	array: bin.typedArray.BitFields({ r: 32, g: 32, b: 32 })},
	R16G16B16A16:		{ plane: 'RGBA', 	array: r16g16b16a16 },
	R32G32:				{ plane: 'RG', 		array: bin.typedArray.BitFields({ r: 32, g: 32 })},
	R32G8X24:			{ plane: 'RG', 		array: bin.typedArray.BitFields({ r: 32, g: 8 })},
	R10G10B10A2:		{ plane: 'RGBA', 	array: r10g10b10a2 },
	R11G11B10:			{ plane: 'RGB', 	array: bin.typedArray.BitFields({ r: 11, g: 11, b: 10	})},
	R8G8B8A8:			{ plane: 'RGBA', 	array: r8g8b8a8 },
	R16G16:				{ plane: 'RG', 		array: r16g16 },
	R32:				{ plane: 'R', 		array: Uint32Array },
	R24G8:				{ plane: 'RG', 		array: bin.typedArray.BitFields({ r: 24, g: 8 })},
	R8G8:				{ plane: 'RG', 		array: r8g8 },
	R16:				{ plane: 'R', 		array: Uint16Array },
	R8:					{ plane: 'R', 		array: Uint8Array },
	A8:					{ plane: 'A', 		array: Uint8Array },
	R1:					{ plane: 'R', 		array: bin.typedArray.Uint(1) },
	B5G6R5:				{ plane: 'RGB', 	array: bin.typedArray.BitFields({ r: 5, g: 6, b: 5 })},
	B5G5R5A1:			{ plane: 'RGBA', 	array: bin.typedArray.BitFields({ r: 5, g: 5, b: 5, a: 1 })},
	R4G4B4A4:			{ plane: 'RGBA', 	array: bin.typedArray.BitFields({ r: 4, g: 4, b: 4, a: 4 })},
	R9G9B9E5:			{ plane: 'RGB', 	array: bin.typedArray.BitFields({ r: 9, g: 9, b: 9 })},
	R8G8_B8G8:			{ plane: 'RGBA', 	array: bin.typedArray.BitFields({ r: 8, g: 8, b: 8, a: 8 })},
	G8R8_G8B8:			{ plane: 'RGBA', 	array: bin.typedArray.BitFields({ r: 8, g: 8, b: 8, a: 8 })},
	BC1:				{ plane: 'RGBA', 	array: bin.typedArray.BitFields(BC1BlockPixels) },
	BC2:				{ plane: 'RGBA', 	array: bin.typedArray.BitFields(BC2BlockPixels) },
	BC3:				{ plane: 'RGBA', 	array: bin.typedArray.BitFields(BC3BlockPixels) },
	BC4:				{ plane: 'R', 		array: bin.typedArray.BitFields(BC4BlockPixels) },
	BC5:				{ plane: 'RG', 		array: bin.typedArray.BitFields(BC5BlockPixels) },
	//BC6:				{ plane: '?', 		: bin.typedArray.BitFieldsTypedArray(BC6BlockPixels) },
	//BC7:				{ plane: '?', 		: bin.typedArray.BitFieldsTypedArray(BC7BlockPixels) },
	R16G8:				{ plane: 'RG', 		array: bin.typedArray.BitFields({ r: 16, g: 8	})},
	R4G4:				{ plane: 'RG', 		array: r4g4 },

	AYUV:				{ plane: 'YCbCrA', 	array: r8g8b8a8 },
	Y410:				{ plane: 'YCbCrA', 	array: r10g10b10a2 },
	Y416:				{ plane: 'YCbCrA', 	array: r16g16b16a16 },
	NV12:				[{ plane: 'Y', 		array: Uint8Array},		{ plane: 'CbCr', array: r8g8}],
	P010:				[{ plane: 'Y', 		array: Uint16Array },	{ plane: 'CbCr', array: r16g16}],
	P016:				[{ plane: 'Y', 		array: Uint16Array },	{ plane: 'CbCr', array: r16g16}],
	YUY2:				{ plane: 'YCbCr', 	array: bin.typedArray.BitFields({ y0: 8, u0: 8, y1: 8, v0: 8 })},
	Y210:				[{ plane: 'Y', 		array: Uint16Array },	{ plane: 'CbCr', array: r16g16, hscale: 2, vscale: 2}],
	Y216:				[{ plane: 'Y', 		array: Uint16Array },	{ plane: 'CbCr', array: r16g16, hscale: 2, vscale: 2}],
	NV11:				[{ plane: 'Y', 		array: Uint8Array },	{ plane: 'CbCr', array: r16g16, hscale: 4}],
	AI44:				{ plane: 'YA', 		array: r4g4 },
	IA44:				{ plane: 'YA', 		array: g4r4 },

	P208:				[{ plane: 'Y', 		array: Uint8Array },	{ plane: 'CbCr', array: r8g8, hscale: 2, vscale: 2}],
	V208:				[{ plane: 'Y', 		array: Uint8Array },	{ plane: 'Cb', array: Uint8Array, hscale: 2, vscale: 2}, { plane: 'Cr', array: Uint8Array, hscale: 2, vscale: 2}],
	V408:				[{ plane: 'Y', 		array: Uint8Array },	{ plane: 'Cb', array: Uint8Array, hscale: 2}, { plane: 'Cr', array: Uint8Array, hscale: 2}],

	P8:					{ plane: 'I', 		array: Uint8Array },
	A8P8:				{ plane: 'IA', 		array: r8g8 },
	B4G4R4A4:			{ plane: 'RGBA', 	array: bin.typedArray.BitFields({ b: 4, g: 4, r: 4, a: 4 })},
};

const FourCCs: Record<string, keyof typeof DXGI_FORMAT> = {
	DXT1: 'BC1_UNORM',
	DXT3: 'BC2_UNORM',
	DXT5: 'BC3_UNORM',
	ATI2: 'BC5_UNORM',
	ATI1: 'BC4_UNORM',
	DXT2: 'BC2_PREMUL', // legacy premultiplied-alpha variant of DXT3
	DXT4: 'BC3_PREMUL', // legacy premultiplied-alpha variant of DXT5
	RXGB: 'BC5_UNORM', // common normal-map variant
	'BC4 ': 'BC4_UNORM',
	'BC5 ': 'BC5_UNORM',
};

const DDSFlags = {
	CAPS:					0x00000001,
	HEIGHT:					0x00000002,
	WIDTH:					0x00000004,
	PITCH:					0x00000008,
//	NOT4VRAM0:				0x00000010, // nonstandard
//	NOT4VRAM1:				0x00000020, // nonstandard
	PIXELFORMAT:			0x00001000,
	MIPMAPCOUNT:			0x00020000,
	LINEARSIZE:				0x00080000,
	DEPTH:					0x00800000,
//	SRGB:					0x10000000, // nonstandard
//	CUTOUT_ALPHA:			0x20000000, // nonstandard
//	ARBITRARY_ALPHA:		0x40000000, // nonstandard
//	SWIZZLED:				0x80000000, // nonstandard
} as const;

const DDSCaps = {
	RESERVED1:				0x00000001,
	ALPHA:					0x00000002,
	BACKBUFFER:				0x00000004,
	COMPLEX:				0x00000008,
	FLIP:					0x00000010,
	FRONTBUFFER:			0x00000020,
	OFFSCREENPLAIN:			0x00000040,
	OVERLAY:				0x00000080,
	PALETTE:				0x00000100,
	PRIMARYSURFACE:			0x00000200,
	RESERVED3:				0x00000400,
	SYSTEMMEMORY:			0x00000800,
	TEXTURE:				0x00001000,
	_3DDEVICE:				0x00002000,
	VIDEOMEMORY:			0x00004000,
	VISIBLE:				0x00008000,
	WRITEONLY:				0x00010000,
	ZBUFFER:				0x00020000,
	OWNDC:					0x00040000,
	LIVEVIDEO:				0x00080000,
	HWCODEC:				0x00100000,
	MODEX:					0x00200000,
	MIPMAP:					0x00400000,
	RESERVED2:				0x00800000,
	ALLOCONLOAD:			0x04000000,
	VIDEOPORT:				0x08000000,
	LOCALVIDMEM:			0x10000000,
	NONLOCALVIDMEM:			0x20000000,
	STANDARDVGAMODE:		0x40000000,
	OPTIMIZED:				0x80000000,
} as const;
const DDSCaps2 = {
	RESERVED4:				0x00000002,
	HARDWAREDEINTERLACE:	0x00000001,
	HINTDYNAMIC:			0x00000004,
	HINTSTATIC:				0x00000008,
	TEXTUREMANAGE:			0x00000010,
	RESERVED1:				0x00000020,
	RESERVED2:				0x00000040,
	OPAQUE:					0x00000080,
	HINTANTIALIASING:		0x00000100,
	CUBEMAP:				0x00000200,
	CUBEMAP_POSITIVEX:		0x00000400,
	CUBEMAP_NEGATIVEX:		0x00000800,
	CUBEMAP_POSITIVEY:		0x00001000,
	CUBEMAP_NEGATIVEY:		0x00002000,
	CUBEMAP_POSITIVEZ:		0x00004000,
	CUBEMAP_NEGATIVEZ:		0x00008000,
	MIPMAPSUBLEVEL:			0x00010000,
	D3DTEXTUREMANAGE:		0x00020000,
	DONOTPERSIST:			0x00040000,
	STEREOSURFACELEFT:		0x00080000,
	VOLUME:					0x00200000,
	NOTUSERLOCKABLE:		0x00400000,
	POINTS:					0x00800000,
	RTPATCHES:				0x01000000,
	NPATCHES:				0x02000000,
	RESERVED3:				0x04000000,
	DISCARDBACKBUFFER:		0x10000000,
	ENABLEALPHACHANNEL:		0x20000000,
	EXTENDEDFORMATPRIMARY:	0x40000000,
	ADDITIONALPRIMARY:		0x80000000,
} as const;
const DDSCaps3 = {
	MULTISAMPLE:			0x0000001F,
	MULTISAMPLE_QUALITY:	0x000000E0,
	RESERVED1:				0x00000100,
	RESERVED2:				0x00000200,
	LIGHTWEIGHTMIPMAP:		0x00000400,
	AUTOGENMIPMAP:			0x00000800,
	DMAP:					0x00001000,
	CREATESHAREDRESOURCE:	0x00002000,
	READONLYRESOURCE:		0x00004000,
	OPENSHAREDRESOURCE:		0x00008000,
} as const;

const DDSPixelFormatFlags = {
	ALPHA:					0x1,
	ALPHAONLY:				0x2,
	FOURCC:					0x4,
	PALETTEINDEXED8:		0x20,
	RGB:					0x40,
	YUV:					0x200,
	LUMINANCE:				0x20000,
	BUMPDUDV:				0x80000,
} as const;

const DX10_RESOURCE_DIMENSION = {
	UNKNOWN:				0,
	TEXTURE1D:				1,
	TEXTURE2D:				2,
	TEXTURE3D:				3,
} as const;

const DX10_MISC_FLAG = {
	GENERATE_MIPS:					0x1,
	SHARED:							0x2,
	TEXTURECUBE:					0x4,
	SHARED_KEYEDMUTEX:				0x10,
	GDI_COMPATIBLE:					0x20,
	SHARED_NTHANDLE:				0x40,
	SHARED_KEYEDMUTEX_NTHANDLE:		0x80,
	RESTRICTED_CONTENT:				0x100,
	RESTRICT_SHARED_RESOURCE:		0x200,
	RESTRICT_SHARED_RESOURCE_DRIVER:0x400,
	GUARDED:						0x800,
	TILE_POOL:						0x2000,
	TILED:							0x4000,
	HW_PROTECTED:					0x8000,
};

const DX10_MISC_FLAGS2 = {
	ALPHA_MODE:	7,
		//PREMULTIPLIED:	0x1,
		//STRAIGHT:			0x2,
		//OPAQUE:			0x3,
		//CUSTOM:			0x4,
		//MASK:				0x7,
} as const;

const DDSSpec = {
	magic:	bin.Expect(bin.String(4, 'latin1'), 'DDS '),
	header:	bin.Size(s => u32.get(s) - 4, {
		flags:				bin.as(u32, bin.Flags(DDSFlags)),
		height:				u32,
		width:				u32,
		pitchOrLinearSize:	u32,
		depth:				u32,
		mipMapCount:		u32,
		reserved1:			bin.Buffer(11, Uint32Array),
		ddspf:				bin.Size(s => u32.get(s) - 4, {
			flags:			bin.as(u32, bin.Flags(DDSPixelFormatFlags)),
			fourCC:			bin.String(4, 'latin1'),
			RGBBitCount:	u32,
			RBitMask:		u32,
			GBitMask:		u32,
			BBitMask:		u32,
			ABitMask:		u32,
		}),
		caps:				bin.as(u32, bin.Flags(DDSCaps)),
		caps2:				bin.as(u32, bin.Flags(DDSCaps2)),
		caps3:				bin.as(u32, bin.Flags(DDSCaps3)),
		caps4:				u32,
		reserved2:			u32,
	}),
	dx10:	bin.Optional(s => s.obj.header.ddspf.fourCC === 'DX10', {
		dxgiFormat:			bin.as(u32, bin.EnumString(DXGI_FORMAT)),
		resourceDimension:	bin.as(u32, bin.EnumString(DX10_RESOURCE_DIMENSION)),
		miscFlag:			bin.as(u32, bin.Flags(DX10_MISC_FLAG)),
		arraySize:			u32,
		miscFlags2:			bin.as(u32, bin.Flags(DX10_MISC_FLAGS2)),
	}),
	palette: bin.Optional(s => s.obj.header.ddspf.flags.PALETTEINDEXED8, bin.Buffer(256, r8g8b8a8)),
	body: 	bin.Remainder,
};

function MaskPixels(bits: number, r: number, g: number, b: number, a: number) : bin.bitfields.BitAdapter<number, any> {
	function getMaskConsts(mask: number) {
		const shift = mask ? bin.lowestSetIndex(mask) : 0;
		return [shift, mask ? 255 / (mask >>> shift) : 1];
	}
	const [rS, rX] = getMaskConsts(r);
	const [gS, gX] = getMaskConsts(g);
	const [bS, bX] = getMaskConsts(b);
	const [aS, aX] = getMaskConsts(a);

	// one of: R, RG, RGB, RGBA, RA, RGA
	switch ((r ? 1 : 0) + (g ? 2 : 0) + (b ? 4 : 0) + (a ? 8 : 0)) {
		case 1: return {bits,
			to: (v: number) => ((v & r) >>> rS) * rX,
			from: (x: number) => ((x / rX << rS) & r)
		};
		case 3: return {bits,
			to: (v: number) => ({r: ((v & r) >>> rS) * rX, g: ((v & g) >>> gS) * gX}),
			from: (x: {r: number, g: number}) => (((x.r / rX << rS) & r) | ((x.g / gX << gS) & g))
		};
		case 7: return {bits,
			to: (v: number) => ({r: ((v & r) >>> rS) * rX, g: ((v & g) >>> gS) * gX, b: ((v & b) >>> bS) * bX}),
			from: (x: {r: number, g: number, b: number}) => (((x.r / rX << rS) & r) | ((x.g / gX << gS) & g) | ((x.b / bX << bS) & b))
		};
		case 9: return {bits,
			to: (v: number) => ({r: ((v & r) >>> rS) * rX, a: ((v & a) >>> aS) * aX}),
			from: (x: {r: number, a: number}) => (((x.r / rX << rS) & r) | ((x.a / aX << aS) & a))
		};
		case 11: return {bits,
			to: (v: number) => ({r: ((v & r) >>> rS) * rX, g: ((v & g) >>> gS) * gX, a: ((v & a) >>> aS) * aX}),
			from: (x: {r: number, g: number, a: number}) => (((x.r / rX << rS) & r) | ((x.g / gX << gS) & g) | ((x.a / aX << aS) & a))
		};
		case 15: return {bits,
			to: (v: number) => ({r: ((v & r) >>> rS) * rX, g: ((v & g) >>> gS) * gX, b: ((v & b) >>> bS) * bX, a: ((v & a) >>> aS) * aX}),
			from: (x: {r: number, g: number, b: number, a: number}) =>	(((x.r / rX << rS) & r) | ((x.g / gX << gS) & g) | ((x.b / bX << bS) & b) | ((x.a / aX << aS) & a))
		};
		default: throw new Error(`Unsupported channel mask combination: rMask=${r.toString(16)}, gMask=${g.toString(16)}, bMask=${b.toString(16)}, aMask=${a.toString(16)}`);
	}
}

function linearize(src: bin.typedArray.TypedArray<any>, bw: number, bh: number) {
	const out	= new (src[0].block.constructor as any)(src.length * 16);

	for (let by = 0, bi = 0; by < bh; by++) {
		for (let bx = 0; bx < bw; bx++, bi++) {
			const blockData = src[bi].block;
			const dst = ((by * 4 + 0) * bw + bx) * 4;
			out.set(blockData.subarray(0 * 4, 1 * 4), dst + 0 * bw * 4);
			out.set(blockData.subarray(1 * 4, 2 * 4), dst + 1 * bw * 4);
			out.set(blockData.subarray(2 * 4, 3 * 4), dst + 2 * bw * 4);
			out.set(blockData.subarray(3 * 4, 4 * 4), dst + 3 * bw * 4);
		}
	}
	return out;
}

function copyPlane<T>(src: ArrayLike<T>, width: number, height: number, srcStride: number, dstSize: number, put: (i: number, src: T) => void) {
	for (let y = 0, j = 0; y < height; y++) {
		for (let x = 0, i = y * srcStride; x < width; x++, i++, j += dstSize)
			put(j, src[i]);
	}
}

export class DDS extends Image {
	depth:		number;

	constructor(dds: bin.ReadType<typeof DDSSpec>, plane: PlaneName, public mips: bin.typedArray.TypedArray<any>[]) {
		const {width, height, caps2} = dds.header;
		const type: Type = caps2.VOLUME				? '3d'
			: caps2.CUBEMAP							? 'cube'
			: dds.dx10 && dds.dx10.arraySize > 1	? '2d-array'
			: '2d';
		const depth	= type === '2d-array'	? dds.dx10!.arraySize
					: type === 'cube'		? 6
					: dds.header.depth || 1;

		super(type, width, height, {[plane]: {width, height: height * depth}});
		this.depth		= depth;
		if (dds.palette)
			this.unpalette	= i => {
				const p = dds.palette![i];
				return [p.r, p.g, p.b/*, p.a*/];
			};
	}

	async getPixels(options: Options): Promise<Result> {
		const mip		= options.mip ?? 0;
		const width		= mipSize(this.width, mip);
		const depth		= this.type === '3d' ? mipSize(this.depth, mip) : this.depth;

		let plane0		= Object.keys(this.planes)[0] as PlaneName;
		let height		= mipSize(this.height, mip) * depth;
		let stride		= width;
		let src			= this.mips[mip];

		if (typeof options.layer == 'number') {
			const layer = options.layer ?? 0;
			if (layer >= depth)
				throw new Error(`Requested layer ${layer} exceeds image depth ${depth}`);
			const layerSize = this.width * this.height * 4;
			src = src.subarray(layer * layerSize, (layer + 1) * layerSize);
			height = this.height;
		}

		const numpixels = width * height;
		if (plane0 === 'I' && this.unpalette) {
			const pixels = new Uint8Array(numpixels * 4);
			for (let i = 0, j = 0; i < numpixels; i++, j += 4) {
				const color = this.unpalette(src[i]);
				putRgb(pixels, j, color[0], color[1], color[2]);
			}
			src		= pixels;
			plane0	= 'RGB';

		} else if ('block' in src[0]) {
			src		= linearize(src, (width + 3) >> 2, (height + 3) >> 2);
			stride	= (width + 3) & ~3;
		}

		if (options.plane === 'RGBA') {
			const pixels = new Uint8Array(width * height * 4);
			switch (plane0) {
				case 'RGBA':
				case 'RGB':
				case 'RG':
					copyPlane<PlaneType<'RGBA'>>(src, width, height, stride, 4, (i, src) => putRgba(pixels, i, src.r, src.g, src.b ?? 0, src.a ?? 255));
					break;
				case 'YCbCr':
				case 'YCbCrA':
					copyPlane<PlaneType<'RGBA'>>(src, width, height, stride, 4, (i, src) => {ycbcrToRgb(pixels, i, src.r, src.g - 128, src.b - 128); pixels[i + 3] = src.a ?? 255;});
					break;
				default:
					throw new Error('No plane available to extract RGBA pixels');
			}
			return {plane: 'RGBA', width, height, pixels};

		} else if (options.plane === 'RGB') {
			const pixels = new Uint8Array(width * height * 3);
			switch (plane0) {
				case 'RGBA':
				case 'RGB':
				case 'RG':
					copyPlane<PlaneType<'RGB'>>(src, width, height, stride, 3, (i, src) => putRgb(pixels, i, src.r, src.g, src.b ??0));
					break;
				case 'YCbCr':
					copyPlane<PlaneType<'RGB'>>(src, width, height, stride, 3, (i, src) => ycbcrToRgb(pixels, i, src.r, src.g - 128, src.b - 128));
					break;
				default:
					throw new Error('No RGB plane available to extract RGB pixels');
			}
			return {plane: 'RGB', width, height, pixels};

		} else if (options.plane === 'YCbCr') {
			const pixels = new Uint8Array(width * height * 3);
			if (plane0 === 'YCbCr') {
				copyPlane<PlaneType<'RGB'>>(src, width, height, stride, 3, (i, src) => putRgb(pixels, i, src.r, src.g, src.b));
				return {plane: 'YCbCr', width, height, pixels};
			}

		}
		throw new Error(`Unsupported plane ${options.plane}`);
	}

	static load(data: Uint8Array): DDS {
		const dds		= bin.read(new bin.stream(data), DDSSpec);
		const body		= dds.body;
		const flags		= dds.header.flags;

		const fmtflags	= dds.header.ddspf.flags;
		const fourCC	= fmtflags.FOURCC ? dds.header.ddspf.fourCC : null;
		const dxgiFormat = dds.dx10?.dxgiFormat ?? (fourCC ? FourCCs[fourCC] : null);

		let block 	= 0;
		let plane: PlaneName = 'RGBA';
		let arrayType: bin.typedArray.TypedArrayConstructor<any> | undefined;

		if (dxgiFormat) {
			const [layoutName, _type] = dxgiFormat.split('_');
			const layout = LayoutInfo[layoutName];
			if (!layout)
				throw new Error(`Unsupported DXGI format ${dxgiFormat}`);
			if (Array.isArray(layout)) {
				arrayType	= layout[0].array;
				plane		= layout[0].plane;
			} else {
				arrayType	= layout.array;
				plane		= layout.plane;
				block		= layoutName.startsWith('BC') ? 2 : 0;
			}

		} else {
			arrayType = bin.typedArray.BitFields(MaskPixels(
				dds.header.ddspf.RGBBitCount,
				dds.header.ddspf.RBitMask,
				dds.header.ddspf.GBitMask,
				dds.header.ddspf.BBitMask,
				dds.header.ddspf.ABitMask
			));
			plane = (fmtflags.RGB ? 'RGB' : fmtflags.YUV ? 'YCbCr' : fmtflags.LUMINANCE ? 'Y' : fmtflags.ALPHAONLY ? 'A' : '?') + (fmtflags.ALPHA ? 'A' : '') as PlaneName;
		}
			
		if (!arrayType)
			throw new Error(`Unsupported DDS pixel format flags ${fmtflags.toString()}`);

		const mips: bin.typedArray.TypedArray<any>[] = [];

		const bpp		= arrayType.BYTES_PER_ELEMENT!;
		const pitch		= dds.header.pitchOrLinearSize;
		const mipcount	= flags.MIPMAPCOUNT ? dds.header.mipMapCount || 1 : 1;
		const width		= dds.header.width;
		const height	= dds.header.height;
		const depth		= (dds.dx10 && dds.dx10.arraySize) || (dds.header.caps2.CUBEMAP ? 6 : dds.header.depth) || 1;

		try {
			if (dds.header.depth) {
				for (let i = 0, offset = body.byteOffset; i < mipcount; i++) {
					const w = mipSize(width, block + i);
					const h = mipSize(height, block + i);
					const d = mipSize(depth, i);

					if (i === 0 && (flags.PITCH || flags.LINEARSIZE)) {
						const length	= flags.PITCH ? h * d : d;
						const size		= flags.PITCH ? w * bpp : w * h * bpp;
						mips[0] = arrayType.from(bin.typedArray.concatenate(Array.from({ length }, (_, y) => 
							new Uint8Array(data.buffer, data.byteOffset + y * pitch, size)
						)));
						offset += length * pitch;
					} else {
						mips[i] = new arrayType(body.buffer, offset, w * h * d);
						offset += i === 0 && flags.LINEARSIZE ? dds.header.pitchOrLinearSize * d : mips[i].byteLength;
					}
				}
			} else {
				for (let s = 0/*, offset = body.byteOffset*/; s < depth; s++) {
					let offset = body.byteOffset + body.byteLength * s / depth;
					for (let i = 0; i < mipcount; i++) {
						const w = mipSize(width, block + i);
						const h = mipSize(height, block + i);

						if (i === 0 && flags.PITCH && pitch != w * bpp) {
							mips[0] = arrayType.from(bin.typedArray.concatenate(Array.from({ length: h }, (_, y) =>
								new Uint8Array(data.buffer, data.byteOffset + y * pitch, w * bpp)
							)));
							offset += h * pitch;
						} else {
							const pixels = new arrayType(body.buffer, offset, w * h);
							offset += i === 0 && pitch && flags.LINEARSIZE ? pitch : pixels.byteLength;
							if (!mips[i])
								mips[i] = pixels;
							else 
								mips[i] = bin.typedArray.concatenate([mips[i], pixels]);
						}
					}
				}
			}
		} catch(e) {
			console.log(e);
		}
		return new DDS(dds, plane, mips);
	}
};
