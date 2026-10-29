/** Node/main-only, bounded PNG validation. Labels alone never prove consent. */
import { crc32, inflateSync } from 'node:zlib';

export const VISION_LIMITS = Object.freeze({
  pngBytes: 2 * 1024 * 1024, pixels: 2_097_152, side: 2048,
  sourcePixels: 8_388_608, sourceSide: 4096, minSide: 16,
  dataUriChars: 2_796_226, jsonBytes: 3 * 1024 * 1024,
  questionChars: 500, questionBytes: 2000, outputTokens: 384,
  answerChars: 1600, responseBytes: 256 * 1024,
});
const PREFIX = 'data:image/png;base64,';
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface SyntheticCrop {
  kind: 'approved-synthetic-crop'; mime: 'image/png'; bytes: Uint8Array;
  width: number; height: number; x: number; y: number;
  sourceWidth: number; sourceHeight: number;
}
export type ApprovedCrop = Omit<SyntheticCrop, 'kind'> & {
  kind: 'approved-synthetic-crop' | 'approved-local-crop';
};
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',') &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d);
}
function reject(): never { throw new Error('Invalid synthetic PNG crop.'); }

/** Recheck generated encoding; this does not admit URLs/encoded images as input. */
export function isCanonicalPngDataUri(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(PREFIX) || value.length > VISION_LIMITS.dataUriChars) return false;
  const encoded = value.slice(PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length <= VISION_LIMITS.pngBytes && bytes.subarray(0, 8).equals(SIGNATURE) &&
    bytes.toString('base64') === encoded;
}

export function encodeSyntheticCrop(value: unknown): string {
  try {
    if (!record(value) || !exactKeys(value, ['kind','mime','bytes','width','height','x','y','sourceWidth','sourceHeight']) ||
        !['approved-synthetic-crop', 'approved-local-crop'].includes(value.kind as string) ||
        value.mime !== 'image/png' || !(value.bytes instanceof Uint8Array)) reject();
    const crop = value as unknown as ApprovedCrop;
    const { width, height, sourceWidth, sourceHeight, x, y } = crop;
    if (![width,height,sourceWidth,sourceHeight,x,y].every(Number.isSafeInteger) || x < 0 || y < 0 ||
        width < VISION_LIMITS.minSide || height < VISION_LIMITS.minSide ||
        width > VISION_LIMITS.side || height > VISION_LIMITS.side || width * height > VISION_LIMITS.pixels ||
        sourceWidth <= 0 || sourceHeight <= 0 || sourceWidth > VISION_LIMITS.sourceSide || sourceHeight > VISION_LIMITS.sourceSide ||
        sourceWidth * sourceHeight > VISION_LIMITS.sourcePixels || x + width > sourceWidth || y + height > sourceHeight ||
        width * height >= sourceWidth * sourceHeight) reject();
    const bytes = Buffer.from(crop.bytes.buffer, crop.bytes.byteOffset, crop.bytes.byteLength);
    if (bytes.length < 57 || bytes.length > VISION_LIMITS.pngBytes || !bytes.subarray(0, 8).equals(SIGNATURE)) reject();
    let offset = 8, count = 0, channels = 0, ended = false, dataStarted = false;
    const compressed: Buffer[] = [];
    while (offset < bytes.length) {
      if (++count > 128 || offset + 12 > bytes.length || ended) reject();
      const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
      if (end > bytes.length) reject();
      if (bytes.subarray(offset + 4, offset + 8).some(c => !((c >= 65 && c <= 90) || (c >= 97 && c <= 122)))) reject();
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      const data = bytes.subarray(offset + 8, end - 4);
      if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) reject();
      if (count === 1) {
        if (type !== 'IHDR' || length !== 13 || data.readUInt32BE(0) !== width || data.readUInt32BE(4) !== height ||
            data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) reject();
        channels = data[9] === 6 ? 4 : 3;
      } else if (type === 'IDAT') {
        if (!length) reject();
        dataStarted = true; compressed.push(data);
      } else if (type === 'IEND') {
        if (length !== 0 || !dataStarted || end !== bytes.length) reject();
        ended = true;
      } else {
        // Small color/physical metadata only, before pixel data; no text, EXIF,
        // APNG, profiles, unknown critical chunks, or extra payload after IEND.
        const allowed: Record<string, number> = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 };
        if (dataStarted || allowed[type] !== length) reject();
      }
      offset = end;
    }
    if (!ended) reject();
    const packed = Buffer.concat(compressed), rowBytes = width * channels + 1;
    const expected = rowBytes * height;
    const decoded = inflateSync(packed, { maxOutputLength: expected + 1, info: true }) as unknown as {
      buffer: Buffer; engine: { bytesWritten: number };
    };
    if (decoded.buffer.length !== expected || decoded.engine.bytesWritten !== packed.length) reject();
    for (let row = 0; row < height; row++) if (decoded.buffer[row * rowBytes]! > 4) reject();
    const uri = PREFIX + bytes.toString('base64');
    if (!isCanonicalPngDataUri(uri)) reject();
    return uri;
  } catch { return reject(); }
}
