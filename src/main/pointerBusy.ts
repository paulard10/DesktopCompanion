/**
 * True while a mouse button or a typing key is held.
 * The key code is never stored or logged. A missing binding reports idle;
 * a moving pointer is still blocked by the stillness gate.
 */

import { createRequire } from 'node:module';

const KEYS = [0x01, 0x02, 0x04, 0x08, 0x09, 0x0d, 0x10, 0x11, 0x12, 0x14, 0x1b, 0x20];

let readKey: ((key: number) => number) | null | undefined;

function reader(): ((key: number) => number) | null {
  if (readKey !== undefined) {
    return readKey;
  }
  if (process.platform !== 'win32') {
    readKey = null;
    return readKey;
  }
  try {
    const require = createRequire(__filename);
    const koffi = require('koffi') as { load: (name: string) => { func: (sig: string) => (key: number) => number } };
    readKey = koffi.load('user32.dll').func('short __stdcall GetAsyncKeyState(int)');
  } catch {
    readKey = null;
  }
  return readKey;
}

export function handsBusy(): boolean {
  const read = reader();
  if (!read) {
    return false;
  }
  for (const key of KEYS) {
    if (held(read(key))) {
      return true;
    }
  }
  for (let key = 0x30; key <= 0x5a; key += 1) {
    if (held(read(key))) {
      return true;
    }
  }
  return false;
}

function held(value: number): boolean {
  return (value & 0x8000) !== 0;
}
