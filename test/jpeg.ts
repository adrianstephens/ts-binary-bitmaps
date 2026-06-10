import * as bin from '@isopodlabs/binary';
import {BaseImage, Plane, PlaneName, Options, Result, clamp8, getPixels, greyToRgb, ycbcrToRgb} from './common';

const u8 = bin.UINT8;
const u16be = bin.UINT16_BE;

//-----------------------------------------------------------------------------
// JPEG
//-----------------------------------------------------------------------------

const JPEGMarker = {
	SOI:	0xD8,
	EOI:	0xD9,
	APP0:	0xE0,
	APP1:	0xE1,
	COM:	0xFE,
	DQT:	0xDB,
	DHT:	0xC4,
	SOF0:	0xC0,
	SOF2:	0xC2,
	SOS:	0xDA,
	DRI:	0xDD,
	RST0:	0xD0,
	RST1:	0xD1,
	RST2:	0xD2,
	RST3:	0xD3,
	RST4:	0xD4,
	RST5:	0xD5,
	RST6:	0xD6,
	RST7:	0xD7,
} as const;

const DQTTable = {
	packed:	bin.Merge(bin.BitFields({id: 4, size: 4} as const)),
	values:	bin.Optional(s => s.obj.size,
		bin.Buffer(64, bin.typedArray.Uint16be),
		bin.Buffer(64, Uint8Array)
	),
};

class HuffTable extends bin.Class({
	packed:	bin.Merge(bin.BitFields({id: 4, cls: 4} as const)),
	counts:	bin.Buffer(16),
	values:	bin.Buffer(s => s.obj.counts.reduce((a: number, b: number) => a + b, 0)),
}) {
	table: number[][] = [];

	constructor(s: bin.stream) {
		super(s);

		for (let len = 0, code = 0, k = 0; len < 16; len++) {
			const table = [];
			for (let i = 0; i < this.counts[len]; i++)
				table[code++] = this.values[k++];
			this.table[len] = table;
			code <<= 1;
		}
	}

	read(readBits: (n: number) => number) {
		let code = 0;
		for (let len = 0; len < 16; len++) {
			code = (code << 1) | readBits(1);
			const v = this.table[len][code];
			if (v !== undefined)
				return v;
		}
		throw new Error('Invalid JPEG Huffman code');
	};

}

//-----------------------------------------------------------------------------
// frame
//-----------------------------------------------------------------------------

class FrameComponent extends bin.Class({
	id: 		u8,
	sampling:	bin.Merge(bin.BitFields({v: 4, h: 4} as const)),
	qtableId:	u8,
}) {
	n:		number;
	blocks = new Uint8Array();

	constructor(s: bin.stream) {
		super(s);
		this.n	= this.h * this.v;
	}

	sampler(mi: number, maxH: number, maxV: number) {
		const blocks = this.blocks.subarray(mi * this.n << 6);
		const h = this.h;
		const v = this.v;

		return (y: number) => {
			const sy = ((y * v) / maxV) | 0;
			const by = sy >> 3;
			const py = sy & 7;
			const blocksx = blocks.subarray(((by * h) << 6) + (py << 3));
			return (x: number) => {
				const sx = ((x * h) / maxH) | 0;
				const bx = sx >> 3;
				const px = sx & 7;
				return blocksx[(bx << 6) + px];
			};
		};
	}
}

class SOF extends bin.Class(JPGblock({
	precision:	u8,
	height:		u16be,
	width:		u16be,
	components: bin.Array(u8, FrameComponent)
})) {
	get maxH()	{ return this.components.reduce((a, c) => Math.max(a, c.v), 1); }
	get maxV()	{ return this.components.reduce((a, c) => Math.max(a, c.h), 1); }
	get mcus()	{ return Math.ceil(this.width / (this.maxH * 8)) * Math.ceil(this.height / (this.maxV * 8)); }

	constructor(s: bin.stream) {
		super(s);
		const mcus = this.mcus;
		for (const c of this.components)
			c.blocks	= new Uint8Array(mcus * c.n * 64);
	}

};

//-----------------------------------------------------------------------------
// decoding
//-----------------------------------------------------------------------------

const zigzag = new Uint8Array([
	0, 1, 8, 16, 9, 2, 3, 10,
	17, 24, 32, 25, 18, 11, 4, 5,
	12, 19, 26, 33, 40, 48, 41, 34,
	27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36,
	29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46,
	53, 60, 61, 54, 47, 55, 62, 63,
]);

const cosTable = (() => {
	const t = new Float64Array(64);
	for (let u = 0; u < 8; u++)
		for (let x = 0; x < 8; x++)
			t[(u << 3) + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
	return t;
})();

function idctBlock(coeff: Int32Array, out: Uint8Array) {
	const tmp = new Float64Array(64);
	for (let y = 0; y < 8; y++) {
		for (let x = 0; x < 8; x++) {
			let sum = 0;
			for (let u = 0; u < 8; u++) {
				const cu = u === 0 ? 0.7071067811865476 : 1;
				sum += cu * coeff[(y << 3) + u] * cosTable[(u << 3) + x];
			}
			tmp[(y << 3) + x] = sum * 0.5;
		}
	}

	for (let x = 0; x < 8; x++) {
		for (let y = 0; y < 8; y++) {
			let sum = 0;
			for (let v = 0; v < 8; v++) {
				const cv = v === 0 ? 0.7071067811865476 : 1;
				sum += cv * tmp[(v << 3) + x] * cosTable[(v << 3) + y];
			}
			out[(y << 3) + x] = clamp8((sum * 0.5 + 128 + 0.5) | 0);
		}
	}
}

interface DecodeComponent {
	n: number;
	q: ArrayLike<number>;
	dc: HuffTable;
	ac: HuffTable;
	pred: number;
	blocks: Uint8Array;
}

function decodeScan(components: DecodeComponent[], scan: Uint8Array, mcus: number, restartInterval: number) {
	let p			= 0;
	let bitBuf		= 0;
	let bitLen		= 0;

	const readByte = () => {
		while (p < scan.length) {
			const b = scan[p++];
			if (b !== 0xFF)
				return b;

			if (p >= scan.length)
				return -1;

			const m = scan[p++];
			if (m === 0x00)
				return 0xFF;

			throw new Error(`Unexpected JPEG marker in entropy data 0x${m.toString(16)}`);
		}
		return -1;
	};

	const readBits = (n: number) => {
		while (bitLen < n) {
			const b = readByte();
			if (b < 0)
				throw new Error('Unexpected end of JPEG scan data');
			bitBuf = (bitBuf << 8) | b;
			bitLen += 8;
		}
		bitLen -= n;
		return (bitBuf >> bitLen) & ((1 << n) - 1);
	};

	function receiveExtend(v: number, n: number) {
		if (!n)
			return 0;
		const m = 1 << (n - 1);
		return v < m ? v - ((1 << n) - 1) : v;
	}

	const block = new Int32Array(64);
	for (let mi = 0; mi < mcus; mi++) {
		for (const c of components) {
			for (let i = 0; i < c.n; i++) {
				block.fill(0);
				const dcLen = c.dc.read(readBits);
				const dcDiff = receiveExtend(readBits(dcLen), dcLen);
				c.pred += dcDiff;
				block[0] = c.pred * c.q[0];

				for (let k = 1, rs; k < 64 && (rs = c.ac.read(readBits));) {
					if (rs === 0xF0) {
						k += 16;
					} else {
						k += rs >> 4;
						if (k < 64) {
							const acLen = rs & 0x0F;
							const ac = receiveExtend(readBits(acLen), acLen);
							block[zigzag[k]] = ac * c.q[k];
							k++;
						}
					}
				}

				idctBlock(block, c.blocks.subarray((mi * c.n + i) << 6));
			}
		}

		if (restartInterval && (mi + 1) < mcus && (mi + 1) % restartInterval === 0) {
			bitBuf = 0;
			bitLen = 0;
			for (const c of components)
				c.pred = 0;

			const p0 = p;
			while (p < scan.length && scan[p] === 0xFF)
				p++;
			if (p0 === p || p >= scan.length)
				throw new Error('Missing JPEG restart marker');

			const marker	= scan[p++];
			const expected	= JPEGMarker.RST0 + ((mi / restartInterval) & 7);
			if (marker !== expected)
				throw new Error(`Expected JPEG restart marker 0x${expected.toString(16)}, got 0x${marker.toString(16)}`);
		}
	}
}

class SOS extends bin.Class(JPGblock({
	components: bin.Array(u8, {
		id:		u8,
		tables: bin.Merge(bin.BitFields({ac: 4, dc: 4} as const)),
	}),
	specStart:	u8,
	specEnd:	u8,
	approx:		u8,
})) {
	constructor(s: bin.stream) {
		super(s);

		let restartInterval = 0;
		let sof;
		const dqtMap	= new Map<number, ArrayLike<number>>();
		const dcMap		= new Map<number, HuffTable>();
		const acMap		= new Map<number, HuffTable>();

		const segments	= s.obj.obj as bin.ReadType<typeof JPEGSegment>[];
		for (const seg of segments) {
			switch (seg.marker) {
				case JPEGMarker.SOF0:
				case JPEGMarker.SOF2:
					sof = seg;
					break;

				case JPEGMarker.DQT:
					for (const t of seg.array)
						dqtMap.set(t.id, t.values);
					break;

				case JPEGMarker.DHT:
					for (const t of seg.array) {
						if (t.cls)
							acMap.set(t.id, t);
						else
							dcMap.set(t.id, t);
					}
					break;

				case JPEGMarker.DRI:
					restartInterval = seg.dri;
					break;
			}
		}
		if (!sof)
			throw new Error('JPEG missing SOF');

		const scanTables = new Map<number, {dc: number, ac: number}>();
		for (const c of this.components)
			scanTables.set(c.id, c);

		const components = sof.components.map(c => {
			const sc = scanTables.get(c.id);
			if (!sc)
				throw new Error(`JPEG missing SOS component ${c.id}`);

			const q		= dqtMap.get(c.qtableId);
			const dc	= dcMap.get(sc.dc);
			const ac	= acMap.get(sc.ac);
			if (!q || !dc || !ac)
				throw new Error('JPEG missing DQT/DHT table');

			return {n: c.n, q, dc, ac, pred: 0, blocks: c.blocks};
		});

		decodeScan(components, s.remainder(), sof.mcus, restartInterval);
	}
};

//-----------------------------------------------------------------------------
// parsing
//-----------------------------------------------------------------------------

function JPGblock<T extends bin.Type>(type: T) {
	return bin.Size(s => u16be.get(s) - 2, type);
}

const JPEGSegment = {
	ff:		bin.Expect(u8, 0xFF),
	marker: bin.as(u8, bin.EnumV(JPEGMarker)),
	_:	bin.Switch('marker', {
		[JPEGMarker.SOI]:	{},
		[JPEGMarker.EOI]:	{},
		[JPEGMarker.RST0]:	{}, [JPEGMarker.RST1]: {}, [JPEGMarker.RST2]: {}, [JPEGMarker.RST3]: {}, [JPEGMarker.RST4]: {}, [JPEGMarker.RST5]: {}, [JPEGMarker.RST6]: {}, [JPEGMarker.RST7]: {},
		[JPEGMarker.DRI]:	JPGblock({dri: u16be}),
		[JPEGMarker.APP0]:	JPGblock(bin.Remainder),
		[JPEGMarker.APP1]:	JPGblock(bin.Remainder),
		[JPEGMarker.COM]:	JPGblock(bin.RemainingString()),
		[JPEGMarker.DQT]:	JPGblock({array: bin.RemainingArray(DQTTable)}),
		[JPEGMarker.DHT]:	JPGblock({array: bin.RemainingArray(HuffTable)}),
		[JPEGMarker.SOF0]:	SOF,
		[JPEGMarker.SOF2]:	SOF,
		[JPEGMarker.SOS]:	SOS,
		default:			JPGblock(bin.Remainder),
	}),
};

export type JPEGSegment = bin.ReadType<typeof JPEGSegment>;

export class JPEG extends BaseImage {

	constructor(public sof: bin.ReadType<typeof SOF>) {
		super('2d', sof.width, sof.height, {});

		for (const c of sof.components) {
			const name = c.id === 1 ? 'Y' : (c.id === 2 ? 'Cb' : (c.id === 3 ? 'Cr' : `?${c.id}`)) as PlaneName;
			this.planes[name] = {
				width:	Math.ceil(sof.width * c.h / sof.maxH),
				height:	Math.ceil(sof.height * c.v / sof.maxV),
				getPixels: async (x, y, w, h) => {
					const pixels	= new Uint8Array(w * h);
					const mx0 		= Math.floor(x / (c.h * 8)), mx1 = Math.ceil((x + w) / (c.h * 8));
					const my0		= Math.floor(y / (c.v * 8)), my1 = Math.ceil((y + h) / (c.v * 8));
					const mstride	= Math.ceil(sof.width / (sof.maxH * 8)) * c.h;

					for (let my = my0; my < my1; my++) {
						const y0	= Math.max(y, my * c.v * 8), y1 = Math.min(y + h, (my + 1) * c.v * 8);
						for (let mx = mx0; mx < mx1; mx++ ) {
							const x0	= Math.max(x, mx * c.h * 8), x1 = Math.min(x + w, (mx + 1) * c.h * 8);
							const blocks = c.blocks.subarray(((my * mstride + mx) * c.n) << 6);

							for (let yi = y0; yi < y1; yi++) {
								const sy = yi - y0;
								const by = sy >> 3;
								const py = sy & 7;
								const blocksx = blocks.subarray(((by * c.h) << 6) + (py << 3));

								const row	= (yi - y) * w - x;
								for (let xi = x0; xi < x1; xi++) {
									const sx = xi - x0;
									const bx = sx >> 3;
									const px = sx & 7;
									pixels[row + xi] = blocksx[(bx << 6) + px];
								}
							}
						}
					}
					return pixels;
				}
			};
		}
	}
	async getPixels(options: Options): Promise<Result> {
		return getPixels(this, options);
	}

/*
	async getPixels(options: Options): Promise<Result> {
		const maxH		= this.sof.maxH;
		const maxV		= this.sof.maxV;
		const mcusX		= Math.ceil(this.width / (maxH * 8));
		const mcusY		= Math.ceil(this.height / (maxV * 8));

		let pixels: Uint8Array;

		const plane		= this.planes[options.plane];
		if (plane) {
			return {
				width: plane.width,
				height: plane.height,
				pixels: await plane.getPixels(0, 0, plane.width, plane.height)
			};

		} else {
			const bpp	= options.plane === 'RGBA' ? 4 : 3;
			pixels		= new Uint8Array(this.width * this.height * bpp);

			for (let my = 0, mi = 0; my < mcusY; my++) {
				const y0 = my * maxV * 8;
				const y1 = Math.min(this.height, y0 + maxV * 8);

				for (let mx = 0; mx < mcusX; mx++, mi++) {
					const x0 = mx * maxH * 8;
					const x1 = Math.min(this.width, x0 + maxH * 8);

					const s0 = this.planes.Y!.mips[0](mi);
					const s1 = this.planes.Cb?.mips[0](mi);
					const s2 = this.planes.Cr?.mips[0](mi);
					if (s1 && s2)  {
						for (let y = y0; y < y1; y++) {
							const sx0	= s0(y - y0);
							const sx1	= s1(y - y0);
							const sx2	= s2(y - y0);
							const row	= y * this.width;
							for (let x = x0; x < x1; x++)
								ycbcrToRgb(pixels, (row + x) * bpp, sx0(x - x0), sx1(x - x0) - 128, sx2(x - x0) - 128);
						}
					} else {
						for (let y = y0; y < y1; y++) {
							const sx	= s0(y - y0);
							const row	= y * this.width;
							for (let x = x0; x < x1; x++)
								greyToRgb(pixels, (row + x) * bpp, sx(x - x0));
						}
					}
				}
			}

			if (options.plane === 'RGBA') {
				for (let i = 0; i < pixels.length; i += 4)
					pixels[i + 3] = 255;
			}
		}

		return {
			width: this.width,
			height: this.height,
			pixels
		};
	}
*/
	static load(data: Uint8Array): JPEG {
		const segments = bin.read(new bin.stream(data), bin.RemainingArray(JPEGSegment));
		const sof = segments.find(s => s.marker === JPEGMarker.SOF0);
		if (!sof)
			throw new Error('JPEG missing SOF0');

		return new JPEG(sof);
	}
};
