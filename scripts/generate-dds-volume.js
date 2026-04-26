const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const width = Number(args[0] || 4);
const height = Number(args[1] || width);
const depth = Number(args[2] || width);
const bytesPerPixel = 4;
const pitch = width * bytesPerPixel;
const pixelCount = width * height * depth;
const headerSize = 128;
const buffer = Buffer.alloc(headerSize + pixelCount * bytesPerPixel);

if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 || !Number.isInteger(depth) || depth <= 0) {
  console.error('Usage: node generate-dds-volume.js [width] [height] [depth]');
  process.exit(1);
}

const lettersByOctant = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const letterColors = {
  A: [255, 80, 80],
  B: [80, 255, 80],
  C: [80, 80, 255],
  D: [255, 200, 80],
  E: [255, 80, 255],
  F: [80, 255, 255],
  G: [255, 160, 80],
  H: [255, 255, 255],
};

const letterPatterns = {
  A: [
    '0011100',
    '0100010',
    '1000001',
    '1000001',
    '1111111',
    '1000001',
    '1000001',
    '1000001',
    '1000001',
  ],
  B: [
    '1111100',
    '1000010',
    '1000010',
    '1111100',
    '1000010',
    '1000010',
    '1000010',
    '1000010',
    '1111100',
  ],
  C: [
    '0111110',
    '1000001',
    '1000000',
    '1000000',
    '1000000',
    '1000000',
    '1000001',
    '0111110',
  ],
  D: [
    '1111110',
    '1000001',
    '1000001',
    '1000001',
    '1000001',
    '1000001',
    '1000001',
    '1111110',
  ],
  E: [
    '1111111',
    '1000000',
    '1000000',
    '1111110',
    '1000000',
    '1000000',
    '1000000',
    '1111111',
  ],
  F: [
    '1111111',
    '1000000',
    '1000000',
    '1111110',
    '1000000',
    '1000000',
    '1000000',
    '1000000',
  ],
  G: [
    '0111110',
    '1000001',
    '1000000',
    '1000111',
    '1000001',
    '1000001',
    '1000001',
    '0111110',
  ],
  H: [
    '1000001',
    '1000001',
    '1000001',
    '1111111',
    '1000001',
    '1000001',
    '1000001',
    '1000001',
  ],
};

function writeUInt32LE(value, offset) {
  buffer.writeUInt32LE(value >>> 0, offset);
}

function isLetterVoxel(letter, lx, ly, lz, ox, oy, oz) {
  const pattern = letterPatterns[letter];
  const patternH = pattern.length;
  const patternW = pattern[0].length;
  const marginX = Math.floor(ox * 0.125);
  const marginY = Math.floor(oy * 0.125);
  const marginZ = Math.floor(oz * 0.18);
  const drawW = ox - marginX * 2;
  const drawH = oy - marginY * 2;
  if (lx < marginX || lx >= marginX + drawW || ly < marginY || ly >= marginY + drawH) {
    return false;
  }
  if (lz < marginZ || lz >= oz - marginZ) {
    return false;
  }

  const px = Math.floor(((lx - marginX) * patternW) / drawW);
  const py = Math.floor(((ly - marginY) * patternH) / drawH);

  return pattern[py] && pattern[py][px] === '1';
}

buffer.write('DDS ', 0, 4, 'ascii');
writeUInt32LE(124, 4); // size
writeUInt32LE(0x80100F, 8); // flags: caps, height, width, pitch, pixel format, depth
writeUInt32LE(height, 12);
writeUInt32LE(width, 16);
writeUInt32LE(pitch, 20);
writeUInt32LE(depth, 24);
writeUInt32LE(0, 28); // mipMapCount
// reserved1 44 bytes already zero
const ddspfOffset = 76;
writeUInt32LE(32, ddspfOffset); // pf.size
writeUInt32LE(0x41, ddspfOffset + 4); // pf.flags: RGB | ALPHAPIXELS
writeUInt32LE(0, ddspfOffset + 8); // fourCC
writeUInt32LE(32, ddspfOffset + 12); // RGBBitCount
writeUInt32LE(0x000000FF, ddspfOffset + 16); // RBitMask
writeUInt32LE(0x0000FF00, ddspfOffset + 20); // GBitMask
writeUInt32LE(0x00FF0000, ddspfOffset + 24); // BBitMask
writeUInt32LE(0xFF000000, ddspfOffset + 28); // ABitMask
writeUInt32LE(0x1000, 108); // caps: DDSCAPS_TEXTURE
writeUInt32LE(0x00200000, 112); // caps2: DDSCAPS2_VOLUME
// caps3, caps4, reserved2 remain zero

const xHalf = Math.floor(width / 2);
const yHalf = Math.floor(height / 2);
const zHalf = Math.floor(depth / 2);
const dataOffset = headerSize;
for (let z = 0; z < depth; z++) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = dataOffset + ((z * width * height) + (y * width) + x) * bytesPerPixel;
      const xBit = x >= xHalf ? 1 : 0;
      const yBit = y >= yHalf ? 1 : 0;
      const zBit = z >= zHalf ? 1 : 0;
      const letter = lettersByOctant[xBit + (yBit << 1) + (zBit << 2)];
      const lx = xBit ? x - xHalf : x;
      const ly = yBit ? y - yHalf : y;
      const lz = zBit ? z - zHalf : z;
      const inLetter = isLetterVoxel(letter, lx, ly, lz, xHalf, yHalf, zHalf);

      if (inLetter) {
        const [r, g, b] = letterColors[letter];
        buffer[index + 0] = r;
        buffer[index + 1] = g;
        buffer[index + 2] = b;
        buffer[index + 3] = 255;
      } else {
        const bg = 24;
        buffer[index + 0] = bg;
        buffer[index + 1] = bg;
        buffer[index + 2] = bg;
        buffer[index + 3] = 32;
      }
    }
  }
}

const outName = `volume-${width}x${height}x${depth}.dds`;
const outPath = path.resolve(__dirname, '..', 'test', outName);
fs.writeFileSync(outPath, buffer);
console.log('Generated volume DDS:', outPath);
