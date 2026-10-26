import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmWav, validSpeechWav, transcriptPlacement, SPEECH_RATE } from './speechAudio.ts';

test('PCM WAV is bounded, mono, 16 kHz and accepted by the main validator', () => {
  const wav = pcmWav([new Float32Array([0, 1, -1])], 3);
  assert.equal(validSpeechWav(wav), true);
  assert.equal(new DataView(wav.buffer).getInt16(46, true), 32767);
  wav[24] = 0;
  assert.equal(validSpeechWav(wav), false);
  assert.throws(() => pcmWav([new Float32Array(1)], SPEECH_RATE * 21), /timeout/);
});

test('transcript never overwrites a pre-existing or edited draft', () => {
  assert.equal(transcriptPlacement('', ''), 'insert');
  assert.equal(transcriptPlacement('hello', 'hello'), 'stage');
  assert.equal(transcriptPlacement('', 'user typed while listening'), 'stage');
});
