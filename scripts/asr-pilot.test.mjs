import test from 'node:test';
import assert from 'node:assert/strict';
import { accuracy, options, wavSeconds } from './asr-pilot.mjs';

test('Spanish normalization ignores punctuation and case but keeps accents', () => {
  assert.equal(accuracy('Hola, ¿cómo estás?', 'hola como estás').edits, 1);
  assert.equal(accuracy('¡Hola, cómo estás!', 'hola cómo estás').wordErrorRate, 0);
  assert.equal(accuracy('', 'hola cómo estás').edits, 3);
});

test('natural samples require a declared workload and bounded flags', () => {
  assert.throws(() => options(['--sample=natural-short']), /require --profile/);
  assert.equal(options(['--sample=natural-technical', '--profile=workload', '--threads=2']).sample,
    'natural-technical');
  assert.throws(() => options(['--threads=12']), /Threads must/);
  assert.throws(() => options(['--sample=natural-short=--no-gpu']), /Unsupported option/);
});

test('WAV validation requires 16 kHz mono PCM and at most 20 seconds', () => {
  const wav = Buffer.alloc(44 + 32000);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(32000, 40);
  assert.equal(wavSeconds(wav), 1);
  wav.writeUInt32LE(22050, 24);
  assert.throws(() => wavSeconds(wav), /16 kHz/);
});
