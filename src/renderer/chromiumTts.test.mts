import assert from 'node:assert/strict';
import test from 'node:test';
import { PABLO_VOICE_NAME } from '../shared/textToSpeech.ts';
import { createChromiumTtsProvider, type TtsVoicePhase } from './chromiumTtsProvider.ts';

class MockUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const utteranceOptions = {
  createUtterance: (text: string) => new MockUtterance(text) as unknown as SpeechSynthesisUtterance,
};

const pablo = {
  name: PABLO_VOICE_NAME,
  lang: 'es-ES',
  voiceURI: 'MSTTS_V110_esES_PabloM',
  localService: true,
  default: false,
};

interface MockSynth {
  getVoices: () => SpeechSynthesisVoice[];
  cancel: () => void;
  speak: (utter: SpeechSynthesisUtterance) => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: () => void;
  paused: boolean;
  speaking: boolean;
  emitVoices: () => void;
}

function mockSynth(options: {
  voices: () => SpeechSynthesisVoice[];
  onSpeak?: (utter: SpeechSynthesisUtterance) => void;
  onCancel?: () => void;
}): MockSynth {
  let listener: (() => void) | null = null;
  return {
    paused: false,
    speaking: false,
    getVoices: () => options.voices(),
    cancel() {
      options.onCancel?.();
    },
    speak(utter) {
      options.onSpeak?.(utter);
    },
    addEventListener(type, next) {
      if (type === 'voiceschanged') {
        listener = next;
      }
    },
    removeEventListener() {
      listener = null;
    },
    emitVoices() {
      listener?.();
    },
  };
}

function track(providerHooks?: { events?: string[] }) {
  return {
    onState(state: string) {
      providerHooks?.events?.push(`state:${state}`);
    },
    onSpeaking(active: boolean) {
      providerHooks?.events?.push(`speaking:${active}`);
    },
    onVoices(_voices: readonly unknown[], picked: unknown, phase: TtsVoicePhase) {
      providerHooks?.events?.push(`voices:${phase}:${picked ? 'pablo' : 'none'}`);
    },
  };
}

test('Pablo present immediately is selected and playback returns to idle', async () => {
  const events: string[] = [];
  let spoke = 0;
  const synthesis = mockSynth({
    voices: () => [pablo] as unknown as SpeechSynthesisVoice[],
    onSpeak(utter) {
      spoke += 1;
      queueMicrotask(() => utter.onend?.(new Event('end') as SpeechSynthesisEvent));
    },
  });
  const provider = createChromiumTtsProvider(track({ events }), synthesis, { ...utteranceOptions, voiceTimeoutMs: 50 });
  const outcome = await provider.speak('Hola.', { rate: 1, signal: new AbortController().signal });
  assert.equal(outcome, 'done');
  assert.equal(spoke, 1);
  assert.equal(provider.state(), 'idle');
  assert.equal(events.includes('state:speaking'), true);
  assert.equal(events.includes('state:idle'), true);
  provider.dispose();
});

test('Pablo appears after an empty voiceschanged', async () => {
  const voices: SpeechSynthesisVoice[] = [];
  const synthesis = mockSynth({
    voices: () => voices,
    onSpeak(utter) {
      queueMicrotask(() => utter.onend?.(new Event('end') as SpeechSynthesisEvent));
    },
  });
  const provider = createChromiumTtsProvider(track(), synthesis, { ...utteranceOptions, voiceTimeoutMs: 500, pollMs: 50 });
  const pending = provider.speak('Hola.', { rate: 1, signal: new AbortController().signal });
  synthesis.emitVoices();
  voices.push(pablo as unknown as SpeechSynthesisVoice);
  synthesis.emitVoices();
  assert.equal(await pending, 'done');
  assert.equal(provider.state(), 'idle');
  provider.dispose();
});

test('a local Helena voice speaks when Pablo is absent, and a cloud-only list does not', async () => {
  let spoke = false;
  const helena = mockSynth({
    voices: () => [{ name: 'Microsoft Helena - Spanish (Spain)', lang: 'es-ES', voiceURI: 'h', localService: true }] as unknown as SpeechSynthesisVoice[],
    onSpeak(utter) {
      spoke = true;
      queueMicrotask(() => utter.onend?.(new Event('end') as SpeechSynthesisEvent));
    },
  });
  const local = createChromiumTtsProvider(track(), helena, { ...utteranceOptions, voiceTimeoutMs: 20, pollMs: 10 });
  assert.equal(await local.speak('Hola.', { rate: 1, signal: new AbortController().signal }), 'done');
  assert.equal(local.state(), 'idle');
  assert.equal(spoke, true);
  local.dispose();

  const online = mockSynth({
    voices: () => [{ name: 'Microsoft Zira Online', lang: 'en-US', voiceURI: 'cloud', localService: false }] as unknown as SpeechSynthesisVoice[],
  });
  const cloud = createChromiumTtsProvider(track(), online, { ...utteranceOptions, voiceTimeoutMs: 20, pollMs: 10 });
  assert.equal(await cloud.speak('Hello.', { rate: 1, signal: new AbortController().signal }), 'failed');
  cloud.dispose();

  const empty = mockSynth({ voices: () => [] });
  const none = createChromiumTtsProvider(track(), empty, { ...utteranceOptions, voiceTimeoutMs: 20, pollMs: 10 });
  assert.equal(await none.speak('Hola.', { rate: 1, signal: new AbortController().signal }), 'failed');
  assert.equal(none.state(), 'idle');
  none.dispose();
});

test('voice enumeration timeout leaves playback idle', async () => {
  const phases: string[] = [];
  const synthesis = mockSynth({ voices: () => [] });
  const provider = createChromiumTtsProvider(
    {
      onState() {},
      onSpeaking() {},
      onVoices(_voices, picked, phase) {
        phases.push(`${phase}:${picked ? 'yes' : 'no'}`);
      },
    },
    synthesis,
    { ...utteranceOptions, voiceTimeoutMs: 25, pollMs: 10 },
  );
  provider.start();
  const ready = await provider.voiceReady();
  assert.equal(ready, null);
  assert.equal(phases.includes('settled:no'), true);
  assert.equal(provider.state(), 'idle');
  provider.dispose();
});

test('cancellation before speech starts does not leave a speaking state', async () => {
  let spoke = false;
  const synthesis = mockSynth({
    voices: () => [],
    onSpeak() {
      spoke = true;
    },
  });
  const provider = createChromiumTtsProvider(track(), synthesis, { ...utteranceOptions, voiceTimeoutMs: 2_000, pollMs: 500 });
  const run = provider.speak('Hola.', { rate: 1, signal: new AbortController().signal });
  provider.stop();
  assert.equal(await run, 'cancelled');
  assert.equal(spoke, false);
  assert.equal(provider.state(), 'idle');
  provider.dispose();
});

test('speech start failure and a later speech error both return to idle', async () => {
  const startFail = mockSynth({
    voices: () => [pablo] as unknown as SpeechSynthesisVoice[],
    onSpeak(utter) {
      utter.onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);
    },
  });
  const failed = createChromiumTtsProvider(track(), startFail, utteranceOptions);
  assert.equal(await failed.speak('Hola.', { rate: 1, signal: new AbortController().signal }), 'failed');
  assert.equal(failed.state(), 'idle');
  failed.dispose();

  const later = mockSynth({
    voices: () => [pablo] as unknown as SpeechSynthesisVoice[],
    onSpeak(utter) {
      queueMicrotask(() => {
        utter.onstart?.(new Event('start') as SpeechSynthesisEvent);
        utter.onerror?.({ error: 'audio-busy' } as SpeechSynthesisErrorEvent);
      });
    },
  });
  const errored = createChromiumTtsProvider(track(), later, utteranceOptions);
  assert.equal(await errored.speak('Hola.', { rate: 1, signal: new AbortController().signal }), 'failed');
  assert.equal(errored.state(), 'idle');
  errored.dispose();
});
