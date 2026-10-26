import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechCapture } from './speechCapture.ts';

function harness(overrides: Record<string, unknown> = {}) {
  const states: string[] = [];
  const errors: string[] = [];
  const transcripts: string[] = [];
  let stopped = 0;
  let disarmed = 0;
  let cancelled = 0;
  let mediaCalls = 0;
  const track = { stop: () => { stopped++; }, onended: null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const processor = { onaudioprocess: null as null | ((event: unknown) => void),
    connect() {}, disconnect() {} };
  const context = {
    sampleRate: 16000, destination: {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => processor,
    resume: async () => {}, close: async () => {},
  };
  const bridge = {
    armMicrophone: async () => true,
    disarmMicrophone: () => { disarmed++; },
    transcribeAudio: async () => ({ text: 'Hola mundo' }),
    cancelTranscription: () => { cancelled++; },
    ...overrides,
  };
  const media = { getUserMedia: async () => { mediaCalls++; return stream; } };
  const capture = new SpeechCapture(bridge,
    state => states.push(state),
    text => transcripts.push(text),
    text => errors.push(text),
    media as never, () => context as never);
  return { capture, states, errors, transcripts, processor, stream,
    counts: () => ({ stopped, disarmed, cancelled, mediaCalls }) };
}

function deliverAudio(processor: { onaudioprocess: null | ((event: unknown) => void) }): void {
  processor.onaudioprocess?.({
    inputBuffer: { getChannelData: () => new Float32Array(2048).fill(0.2) },
    outputBuffer: { getChannelData: () => new Float32Array(2048) },
  });
}

test('explicit start, stop, transcribing state and no automatic message send', async () => {
  const h = harness();
  assert.equal(h.counts().mediaCalls, 0);
  await h.capture.start();
  assert.equal(h.capture.currentState, 'recording');
  deliverAudio(h.processor);
  await h.capture.stop();
  assert.deepEqual(h.transcripts, ['Hola mundo']);
  assert.ok(h.states.includes('transcribing'));
  assert.equal(h.capture.currentState, 'idle');
  assert.equal(h.counts().stopped, 1);
  assert.ok(h.counts().disarmed >= 1);
});

test('memory rejection displays the main-process explanation and discards captured audio', async () => {
  let submittedWav: Uint8Array | undefined;
  const message = 'Local transcription paused: 765 MiB available; 1,024 MiB required by the current safety policy. Close unused apps or wait for memory to become available, then try again.';
  const h = harness({ transcribeAudio: async (wav: Uint8Array) => {
    submittedWav = wav;
    return { error: message };
  } });
  await h.capture.start();
  deliverAudio(h.processor);
  await h.capture.stop();
  assert.deepEqual(h.transcripts, []);
  assert.deepEqual(h.errors, [message]);
  assert.equal(h.capture.currentState, 'idle');
  assert.equal(h.counts().stopped, 1);
  assert.ok(submittedWav && submittedWav.every(byte => byte === 0));
});

test('denied microphone never starts a stream', async () => {
  const h = harness({ armMicrophone: async () => false });
  await h.capture.start();
  assert.equal(h.counts().mediaCalls, 0);
  assert.match(h.errors[0] ?? '', /denied/);
  assert.equal(h.capture.currentState, 'idle');
});

test('cancel and chat closure discard capture and ignore a late transcript', async () => {
  let answer!: (value: { text: string }) => void;
  const h = harness({ transcribeAudio: () => new Promise(resolve => { answer = resolve; }) });
  await h.capture.start();
  deliverAudio(h.processor);
  const pending = h.capture.stop();
  assert.equal(h.capture.currentState, 'transcribing');
  h.capture.cancel(); // same operation called when chat hides or closes
  answer({ text: 'Should not appear' });
  await pending;
  assert.deepEqual(h.transcripts, []);
  assert.equal(h.capture.currentState, 'idle');
  assert.ok(h.counts().cancelled > 0);
});

test('20 second sample cap cancels the microphone', async () => {
  const h = harness();
  await h.capture.start();
  for (let i = 0; i < 158 && h.capture.currentState === 'recording'; i++) deliverAudio(h.processor);
  assert.equal(h.capture.currentState, 'idle');
  assert.match(h.errors[0] ?? '', /20-second limit/);
  assert.equal(h.counts().stopped, 1);
});

test('missing microphone and unsupported capture rate give clear errors', async () => {
  const absent = harness();
  const unavailable = new SpeechCapture(
    { armMicrophone: async () => true, disarmMicrophone() {},
      transcribeAudio: async () => ({ text: '' }), cancelTranscription() {} },
    () => {}, () => {}, message => absent.errors.push(message),
    { getUserMedia: async () => { throw new DOMException('No device', 'NotFoundError'); } } as never);
  await unavailable.start();
  assert.match(absent.errors[0] ?? '', /No microphone/);

  const badRate = harness();
  badRate.capture.cancel();
  const rateCapture = new SpeechCapture(
    { armMicrophone: async () => true, disarmMicrophone() {},
      transcribeAudio: async () => ({ text: '' }), cancelTranscription() {} },
    () => {}, () => {}, message => badRate.errors.push(message),
    { getUserMedia: async () => badRate.stream } as never,
    () => ({
      sampleRate: 48000,
      close: async () => {},
    }) as never);
  await rateCapture.start();
  assert.match(badRate.errors[0] ?? '', /Unsupported audio sample rate/);
});

test('closing while permission is pending stops a stream returned later', async () => {
  let permit!: (stream: unknown) => void;
  let stopped = 0;
  const pending = new Promise(resolve => { permit = resolve; });
  const capture = new SpeechCapture(
    { armMicrophone: async () => true, disarmMicrophone() {},
      transcribeAudio: async () => ({ text: 'late' }), cancelTranscription() {} },
    () => {}, () => assert.fail('late transcript'), () => {},
    { getUserMedia: () => pending } as never,
    () => assert.fail('audio context must not start') as never);
  const start = capture.start();
  await Promise.resolve();
  capture.cancel();
  permit({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await start;
  assert.equal(stopped, 1);
  assert.equal(capture.currentState, 'idle');
});
