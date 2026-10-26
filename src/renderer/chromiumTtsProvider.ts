import {
  clampSpeechRate,
  isPabloVoice,
  pickPabloVoice,
  sanitizeSpeechText,
  splitSpeechText,
  type TextToSpeechProvider,
  type TtsPlaybackState,
  type TtsVoiceDescriptor,
} from '../shared/textToSpeech.ts';

export type TtsOutcome = 'done' | 'cancelled' | 'failed';
export type TtsVoicePhase = 'pending' | 'settled';

export interface ChromiumTtsHooks {
  onState(state: TtsPlaybackState): void;
  onSpeaking(active: boolean): void;
  onVoices?(voices: readonly TtsVoiceDescriptor[], picked: TtsVoiceDescriptor | null, phase: TtsVoicePhase): void;
}

type SpeechSynth = Pick<
  SpeechSynthesis,
  'cancel' | 'speak' | 'getVoices' | 'paused' | 'speaking' | 'addEventListener' | 'removeEventListener'
>;

export interface ChromiumTtsOptions {
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  voiceTimeoutMs?: number;
  pollMs?: number;
}

function unrefTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
  const candidate = timer as { unref?: () => void };
  candidate.unref?.();
}

export function createChromiumTtsProvider(
  hooks: ChromiumTtsHooks,
  synthesis: SpeechSynth = speechSynthesis,
  options: ChromiumTtsOptions = {},
): TextToSpeechProvider & { voiceReady(): Promise<TtsVoiceDescriptor | null>; start(): void } {
  const createUtterance = options.createUtterance ?? ((text: string) => new SpeechSynthesisUtterance(text));
  const voiceTimeoutMs = options.voiceTimeoutMs ?? 8_000;
  const pollMs = options.pollMs ?? 200;
  let state: TtsPlaybackState = 'idle';
  let disposed = false;
  let abort: AbortController | null = null;
  let lastVoices: TtsVoiceDescriptor[] = [];
  let lastPicked: TtsVoiceDescriptor | null = null;
  let signature = '\u0000';
  let settled = false;
  let listening = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const waiters = new Set<(voice: TtsVoiceDescriptor | null) => void>();

  const setState = (next: TtsPlaybackState): void => {
    if (disposed || state === next) {
      return;
    }
    state = next;
    hooks.onState(next);
    hooks.onSpeaking(next === 'speaking');
  };

  const readVoices = (): TtsVoiceDescriptor[] => {
    try {
      return synthesis.getVoices().map((voice) => ({
        name: voice.name,
        lang: voice.lang,
        voiceURI: voice.voiceURI,
        localService: voice.localService,
      }));
    } catch {
      return [];
    }
  };

  const notifyWaiters = (voice: TtsVoiceDescriptor | null): void => {
    for (const waiter of [...waiters]) {
      waiter(voice);
    }
  };

  const publish = (): void => {
    if (disposed) {
      return;
    }
    const voices = readVoices();
    const picked = pickPabloVoice(voices);
    const nextSignature = voices.map((voice) => `${voice.name}\t${voice.lang}\t${voice.voiceURI}\t${voice.localService}`).join('\n');
    const changed = nextSignature !== signature;
    signature = nextSignature;
    lastVoices = voices;
    lastPicked = picked;
    if (changed) {
      hooks.onVoices?.(voices, picked, settled ? 'settled' : 'pending');
    }
    if (picked) {
      finishEnumeration();
      return;
    }
    if (settled) {
      notifyWaiters(null);
    }
  };

  const finishEnumeration = (): void => {
    if (settled) {
      notifyWaiters(lastPicked);
      return;
    }
    settled = true;
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    hooks.onVoices?.(lastVoices, lastPicked, 'settled');
    notifyWaiters(lastPicked);
  };

  const onVoicesChanged = (): void => {
    publish();
  };

  const ensureListening = (): void => {
    if (listening || disposed) {
      return;
    }
    listening = true;
    synthesis.addEventListener('voiceschanged', onVoicesChanged);
    poll = globalThis.setInterval(publish, pollMs);
    unrefTimer(poll);
    settleTimer = globalThis.setTimeout(finishEnumeration, voiceTimeoutMs);
    unrefTimer(settleTimer);
    publish();
  };

  const waitForPablo = (signal: AbortSignal): Promise<TtsVoiceDescriptor | null> => {
    ensureListening();
    if (signal.aborted) {
      return Promise.resolve(null);
    }
    if (lastPicked || settled) {
      return Promise.resolve(lastPicked);
    }
    return new Promise((resolve) => {
      let finished = false;
      const done = (voice: TtsVoiceDescriptor | null): void => {
        if (finished) {
          return;
        }
        finished = true;
        signal.removeEventListener('abort', onAbort);
        waiters.delete(done);
        resolve(signal.aborted ? null : voice);
      };
      const onAbort = (): void => {
        done(null);
      };
      waiters.add(done);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  const speakChunk = (text: string, voice: SpeechSynthesisVoice, rate: number, signal: AbortSignal): Promise<TtsOutcome> =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve('cancelled');
        return;
      }
      let finished = false;
      const finish = (outcome: TtsOutcome): void => {
        if (finished) {
          return;
        }
        finished = true;
        signal.removeEventListener('abort', onAbort);
        resolve(outcome);
      };
      let utter: SpeechSynthesisUtterance;
      try {
        utter = createUtterance(text);
      } catch {
        finish('failed');
        return;
      }
      utter.voice = voice;
      utter.lang = voice.lang || 'es-ES';
      utter.rate = rate;
      const onAbort = (): void => {
        synthesis.cancel();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      utter.onend = () => {
        finish(signal.aborted ? 'cancelled' : 'done');
      };
      utter.onerror = () => {
        finish(signal.aborted ? 'cancelled' : 'failed');
      };
      try {
        synthesis.speak(utter);
      } catch {
        finish('failed');
      }
    });

  return {
    state: () => state,
    start: ensureListening,
    voiceReady(): Promise<TtsVoiceDescriptor | null> {
      ensureListening();
      if (lastPicked || settled) {
        return Promise.resolve(lastPicked);
      }
      return waitForPablo(new AbortController().signal);
    },
    stop(): void {
      abort?.abort();
      abort = null;
      try {
        synthesis.cancel();
      } catch {
        // A missing speech engine must not leave the composer blocked.
      }
      setState('idle');
    },
    dispose(): void {
      disposed = true;
      this.stop();
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      synthesis.removeEventListener('voiceschanged', onVoicesChanged);
      notifyWaiters(null);
      waiters.clear();
    },
    async speak(text: string, speakOptions: { rate: number; signal: AbortSignal }): Promise<TtsOutcome> {
      if (disposed) {
        return 'cancelled';
      }
      const cleaned = sanitizeSpeechText(text);
      if (!cleaned) {
        return 'failed';
      }
      this.stop();
      if (disposed) {
        return 'cancelled';
      }
      const controller = new AbortController();
      abort = controller;
      const linked = (): void => {
        controller.abort();
      };
      speakOptions.signal.addEventListener('abort', linked, { once: true });
      let outcome: TtsOutcome = 'done';
      try {
        const voiceDesc = await waitForPablo(controller.signal);
        if (controller.signal.aborted || disposed) {
          outcome = 'cancelled';
          return outcome;
        }
        if (!voiceDesc) {
          outcome = 'failed';
          return outcome;
        }
        const voices = synthesis.getVoices();
        const voice =
          voices.find((entry) => entry.voiceURI === voiceDesc.voiceURI) ??
          voices.find((entry) =>
            isPabloVoice({
              name: entry.name,
              lang: entry.lang,
              voiceURI: entry.voiceURI,
              localService: entry.localService,
            }),
          ) ??
          null;
        if (!voice) {
          outcome = 'failed';
          return outcome;
        }
        setState('speaking');
        const rate = clampSpeechRate(speakOptions.rate);
        for (const chunk of splitSpeechText(cleaned)) {
          if (controller.signal.aborted) {
            outcome = 'cancelled';
            break;
          }
          const piece = await speakChunk(chunk, voice, rate, controller.signal);
          if (piece !== 'done') {
            outcome = piece;
            break;
          }
        }
      } finally {
        speakOptions.signal.removeEventListener('abort', linked);
        if (abort === controller) {
          abort = null;
        }
        try {
          synthesis.cancel();
        } catch {
          // ignore
        }
        setState('idle');
      }
      return outcome;
    },
  };
}
