import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmWav, validSpeechWav, transcriptPlacement, SPEECH_RATE, noteSpeechEndpoint } from './speechAudio.ts';

test('PCM WAV is bounded, mono, 16 kHz and accepted by the main validator', () => {
  const wav = pcmWav([new Float32Array([0, 1, -1])], 3);
  assert.equal(validSpeechWav(wav), true);
  assert.equal(new DataView(wav.buffer).getInt16(46, true), 32767);
  wav[24] = 0;
  assert.equal(validSpeechWav(wav), false);
  assert.throws(() => pcmWav([new Float32Array(1)], SPEECH_RATE * 21), /timeout/);
});

test('silence detection waits for speech and then a quiet stretch', () => {
  const quiet = noteSpeechEndpoint({ heardMs: 0, silenceMs: 0 }, 0, 1000);
  assert.equal(quiet.ended, false);
  const blip = noteSpeechEndpoint({ heardMs: 0, silenceMs: 0 }, 0.2, 100);
  assert.equal(blip.ended, false);
  const faded = noteSpeechEndpoint(blip, 0, 1000);
  assert.equal(faded.heardMs, 0);
  assert.equal(faded.ended, false);
  const heard = noteSpeechEndpoint({ heardMs: 0, silenceMs: 0 }, 0.2, 300);
  const still = noteSpeechEndpoint(heard, 0, 800);
  assert.equal(still.ended, false);
  const ended = noteSpeechEndpoint(still, 0, 200);
  assert.equal(ended.ended, true);
  const resumed = noteSpeechEndpoint(heard, 0.2, 100);
  assert.equal(resumed.silenceMs, 0);
  assert.equal(resumed.ended, false);
});

test('transcript never overwrites a pre-existing or edited draft', () => {
  assert.equal(transcriptPlacement('', ''), 'insert');
  assert.equal(transcriptPlacement('hello', 'hello'), 'stage');
  assert.equal(transcriptPlacement('', 'user typed while listening'), 'stage');
});
