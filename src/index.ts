/// <reference types="node" />

import * as zlib from 'zlib';
export * from './common';
export {BMP} from './bmp';
export {PNG} from './png';
export {JPEG} from './jpeg';
export {GIF} from './gif';
export {DDS} from './dds';
export {PSD} from './psd';
export {TGA} from './tga';
export {TIFF} from './tiff';

import {configureDecompression, configureCompression} from '@isopodlabs/binary';

configureDecompression('deflate', buffer => new Promise((resolve, reject) => {
	zlib.inflate(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureDecompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.inflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureDecompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gunzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureCompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.deflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureCompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));
