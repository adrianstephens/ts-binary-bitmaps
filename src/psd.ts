import * as bin from '@isopodlabs/binary';
import {Image, Options, Result, PlaneName, getPixels, concatenateBuffers} from './common';

const u8 = bin.UINT8;
const u16 = bin.UINT16_BE;
const u32 = bin.UINT32_BE;
const i32 = bin.INT32_BE;
const i16 = bin.INT16_BE;

const PSDColorMode = {
	Bitmap: 		0,
	Grayscale: 		1,
	Indexed: 		2,
	RGB: 			3,
	CMYK: 			4,
	Multichannel: 	7,
	Duotone: 		8,
	Lab: 			9,
} as const;

const PSDPlanes: Record<keyof typeof PSDColorMode, PlaneName[]> = {
	Bitmap: 		['Y'],
	Grayscale: 		['Y'],
	Indexed: 		['I'],
	RGB: 			['R', 'G', 'B'],
	CMYK: 			['Cy', 'Ma', 'Ye', 'K'],
	Multichannel: 	['Y'],
	Duotone: 		['Y'],
	Lab: 			['L', 'La', 'Lb'],
};

const PSDCompression = {
	Raw: 			0,
	RLE: 			1,
	Zip: 			2,
	ZipPrediction: 	3,
} as const;

const _PSDChannelIds = {
	//R:					0,
	//G:					1,
	//B:					2,
	//A:					3,
	layerTransparencyMask:	-1,
	userMask:				-2,
	realUserMask:			-3,
	vectorMask:				-4,
	clippingPath:			-5,
} as const;

const RESOURCE = {
	PHOTOSHOP2INFO:		0x03E8,	// 1000 (Obsolete--Photoshop 2.0 only) Contains five 2-byte values: number of channels, rows, columns, depth, and mode
	MAC_PRINTINFO:		0x03E9,	// 1001 Macintosh print manager print info record
	INDEXEDCOLORS:		0x03EB,	// 1003 (Obsolete--Photoshop 2.0 only) Indexed color table
	RESOLUTIONINFO:		0x03ED,	// 1005 ResolutionInfo structure. See Appendix A in Photoshop SDK Guide.pdf
	ALPHANAMES:			0x03EE,	// 1006 Names of the alpha channels as a series of Pascal strings.
	DISPLAYINFO:		0x03EF,	// 1007 DisplayInfo structure. See Appendix A in Photoshop SDK Guide.pdf
	CAPTION:			0x03F0,	// 1008 Optional. The caption as a Pascal string.
	BORDER:				0x03F1,	// 1009 Border information. Contains a fixed-number for the border width, and 2 bytes for border units (1=inches, 2=cm, 3=points, 4=picas, 5=columns).
	BACKGROUNDCOLOUR:	0x03F2,	// 1010 Background color. See the Colors additional file information.
	PRINTFLAGS:			0x03F3,	// 1011 Print flags. A series of one byte boolean values (see Page Setup dialog): labels, crop marks, color bars, registration marks, negative, flip, interpolate, caption.
	GRAYSCALEINGO:		0x03F4,	// 1012 Grayscale and multichannel halftoning information.
	HALFTONEINFO:		0x03F5,	// 1013 Color halftoning information.
	DUOHALFTONEINGO:	0x03F6,	// 1014 Duotone halftoning information.
	GRAYSCALETRANSFER:	0x03F7,	// 1015 Grayscale and multichannel transfer function.
	COLOURTRANSFER:		0x03F8,	// 1016 Color transfer functions.
	DUOTONETRANSFER:	0x03F9,	// 1017 Duotone transfer functions.
	DUOTONEIMAGEINFO:	0x03FA,	// 1018 Duotone image information.
	EFFECTIVEBW:		0x03FB,	// 1019 Two bytes for the effective black and white values for the dot range.
	EPSOPTS:			0x03FD,	// 1021 EPS options.
	QUICKMASK:			0x03FE,	// 1022 Quick Mask information. 2 bytes containing Quick Mask channel ID, 1 byte boolean indicating whether the mask was initially empty.
	LAYERSTATE:			0x0400,	// 1024 Layer state information. 2 bytes containing the index of target layer. 0=bottom layer.
	WORKINGPATH:		0x0401,	// 1025 Working path (not saved). See path resource format later in this chapter.
	LAYERSGROUP:		0x0402,	// 1026 Layers group information. 2 bytes per layer containing a group ID for the dragging groups. Layers in a group have the same group ID.
	IPTC_NAA:			0x0404,	// 1028 IPTC-NAA record. This contains the File Info... information. See the IIMV4.pdf document.
	RAWIMAGEMODE:		0x0405,	// 1029 Image mode for raw format files.
	JPEGQUALITY:		0x0406,	// 1030 JPEG quality. Private.
	GRIDGUIDES:			0x0408,	// 1032 Grid and guides information. See grid and guides resource format later in this chapter.
	THUMBNAIL:			0x0409,	// 1033 Thumbnail resource. See thumbnail resource format later in this chapter.
	COPYRIGHT:			0x040A,	// 1034 Copyright flag. Boolean indicating whether image is copyrighted. Can be set via Property suite or by user in File Info...
	URL:				0x040B,	// 1035 URL. Handle of a text string with uniform resource locator. Can be set via Property suite or by user in File Info...
	THUMBNAIL2:			0x040C,	// 1036 Thumbnail resource. See thumbnail resource format later in this chapter.
	GLOBALANGLE:		0x040D,	// 1037 Global Angle. 4 bytes that contain an integer between 0..359 which is the global lighting angle for effects layer. If not present assumes 30.
	COLOURSAMPLERS:		0x040E,	// 1038 Color samplers resource. See color samplers resource format later in this chapter.
	ICCPROFILE:			0x040F,	// 1039 ICC Profile. The raw bytes of an ICC format profile, see the ICC34.pdf and ICC34.h files from the Internation Color Consortium located in the documentation section
	WATERMARK:			0x0410,	// 1040 One byte for Watermark.
	ICC_UNTAGGED:		0x0411,	// 1041 ICC Untagged. 1 byte that disables any assumed profile handling when opening the file. 1 = intentionally untagged.
	EFFECTSVISIBLE:		0x0412,	// 1042 Effects visible. 1 byte global flag to show/hide all the effects layer. Only present when they are hidden.
	SPOTHALFTONE:		0x0413,	// 1043 Spot Halftone. 4 bytes for version, 4 bytes for length, and the variable length data.
	CUSTOMIDS:			0x0414,	// 1044 Document specific IDs, layer IDs will be generated starting at this base value or a greater value if we find existing IDs to already exceed it.
	UNICODEALPHANAMES:	0x0415,	// 1045 Unicode Alpha Names. 4 bytes for length and the string as a unicode string.
	COLOURCOUNT:		0x0416,	// 1046 Indexed Color Table Count. 2 bytes for the number of colors in table that are actually defined
	TRANSPARENTINDEX:	0x0417,	// 1047 Tansparent Index. 2 bytes for the index of transparent color, if any.
	GLOBALALT:			0x0419,	// 1049 Global Altitude. 4 byte entry for altitude
	SLICES:				0x041A,	// 1050 Slices. See description later in this chapter
	WORKFLOWURL:		0x041B,	// 1051 Workflow URL. Unicode string, 4 bytes of length followed by unicode string.
	JUMPTOXPEP:			0x041C,	// 1052 Jump To XPEP. 2 bytes major version, 2 bytes minor version, 4 bytes count. Following is repeated for count: 4 bytes block size, 4 bytes key, if key = 'jtDd' then next is a Boolean for the dirty flag otherwise it�s a 4 byte entry for the mod date.
	ALPHAIDENT:			0x041D,	// 1053 Alpha Identifiers. 4 bytes of length, followed by 4 bytes each for every alpha identifier.
	URLLIST:			0x041E,	// 1054 URL List. 4 byte count of URLs, followed by 4 byte long, 4 byte ID, and unicode string for each count.
	VERSIONINFO:		0x0421,	// 1057 Version Info. 4 byte version, 1 byte HasRealMergedData, unicode string of writer name, unicode string of reader name, 4 bytes of file version.
	EXIF1:				0x0422,	// 1058 EXIF data 1. See http://www.kodak.com/global/plugins/acrobat/en/service/digCam/exifStandard2.pdf
	EXIF3:				0x0423,	// 1059 EXIF data 3. See http://www.kodak.com/global/plugins/acrobat/en/service/digCam/exifStandard2.pdf
	XMPMETADATA:		0x0424,	// 1060 XMP Metadata. File info as XML description. Use XMPToolkitMT.lib from Adobe XMP SDK to parse this resource. See http://Partners.adobe.com/asn/developer/xmp/main.html
	CAPTIONDIGEST:		0x0425,	// 1061 Caption digest. 16 bytes: RSA Data Security, MD5 message-digest algorithm
	PRINTSCALE:			0x0426,	// 1062 Print scale. 2 bytes style (0 = centered, 1 = size to fit, 2 = user defined). 4 bytes x location (floating point). 4 bytes y location (floating point). 4 bytes scale (floating point)
	PIXELASPECT:		0x0428,	// 1064 Pixel Aspect Ratio. 4 bytes (version = 1 or 2), 8 bytes double, x / y of a pixel. Version 2, attempting to correct values for NTSC and PAL, previously off by a factor of approx. 5%.
	LAYERCOMPS:			0x0429,	// 1065 Layer Comps. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure)
	ALTDUOTONE:			0x042A,	// 1066 Alternate Duotone Colors. 2 bytes (version = 1), 2 bytes count, following is repeated for each count: [ Color: 2 bytes for space followed by 4 * 2 byte color component ], following this is another 2 byte count, usually 256, followed by Lab colors one byte each for L, a, b. This resource is not read or used by Photoshop.
	ALTSPOT:			0x042B,	// 1067 Alternate Spot Colors. 2 bytes (version = 1), 2 bytes channel count, following is repeated for each count: 4 bytes channel ID, Color: 2 bytes for space followed by 4 * 2 byte color component. This resource is not read or used by Photoshop.
	LAYERSEL:			0x042D,	// 1069 Layer Selection ID(s). 2 bytes count, following is repeated for each count: 4 bytes layer ID
	HDRTONING:			0x042E,	// 1070 HDR Toning information
	PRINTINFO:			0x042F,	// 1071 Print info
	LAYERGROUPS:		0x0430,	// 1072 Layer Group(s) Enabled ID. 1 byte for each layer in the document, repeated by length of the resource. NOTE: Layer groups have start and end markers
	COLORSAMPLERS:		0x0431,	// 1073 Color samplers resource. Also see ID 1038 for old format. See See Color samplers resource format.
	MEASUREMENTSCALE:	0x0432,	// 1074 Measurement Scale. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure)
	TIMELINE:			0x0433,	// 1075 Timeline Information. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure)
	SHEETDISCLOSURE:	0x0434,	// 1076 Sheet Disclosure. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure)
	DISPLAYINFO2:		0x0435,	// 1077 DisplayInfo structure to support floating point clors. Also see ID 1007. See Appendix A in Photoshop API Guide.pdf .
	ONIONSKINS:			0x0436,	// 1078 Onion Skins. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure)
	COUNTINFO:			0x0438,	// 1080 Count Information. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure) Information about the count in the document. See the Count Tool.
	PRINTINFO2:			0x043A,	// 1082 Print Information. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure) Information about the current print settings in the document. The color management options.
	PRINTSTYLE:			0x043B,	// 1083 Print Style. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure) Information about the current print style in the document. The printing marks, labels, ornaments, etc.
	MAC_NSPRINTINFO:	0x043C,	// 1084 Macintosh NSPrintInfo. Variable OS specific info for Macintosh. NSPrintInfo. It is recommened that you do not interpret or use this data.
	WIN_DEVMODE:		0x043D,	// 1085 Windows DEVMODE. Variable OS specific info for Windows. DEVMODE. It is recommened that you do not interpret or use this data.
	AUTOSAVEPATH:		0x043E,	// 1086 Auto Save File Path. Unicode string. It is recommened that you do not interpret or use this data.
	AUTOSAVEFORMAT:		0x043F,	// 1087 Auto Save Format. Unicode string. It is recommened that you do not interpret or use this data.
	PATHSELECTION:		0x0440,	// 1088 Path Selection State. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure) Information about the current path selection state.
	PATHINFO:			0x07D0,	// 2000-2997 Path Information (saved paths). See See Path resource format.
	CLIPPINGPATH:		0x0BB7,	// 2999 Name of clipping path. See path resource format later in this chapter.
	ORIGINPATHINFO:		0x0BB8,	// 3000 Origin Path Info. 4 bytes (descriptor version = 16), Descriptor (see See Descriptor structure) Information about the origin path data.
	PLUGINRESOURCES:	0x0FA0,	// 4000-4999 Plug-In resource(s). Resources added by a plug-in. See the plug-in API found in the SDK documentation
	IMAGEREADYVARS:		0x1B58,	// 7000 Image Ready variables. XML representation of variables definition
	IMAGEREADYDATA:		0x1B59,	// 7001 Image Ready data sets
	LIGHTROOMWORKFLOW:	0x1F40,	// 8000 Lightroom workflow, if present the document is in the middle of a Lightroom workflow.
	PRINTFLAGSINFO:		0x2710,	// 10000 Print flags information. 2 bytes version (=1), 1 byte center crop marks, 1 byte (=0), 4 bytes bleed width value, 2 bytes bleed width scale.
} as const;

const PSDStringResource	= {value: bin.RemainingString('latin1')};

const PSDImageResource = {
	signature: bin.Expect(bin.Aligned(2, bin.String(4)), '8BIM'),
	id:		bin.as(u16, bin.EnumV(RESOURCE)),
	name:	bin.String(u8, 'latin1'),
	_:	bin.Size(bin.Aligned(2, u32), bin.Switch('id', {
		[RESOURCE.RESOLUTIONINFO]: {
			hRes:		u32,
			hResUnit:	u16,
			widthUnit:	u16,
			vRes:		u32,
			vResUnit:	u16,
			heightUnit:	u16,
		},

		[RESOURCE.CAPTION]:				PSDStringResource,
		[RESOURCE.BACKGROUNDCOLOUR]:	PSDStringResource,
		[RESOURCE.PRINTFLAGS]:			PSDStringResource,
		[RESOURCE.GRAYSCALEINGO]:		PSDStringResource,
		[RESOURCE.HALFTONEINFO]:		PSDStringResource,
		[RESOURCE.DUOHALFTONEINGO]:		PSDStringResource,
		[RESOURCE.GRAYSCALETRANSFER]:	PSDStringResource,
		[RESOURCE.COLOURTRANSFER]:		PSDStringResource,
		[RESOURCE.DUOTONETRANSFER]:		PSDStringResource,
		default: {data: bin.Remainder},
	})),
};

function readCompressed(spec: bin.Type) {
	return {
		to: (data: Uint8Array) => bin.decompress('deflate')(data).then(decompressed =>
			bin.read(new bin.stream(decompressed), spec)
		),
		from: (value: bin.ReadType<typeof spec>) => {
			const buffer = new bin.growingStream();
			bin.write(buffer, spec, value);
			return bin.compress('deflate')(buffer.terminate());
		}
	};
}

const rle = {
	to: (data: Int8Array, s: bin.interop._stream) => {
		const expectedLength = s.obj.obj.obj.width;// * s.obj.obj.obj.height;
		const out = new Uint8Array(expectedLength);
		let d = 0;

		for (let i = 0; i < data.length && d < expectedLength;) {
			const n = (data[i++] << 24) >> 24; // signed byte
			if (n >= 0) {
				const count = n + 1;
				out.set(data.subarray(i, i + count), d);
				i += count;
				d += count;
			} else if (n !== -128) {
				const count = 1 - n;
				out.fill(data[i++], d, d + count);
				d += count;
			}
		}

		if (d !== expectedLength)
			throw new Error(`PackBits decoded length mismatch: expected ${expectedLength}, got ${d}`);

		return out;
	},
	from: (value: Uint8Array) => value as any as Int8Array
};

const prediction = {
	to: (data: bin.utils.TypedArray<number>, s: bin.interop._stream) => {
		const width = s.obj.width;
		const height = data.length / width;
		const stride = width * data.constructor.prototype.BYTES_PER_ELEMENT;
		const out = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	
		for (let row = 0; row < height; row++) {
			const rowStart = row * stride;
			let prev = 0;
			for (let x = 0; x < stride; x++) {
				const value = (out[rowStart + x] + prev) & 0xFF;
				out[rowStart + x] = value;
				prev = value;
			}
		}
		return data;
	},
	from: (value: bin.utils.TypedArray<number>) => value
};

const PSDPixels = bin.Switch(bin.as(u16, bin.EnumString(PSDCompression)), {
	Raw: {
		channelData: bin.FuncType(s => bin.Buffer(s => s.obj.obj.width * s.obj.obj.height,  bin.utils.UintTypedArray(s.obj.obj.depth)))
	},
	RLE: {
		scanlineLengths: bin.Buffer(s => s.obj.obj.height, bin.utils.Uint16beArray),
		channelData: bin.as(bin.Array(s => s.obj.obj.height,
			bin.as(bin.Buffer(s=>
				s.obj.obj.scanlineLengths[s.obj.length], Int8Array), rle)
		), concatenateBuffers)
	},
	Zip: {
		channelData: bin.as(bin.Remainder, readCompressed(
			bin.FuncType(s => bin.Buffer(s => s.obj.obj.width * s.obj.obj.height,  bin.utils.UintTypedArray(s.obj.obj.depth)))
		))
	},
	ZipPrediction: {
		channelData: bin.as(bin.Remainder, readCompressed(
			bin.as(bin.FuncType(s => bin.Buffer(s => s.obj.obj.width * s.obj.obj.height,  bin.utils.UintTypedArray(s.obj.obj.depth))), prediction)
		))
	},
});

const PSDLayerRecord = {
	top:			i32,
	left:			i32,
	bottom:			i32,
	right:			i32,
	channelInfo:	bin.Array(u16, {
		id:		i16,
		length:	u32,
	}),
	blendSig:		bin.String(4),
	blendMode:		bin.String(4),
	opacity:		u8,
	clipping:		u8,
	flags:			u8,
	filler:			u8,
	extraData:		bin.Size(u32, {
		layerMaskData:			bin.Buffer(u32, Uint8Array),
		layerBlendingRanges:	bin.Buffer(u32, Uint8Array),
		name: 					bin.String(u8, 'latin1', true),
		additionalLayerInfo:	bin.Aligned(4, bin.Remainder),
	}),
};

const PSDSpec = {
	sig: 					bin.Expect(bin.String(4), '8BPS'),
	version: 				bin.as(u16, v => {
		if (v !== 1 && v !== 2)
			throw new Error(`Unsupported PSD version: ${v}`);
		return v;
	}),
	reserved: 				bin.Buffer(6, Uint8Array),
	channels: 				u16,
	height: 				u32,
	width: 					u32,
	depth: 					u16,
	colorMode: 				bin.as(u16, bin.EnumString(PSDColorMode)),
	colorModeData: 			bin.Size(u32, {r: bin.Buffer(256), g: bin.Buffer(256), b: bin.Buffer(256)}, true),
	imageResources: 		bin.Size(u32, bin.RemainingArray(PSDImageResource)),
	
	layerAndMaskInfo: 		bin.Size(u32, {
		layerInfo:			bin.Size(u32, {
			layers:		bin.Array(bin.as(i16, v => Math.abs(v)), PSDLayerRecord),
			imageData:	bin.Remainder,
		}, true),
		globalLayerMaskInfo:	bin.Size(u32, {
			overlayColorSpace:	u16,
			colorComponents:	bin.Array(4, u16),
			opacity:			u8,
			kind:				u8,
		}, true),
	}),
	body: bin.Remainder
};

export type PSDSpec = bin.ReadType<typeof PSDSpec>;

const PSDMaskNames = [
	'transparencyMask',	//-1,
	'userMask',			//-2,
	'realUserMask',		//-3,
	'vectorMask',		//-4,
	'clippingPath',		//-5,
] as const;

class LayerImage extends Image {
	constructor(layer: bin.ReadType<typeof PSDLayerRecord>, imageData: Uint8Array, psd: PSD) {
		const width		= layer.right - layer.left;
		const height	= layer.bottom - layer.top;
		const depth		= psd.psd.depth;
		super('2d', width, height);

		const planeNames = Object.keys(psd.planes) as PlaneName[];
		let offset = 0;
		for (const channel of layer.channelInfo) {
			const pixels	= new bin.stream(imageData.subarray(offset, offset + channel.length)).read(PSDPixels, {width, height, depth});
			this.planes[channel.id < 0 ? PSDMaskNames[channel.id + 1] as PlaneName : planeNames[channel.id]] = {
				width, height,
				getPixels: async _options => pixels.channelData
			};
			offset += channel.length;
		}
	}
	async getPixels(options: Options): Promise<Result> {
		return getPixels(this, options);
	}
};

export class PSD extends Image {

	constructor(public psd: PSDSpec) {
		const width = psd.width, height = psd.height;
		super('2d', width, height);

		const pixels	= new bin.stream(psd.body).read(PSDPixels, {width, height: height * psd.channels, depth: psd.depth});
		const planeNames = PSDPlanes[psd.colorMode];

		for (let i = 0; i < psd.channels; i++)
			this.planes[i < planeNames.length ? planeNames[i] : 'A'] = {width, height, getPixels: async _options => pixels.channelData.subarray(width * height * i, width * height * (i + 1))};

		if (this.psd.colorModeData)
			this.unpalette = i => [this.psd.colorModeData!.r[i], this.psd.colorModeData!.g[i], this.psd.colorModeData!.b[i]];
	}

	getLayer(layer: number|string) {
		const layerInfo = this.psd.layerAndMaskInfo?.layerInfo;
		if (!layerInfo)
			return undefined;

		const layers = layerInfo.layers;
		let offset = 0;

		if (typeof layer === 'string') {
			for (const i of layers) {
				for (const channel of i.channelInfo)
					offset += channel.length;
				if (i.extraData.name === layer)
					return new LayerImage(i, layerInfo.imageData.subarray(offset), this);
			}
		} else if (layer >= 0 && layer < layers.length) {
			for (let i = 0; i < layer; i++) {
				for (const channel of layers[i].channelInfo)
					offset += channel.length;
			}

			return new LayerImage(layers[layer], layerInfo.imageData.subarray(offset), this);
		}
		return undefined;
	}

	async getPixels(options: Options): Promise<Result> {
		let image = this as Image;
		if (options.layer !== undefined) {
			const layer = this.getLayer(options.layer);
			if (!layer)
				throw new Error(`Layer ${options.layer} not found`);
			image = layer;
		}
		return getPixels(image, options, this.unpalette);
	}

	static async load(data: Uint8Array): Promise<PSD> {
		return new PSD(bin.read(new bin.stream(data), PSDSpec));
	}
}
