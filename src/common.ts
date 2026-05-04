import * as bin from '@isopodlabs/binary';

//-----------------------------------------------------------------------------
// helpers
//-----------------------------------------------------------------------------

export function concatenateBuffers<T extends bin.utils.TypedArray>(buffers: T[]): T {
	const out 	= new ArrayBuffer(buffers.reduce((sum, buf) => sum + buf.byteLength, 0));
	const out8	= new Uint8Array(out);
	let offset = 0;
	for (const buf of buffers) {
		out8.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), offset);
		offset += buf.byteLength;
	}
	return new (buffers[0].constructor as bin.utils.TypedArrayConstructor<T>)(out);
}

export function clamp8(x: number) {
	return x < 0 ? 0 : x > 255 ? 255 : x;
}
function gamma(x: number) {
	return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}
function gamma8(x: number) {
	return clamp8(Math.round(gamma(x) * 255));
}

export function to255(bits: number) : bin.utils.BitAdapter<number, number> {
	const s = 255 / ((1 << bits) - 1) | 0;
	return {
		bits,
		to: i => i * s,
		from: i => (i / s) | 0
	};
}

export function mipSize(size: number, mip: number) {
	return Math.max(1, (size + (1 << mip) - 1) >> mip);
}

export function ycocgToRgb(pixels: Uint8Array, i: number, Y: number, Co: number, Cg: number) {
	pixels[i + 0] = clamp8(Y + Co - Cg);
	pixels[i + 1] = clamp8(Y + Cg);
	pixels[i + 2] = clamp8(Y - Co - Cg);
}

export function ycbcrToRgb(pixels: Uint8Array, i: number, Y: number, Cb: number, Cr: number) {
	pixels[i + 0] = clamp8((Y + 1.402 * Cr + 0.5) | 0);
	pixels[i + 1] = clamp8((Y - 0.344136 * Cb - 0.714136 * Cr + 0.5) | 0);
	pixels[i + 2] = clamp8((Y + 1.772 * Cb + 0.5) | 0);
}

export function cmykToRgb(pixels: Uint8Array, i: number, c: number, m: number, y: number, k: number) {
	pixels[i + 0] = 255 - (c + k) / 2;
	pixels[i + 1] = 255 - (m + k) / 2;
	pixels[i + 2] = 255 - (y + k) / 2;
}

export function labToXYZ(l: number, a: number, b: number) {
	const y		= (l + 16) / 116;
	const x		= a / 500 + y;
	const z		= y - b / 200;
	const x3	= x * x * x;
	const y3	= y * y * y;
	const z3	= z * z * z;
	return {
		X:	0.95047 * (x3 > 0.008856 ? x3 : (x - 16 / 116) / 7.787),
		Y:	1.00000 * (y3 > 0.008856 ? y3 : (y - 16 / 116) / 7.787),
		Z:	1.08883 * (z3 > 0.008856 ? z3 : (z - 16 / 116) / 7.787)
	};
}
export function XYZToRgb(pixels: Uint8Array, i: number, X: number, Y: number, Z: number) {
	pixels[i + 0] = gamma8(X * 3.2406 + Y * -1.5372 + Z * -0.4986);
	pixels[i + 1] = gamma8(X * -0.9689 + Y * 1.8758 + Z * 0.0415);
	pixels[i + 2] = gamma8(X * 0.0557 + Y * -0.2040 + Z * 1.0570);
}

export function labToRgb(pixels: Uint8Array, i: number, l: number, a: number, b: number) {
	const {X, Y, Z} = labToXYZ(l, a, b);
	XYZToRgb(pixels, i, X, Y, Z);
}

export function greyToRgb(pixels: Uint8Array, i: number, Y: number) {
	pixels[i + 0] = Y;
	pixels[i + 1] = Y;
	pixels[i + 2] = Y;
}
export function putRgb(pixels: Uint8Array, i: number, r: number, g: number, b: number) {
	pixels[i + 0] = r;
	pixels[i + 1] = g;
	pixels[i + 2] = b;
}
export function putRgba(pixels: Uint8Array, i: number, r: number, g: number, b: number, a: number) {
	pixels[i + 0] = r;
	pixels[i + 1] = g;
	pixels[i + 2] = b;
	pixels[i + 3] = a;
}

//-----------------------------------------------------------------------------
// Image interface
//-----------------------------------------------------------------------------

export type Type		= '2d'|'3d'|'cube'|'2d-array';
export type PlaneName	= '?'|'I'|'IA'
	|'R'|'G'|'B'|'A'|'RG'|'RGB'|'RGBA'
	|'Y'|'Cb'|'Cr'|'CbCr'|'YCbCr'|'YCbCrA'|'YA'
	|'Cy'|'Ma'|'Ye'|'K'|'CyMaYeK'
	|'L'|'La'|'Lb'|'LLaLb'|'LLaLbA'
	|'Depth'|'Stencil';

export type PlaneType<K extends PlaneName> = 
		K extends 'RG'		? {r: number, g: number}
	:	K extends 'RGB'		? {r: number, g: number, b: number}
	:	K extends 'RGBA'	? {r: number, g: number, b: number, a: number}
	:	K extends 'YA'		? {y: number, a: number}
	:	K extends 'YCbCr'	? {y: number, cb: number, cr: number}
	:	number;

export interface Options {
	plane:	PlaneName;
	time?:	number;
	layer?: number | string;
	mip?:	number;
	region?: {x: number, y: number, w: number, h: number;}
};

export interface Result {
	plane:	PlaneName;
	width:	number;
	height: number;
	pixels: bin.utils.TypedArray<number>;
}

export interface Plane {
	width:	number;
	height:	number;
	depth?:	number;
	mips?:	number;
	getPixels?(options: Options): Promise<bin.utils.TypedArray<number>>;
}

export class Image {
	depth?:		number;
	unpalette?:	(i: number) => [number, number, number];
	
	constructor(
		public type: 	Type,
		public width: 	number,
		public height: 	number,
		public planes: 	{[K in PlaneName]?: Plane;} = {}																			
	) {}
	async getPixels(options: Options): Promise<Result> {
		if (this.depth) {
			if (options.layer !== undefined) {
				const layer = this.getLayer(options.layer);
				if (!layer)
					throw new Error(`Layer ${options.layer} not found`);
				return layer.getPixels(options);
			}
			const results = await Promise.all(Array.from({length: this.depth}, (_, i) => this.getLayer(i)?.getPixels(options)));
			return {
				plane: options.plane,
				width: this.width,
				height: this.height * results.length,
				pixels: concatenateBuffers(results.map(r => r!.pixels)),
			};
		}
		return getPixels(this, options, this.unpalette);
	}
	getLayer(_layer: string | number): Image| undefined {
		return undefined;
	}
};

function upsamplePlane(result: Result, width: number, height: number): ArrayLike<number> {
	if (result.width === width && result.height === height)
		return result.pixels;
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		const sy = Math.floor(y * result.height / height);
		for (let x = 0; x < width; x++) {
			const sx = Math.floor(x * result.width / width);
			out[y * width + x] = result.pixels[sy * result.width + sx];
		}
	}
	return out;
}

type Converter = (out: Uint8Array, j: number, ...args: number[])=>void;

export async function convertInterleaved(outName: PlaneName, plane: Plane, outBpp: number, options: Options, converter: Converter) {
	const width		= plane.width, height = plane.height;
	const numPixels	= width * height;
	const inPixels	= await plane.getPixels!(options);
	const inBpp		= inPixels.length / numPixels;
	const outPixels	= new Uint8Array(numPixels * outBpp);
	for (let i = 0; i < numPixels; i++) {
		const s = i * inBpp;
		converter(outPixels, i * outBpp, inPixels[s], inPixels[s+1], inPixels[s+2], inPixels[s+3]);

	}
	return {plane: outName, width, height, pixels: outPixels};
}

export async function convertPlanes(outName: PlaneName, planes: Plane[], width: number, height: number, outBpp: number, options: Options, converter: Converter) {
	const numPixels	= width * height;
	const inPixels	= await Promise.all(planes.map(plane =>
		plane.getPixels!(options).then(pixels => upsamplePlane({plane: '?', width: plane.width, height: plane.height, pixels}, width, height))
	));
	const outPixels		= new Uint8Array(numPixels * outBpp);
	for (let i = 0; i < numPixels; i++)
		converter(outPixels, i * outBpp, inPixels[0][i], inPixels[1][i], inPixels[2][i], inPixels[3]?.[i]);
	return {plane: outName, width, height, pixels: outPixels};
}

export async function fillChannel(result: Result, bpp: number, alpha: bin.utils.TypedArray<number> | number, chan: number) {
	if (typeof alpha === 'number') {
		for (let j = chan; j < result.pixels.length; j += bpp)
			result.pixels[j] = 255;
	} else {
		for (let i = 0, j = chan; j < alpha.length; i++, j += bpp)
			result.pixels[j] = alpha[i];
	}
}


function subPlane(image: Image, name: PlaneName): Plane | undefined {
	for (const p of Object.keys(image.planes) as PlaneName[]) {
		const chans = [...p.matchAll(/[A-Z][a-z]*/g)];
		const index = chans.findIndex(m => m[0] === name);
		if (index >= 0) {
			const plane = image.planes[p]!;
			return {width: plane.width, height: plane.height, getPixels: async (options) => {
				const src = await plane.getPixels!(options);
				const numpixels = plane.width * plane.height;
				const out = new Uint8Array(numpixels);
				for (let i = 0, j = index; i < numpixels; i++, j += chans.length)
					out[i] = src[j];
				return out;
			}};
		}
	}
}

function getPlanes<T extends PlaneName[]>(image: Image, names: T) {
	const result: Plane[] = [];
	for (const name of names) {
		const plane = image.planes[name] ?? subPlane(image, name);
		if (!plane)
			return;
		result.push(plane);
	}
	return result;
}

export async function getPixels(image: Image, options: Options, unpalette?: (color: number) => [number, number, number]): Promise<Result> {
	const plane = image.planes[options.plane] ?? subPlane(image, options.plane);
	if (plane)
		return {plane: options.plane, width: plane.width, height: plane.height, pixels: await plane.getPixels!(options)};

	const numpixels = image.width * image.height;

	if (options.plane === 'RGBA' || options.plane === 'RGB') {
		const bpp = options.plane === 'RGBA' ? 4 : 3;
		if (image.planes.RGB)
			return convertInterleaved(options.plane, image.planes.RGB, bpp, options, (out, j, r, g, b) => putRgba(out, j, r, g, b, 255));

		if (image.planes.RGBA)
			return convertInterleaved(options.plane, image.planes.RGBA, bpp, options, putRgb);

		if (image.planes.YCbCr)
			return convertInterleaved(options.plane, image.planes.YCbCr, bpp, options, ycbcrToRgb);

		if (image.planes.CyMaYeK)
			return convertInterleaved(options.plane, image.planes.CyMaYeK, bpp, options, cmykToRgb);

		if (image.planes.YA)
			return convertInterleaved(options.plane, image.planes.YA, bpp, options, (out, j, y, a) => {greyToRgb(out, j, y); out[j + 3] = a;});

		let		planes: Plane[] | undefined;
		let		result: Result;

		if (image.planes['I'] && unpalette) {
			const out = new Uint8Array(numpixels * bpp);
			const planeI = await image.planes['I'].getPixels!(options);
			for (let i = 0, j = 0; i < numpixels; i++, j += bpp) {
				const color = unpalette(planeI[i]);
				putRgb(out, j, color[0], color[1], color[2]);
			}
			result = {plane: options.plane, width: image.width, height: image.height, pixels: out};

		} else if ((planes = getPlanes(image, ['R', 'G', 'B']))) {
			result = await convertPlanes(options.plane, planes, image.width, image.height, bpp, options, putRgb);

		} else if ((planes = getPlanes(image, ['Y', 'Cb', 'Cr']))) {
			result = await convertPlanes(options.plane, planes, image.width, image.height, bpp, options, (out, j, y, cb, cr) => ycbcrToRgb(out, j, y, cb - 128, cr - 128));

		} else if ((planes = getPlanes(image, ['Cy', 'Ma', 'Ye', 'K']))) {
			result = await convertPlanes(options.plane, planes, image.width, image.height, bpp, options, cmykToRgb);

		} else if ((planes = getPlanes(image, ['L', 'La', 'Lb']))) {
			result = await convertPlanes(options.plane, planes, image.width, image.height, bpp, options, (out, j, l, a, b) => labToRgb(out, j, l, a - 128, b - 128));

		} else if ((planes = getPlanes(image, ['Y']))) {
			result = await convertPlanes(options.plane, planes, image.width, image.height, bpp, options, greyToRgb);

		} else {
			throw new Error(`Image does not contain RGB, CMYK or Lab channels`);
		}

		if (options.plane === 'RGBA')
			fillChannel(result, bpp, await image.planes.A?.getPixels?.(options) ?? 255, 3);

		return result;
	}

	const planes = getPlanes(image, [...options.plane.matchAll(/[A-Z][a-z]*/g)].map(c => c[0] as PlaneName));
	if (planes)
		return convertPlanes(options.plane, planes, image.width, image.height, planes.length, options, (out, j, ...args: number[]) => {
			for (let k = 0; k < planes.length; k++)
				out[j + k] = args[k];
		});

	throw new Error(`Image does not support requested plane format: ${options.plane}`);
}
