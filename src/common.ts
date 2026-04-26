import * as bin from '@isopodlabs/binary';

export function concatenateBuffers<T extends bin.utils.TypedArray>(buffers: T[]): T {
	const totalLen	= buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
	const out 		= new ArrayBuffer(totalLen);
	const out8		= new Uint8Array(out);
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

//-----------------------------------------------------------------------------
// Bitmap Interface
//-----------------------------------------------------------------------------

export type Type		= '2d'|'3d'|'cube'|'2d-array';
export type PlaneName	= '?'|'I'|'R'|'G'|'B'|'A'|'Y'|'Cb'|'Cr'|'RG'|'RGB'|'RGBA'|'YA'|'IA'|'CbCr'|'YCbCr'|'YCbCrA'|'Cy'|'Ma'|'Ye'|'K'|'L'|'a'|'b'|'Alpha'|'Depth'|'Stencil';

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
	layer?: number;
	mip?:	number;
};
export interface Result {
	width: number;
	height: number;
	pixels: bin.utils.TypedArray;
}

export interface Plane {
	width:	number;
	height:	number;
	depth?:	number;
	mips:	any[0];//bin.utils.TypedArray<T>[];
}

export interface Image {
	type:	Type;
	width:	number;
	height:	number;
	depth?:	number;
	planes: {[K in PlaneName]?: Plane};//<PlanesType<K>>};
	palette?: bin.utils.TypedArray | undefined;
}

export abstract class BaseImage implements Image {
	depth?: number;
	constructor(
		public type: 	Type,
		public width: 	number,
		public height: 	number,
		public planes: 	{[K in PlaneName]?: Plane;}//<PlanesType<K>>}
	) {}
	abstract getPixels(options: Options): Promise<Result>;
};

export function mipSize(size: number, mip: number) {
	return Math.max(1, (size + (1 << mip) - 1) >> mip);
}

/*
function upsamplePlane(plane: Plane, width: number, height: number): Uint8Array {
	const source = plane.mips[0];
	if (plane.width === width && plane.height === height)
		return source;
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		const sy = Math.floor(y * plane.height / height);
		for (let x = 0; x < width; x++) {
			const sx = Math.floor(x * plane.width / width);
			out[y * width + x] = source[sy * plane.width + sx];
		}
	}
	return out;
}
*/

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

function gamma(x: number) {
	return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}
export function labToRgb(pixels: Uint8Array, i: number, l: number, a: number, b: number) {
	const y		= (l + 16) / 116;
	const x		= a / 500 + y;
	const z		= y - b / 200;
	const x3	= x * x * x;
	const y3	= y * y * y;
	const z3	= z * z * z;
	const X		= 0.95047 * (x3 > 0.008856 ? x3 : (x - 16 / 116) / 7.787);
	const Y		= 1.00000 * (y3 > 0.008856 ? y3 : (y - 16 / 116) / 7.787);
	const Z		= 1.08883 * (z3 > 0.008856 ? z3 : (z - 16 / 116) / 7.787);
	pixels[i + 0] = clamp8(Math.round(gamma(X * 3.2406 + Y * -1.5372 + Z * -0.4986) * 255));
	pixels[i + 1] = clamp8(Math.round(gamma(X * -0.9689 + Y * 1.8758 + Z * 0.0415) * 255));
	pixels[i + 2] = clamp8(Math.round(gamma(X * 0.0557 + Y * -0.2040 + Z * 1.0570) * 255));
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


export function copyPlane<T>(src: bin.utils.TypedArray<T>, dst: Uint8Array, width: number, height: number, srcStride: number, dstSize: number, put: (dst: Uint8Array, i: number, src: T) => void) {
	for (let y = 0, j = 0; y < height; y++) {
		for (let x = 0, i = y * srcStride; x < width; x++, i++, j += dstSize)
			put(dst, j, src[i]);
	}
}

export function copyPlane0<T>(src: bin.utils.TypedArray<T>, dst: Uint8Array, numpixels: number, dstSize: number, put: (dst: Uint8Array, i: number, src: T) => void) {
	for (let i = 0, j = 0; i < numpixels; i++, j += dstSize)
		put(dst, j, src[i]);
}

export function getPixels(image: BaseImage, options: Options, unpalette?: (color: number) => [number, number, number]): Result {
	const p = image.planes[options.plane];
	if (p)
		return {width: p.width, height: p.height, pixels: p.mips[0]};

	const getPlanes = (names: PlaneName[]): Record<PlaneName, any> | undefined => {
		const result: Record<PlaneName, any> = {} as any;
		for (const name of names) {
			const plane = image.planes[name]?.mips[0];
			if (!plane)
				return undefined;
			result[name] = plane;
		}
		return result;
	};

	const numpixels = image.width * image.height;
	if (options.plane === 'RGBA' || options.plane === 'RGB') {
		const bpp = options.plane === 'RGBA' ? 4 : 3;
		const out = new Uint8Array(numpixels * bpp);

		if (image.planes['I'] && unpalette) {
			const planeI = image.planes['I']?.mips[0];
			for (let i = 0, j = 0; i < numpixels; i++, j += bpp) {
				const color = unpalette(planeI[i]);
				putRgb(out, j, color[0], color[1], color[2]);
			}
		}

		let planes: Record<PlaneName, any> | undefined;
		if ((planes = getPlanes(['R', 'G', 'B']))) {
			for (let i = 0, j = 0; i < numpixels; i++, j += bpp)
				putRgb(out, j, planes.R[i], planes.G[i], planes.B[i]);

		} else if ((planes = getPlanes(['Cy', 'Ma', 'Ye']))) {
			for (let i = 0, j = 0; i < numpixels; i++, j += bpp)
				cmykToRgb(out, j, planes.Cy[i], planes.Ma[i], planes.Ye[i], 0);

		} else if ((planes = getPlanes(['L', 'a', 'b']))) {
			for (let i = 0, j = 0; i < numpixels; i++, j += bpp)
				labToRgb(out, j, planes.L[i], planes.a[i] - 128, planes.b[i] - 128);

		} else if ((planes = getPlanes(['Y']))) {
			for (let i = 0, j = 0; i < numpixels; i++, j += bpp)
				greyToRgb(out, j, planes.Y[i]);

		} else {
			throw new Error(`PSD does not contain RGB, CMYK or Lab channels`);
		}

		if (options.plane === 'RGBA') {
			const planeA = image.planes['Alpha']?.mips[0];
			for (let i = 0; i < numpixels; i++)
				out[i * 4 + 3] = planeA ? planeA[i] : 255;
		}
		return {width: image.width, height: image.height, pixels: out};
	}

	throw new Error(`PSD does not support requested plane format: ${options.plane}`);
}
