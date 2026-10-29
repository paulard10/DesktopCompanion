/** Original deterministic artwork. No files, screenshots, fonts or user input. */
import { crc32, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { SyntheticCrop } from './visionImage.js';
export const VISION_PILOT_QUESTION = 'Read the arithmetic expression in this image and describe the colored shape.';
export function createVisionPilotFixture(): SyntheticCrop {
  const width = 384, height = 256, raw = Buffer.alloc((width * 4 + 1) * height);
  const pixel = (x: number, y: number, rgb: readonly number[]): void => {
    const i = y * (width * 4 + 1) + x * 4 + 1;
    raw[i] = rgb[0]!; raw[i + 1] = rgb[1]!; raw[i + 2] = rgb[2]!; raw[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixel(x, y, [248, 250, 252]);
  const glyphs: Record<string, string> = {
    A:'01110/10001/10001/11111/10001/10001/10001', C:'01111/10000/10000/10000/10000/10000/01111',
    D:'11110/10001/10001/10001/10001/10001/11110', E:'11111/10000/10000/11110/10000/10000/11111',
    G:'01111/10000/10000/10111/10001/10001/01111', I:'11111/00100/00100/00100/00100/00100/11111',
    K:'10001/10010/10100/11000/10100/10010/10001', L:'10000/10000/10000/10000/10000/10000/11111',
    M:'10001/11011/10101/10101/10001/10001/10001', N:'10001/11001/11001/10101/10011/10011/10001',
    O:'01110/10001/10001/10001/10001/10001/01110', P:'11110/10001/10001/11110/10000/10000/10000',
    R:'11110/10001/10001/11110/10100/10010/10001', S:'01111/10000/10000/01110/00001/00001/11110',
    T:'11111/00100/00100/00100/00100/00100/00100', '7':'11111/00001/00010/00100/01000/01000/01000',
    '5':'11111/10000/10000/11110/00001/00001/11110', '1':'00100/01100/00100/00100/00100/00100/01110',
    '2':'01110/10001/00001/00010/00100/01000/11111', '+':'00000/00100/00100/11111/00100/00100/00000',
    '=':'00000/11111/00000/11111/00000/00000/00000',
  };
  for (const [text, top, scale] of [['DESKTOPCOMPANION TEST', 22, 2], ['7 + 5 = 12', 72, 3], ['GREEN CIRCLE', 216, 2]] as const) {
    [...text].forEach((letter, k) => (glyphs[letter] ?? '').split('/').forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit === '1') for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++)
        pixel(24 + k * 6 * scale + x * scale + sx, top + y * scale + sy, [20, 30, 40]);
    })));
  }
  for (let y = 120; y < 202; y++) for (let x = 151; x < 233; x++)
    if ((x - 192) ** 2 + (y - 161) ** 2 <= 40 ** 2) pixel(x, y, [20, 180, 60]);
  const chunk = (name: string, data: Buffer): Buffer => {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { kind: 'approved-synthetic-crop', mime: 'image/png', bytes, width, height, x: 0, y: 0,
    sourceWidth: 512, sourceHeight: 384 }; // Synthetic canvas metadata, never desktop geometry.
}
export function visionPilotSpecification(): { width: number; height: number; bytes: number; sha256: string; question: string } {
  const fixture = createVisionPilotFixture();
  return { width: fixture.width, height: fixture.height, bytes: fixture.bytes.byteLength,
    sha256: createHash('sha256').update(fixture.bytes).digest('hex'), question: VISION_PILOT_QUESTION };
}
