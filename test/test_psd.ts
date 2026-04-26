import * as assert from 'assert';
import {PSD} from './psd';

function writeUint16(out: Uint8Array, offset: number, value: number) {
	out[offset] = (value >> 8) & 0xFF;
	out[offset + 1] = value & 0xFF;
}

function writeUint32(out: Uint8Array, offset: number, value: number) {
	out[offset] = (value >> 24) & 0xFF;
	out[offset + 1] = (value >> 16) & 0xFF;
	out[offset + 2] = (value >> 8) & 0xFF;
	out[offset + 3] = value & 0xFF;
}

function createPSD(width: number, height: number, channels: number, depth: number, colorMode: number, imageData: Uint8Array, colorModeData = new Uint8Array(0), compression = 0) {
	const headerSize = 4 + 2 + 6 + 2 + 4 + 4 + 2 + 2 + 4 + colorModeData.length + 4 + 0 + 4 + 0 + 2;
	const buffer = new Uint8Array(headerSize + imageData.length);
	buffer.set([0x38, 0x42, 0x50, 0x53], 0); // '8BPS'
	writeUint16(buffer, 4, 1);
	// reserved 6 bytes remain zero
	writeUint16(buffer, 12, channels);
	writeUint32(buffer, 14, height);
	writeUint32(buffer, 18, width);
	writeUint16(buffer, 22, depth);
	writeUint16(buffer, 24, colorMode);
	writeUint32(buffer, 26, colorModeData.length);
	buffer.set(colorModeData, 30);
	const imageResourcesOffset = 30 + colorModeData.length;
	writeUint32(buffer, imageResourcesOffset, 0);
	const layerInfoOffset = imageResourcesOffset + 4;
	writeUint32(buffer, layerInfoOffset, 0);
	const compressionOffset = layerInfoOffset + 4;
	writeUint16(buffer, compressionOffset, compression);
	buffer.set(imageData, compressionOffset + 2);
	return buffer;
}

async function testRawRgb() {
	const width = 2;
	const height = 1;
	const channels = 3;
	const imageData = new Uint8Array([
		255, 0,   // R channel
		0, 255,   // G channel
		0, 0      // B channel
	]);
	const psd = await PSD.load(createPSD(width, height, channels, 8, 3, imageData));
	assert.equal(psd.width, width);
	assert.equal(psd.height, height);
	const result = await psd.getPixels({plane: 'RGB'});
	assert.deepEqual(Array.from(result.pixels), [255, 0, 0, 0, 255, 0]);
	console.log('Raw RGB PSD decode ok');
}

async function testRleGrayscale() {
	const width = 2;
	const height = 1;
	const channels = 1;
	const scanline = new Uint8Array([1, 123, 45]);
	const lengths = new Uint8Array([0, 3]);
	const imageData = new Uint8Array(lengths.length + scanline.length);
	imageData.set(lengths, 0);
	imageData.set(scanline, lengths.length);
	const psd = await PSD.load(createPSD(width, height, channels, 8, 1, imageData, new Uint8Array(0), 1));
	assert.equal(psd.width, width);
	assert.equal(psd.height, height);
	const result = await psd.getPixels({plane: 'RGB'});
	assert.deepEqual(Array.from(result.pixels), [123, 123, 123, 45, 45, 45]);
	console.log('RLE grayscale PSD decode ok');
}

(async () => {
	await testRawRgb();
	await testRleGrayscale();
})();
