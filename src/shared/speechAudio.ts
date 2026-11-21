export const MAX_RECORDING_SECONDS = 20;
export const SPEECH_RATE = 16_000;
export const MAX_WAV_BYTES = 44 + SPEECH_RATE * MAX_RECORDING_SECONDS * 2;

/** The renderer records at 16 kHz; the main process independently validates this format. */
export function pcmWav(chunks: readonly Float32Array[], sampleCount: number): Uint8Array {
  if (!Number.isInteger(sampleCount) || sampleCount <= 0 ||
      sampleCount > SPEECH_RATE * MAX_RECORDING_SECONDS) {
    throw new Error('Recording timeout or empty audio.');
  }
  const wav = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(wav.buffer);
  const ascii = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i++) wav[at + i] = value.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, wav.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_RATE, true);
  view.setUint32(28, SPEECH_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  let index = 0;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      if (index >= sampleCount) break;
      const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
      view.setInt16(44 + index * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
      index++;
    }
  }
  if (index !== sampleCount) throw new Error('Incomplete audio.');
  return wav;
}

export function validSpeechWav(value: unknown): value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 46 ||
      value.byteLength > MAX_WAV_BYTES) return false;
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const ascii = (at: number, text: string): boolean =>
    [...text].every((character, index) => value[at + index] === character.charCodeAt(0));
  return ascii(0, 'RIFF') && ascii(8, 'WAVE') && ascii(12, 'fmt ') && ascii(36, 'data') &&
    view.getUint32(4, true) === value.byteLength - 8 &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === SPEECH_RATE &&
    view.getUint32(28, true) === SPEECH_RATE * 2 &&
    view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 &&
    view.getUint32(40, true) === value.byteLength - 44 &&
    (value.byteLength - 44) % 2 === 0;
}

/** Preserve an edited or pre-existing draft; staging is an explicit user decision. */
export function transcriptPlacement(before: string, now: string): 'insert' | 'stage' {
  return before === '' && now === before ? 'insert' : 'stage';
}

/** Quiet stretch that ends one utterance. Whisper stays idle until then. */
export const ENDPOINT_SILENCE_MS = 900;
/** Ignore a short noise spike before treating the microphone as speech. */
export const ENDPOINT_MIN_SPEECH_MS = 280;
const ENDPOINT_START_RMS = 0.02;
const ENDPOINT_CONTINUE_RMS = 0.012;

export function speechRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

export interface SpeechEndpoint {
  heardMs: number;
  silenceMs: number;
}

/** Lightweight level gate. It does not transcribe and it does not keep audio. */
export function noteSpeechEndpoint(
  state: SpeechEndpoint,
  level: number,
  frameMs: number,
): SpeechEndpoint & { ended: boolean } {
  const duration = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : 0;
  const loud = Number.isFinite(level) ? level : 0;
  const voiced = state.heardMs > 0 ? loud >= ENDPOINT_CONTINUE_RMS : loud >= ENDPOINT_START_RMS;
  if (voiced) {
    return { heardMs: state.heardMs + duration, silenceMs: 0, ended: false };
  }
  if (state.heardMs < ENDPOINT_MIN_SPEECH_MS) {
    return { heardMs: 0, silenceMs: 0, ended: false };
  }
  const silenceMs = state.silenceMs + duration;
  return { heardMs: state.heardMs, silenceMs, ended: silenceMs >= ENDPOINT_SILENCE_MS };
}
