/** TTS policy and voice matching. Imports nothing. */

export const MAX_TTS_CHARS = 1600;
export const MAX_TTS_CHUNK_CHARS = 420;
export const MIN_TTS_RATE = 0.75;
export const MAX_TTS_RATE = 1.25;
export const DEFAULT_TTS_RATE = 1;
export const PABLO_LOCALE = 'es-ES';

/** Chromium voice name from the M1.8B.0 pilot on this product target. */
export const PABLO_VOICE_NAME = 'Microsoft Pablo - Spanish (Spain)';

export type TtsPlaybackState = 'idle' | 'speaking';

export interface TtsVoiceDescriptor {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
}

export interface TextToSpeechProvider {
  state(): TtsPlaybackState;
  speak(text: string, options: { rate: number; signal: AbortSignal }): Promise<'done' | 'cancelled' | 'failed'>;
  stop(): void;
  dispose(): void;
}

export function normalizeLang(lang: string): string {
  return lang.trim().toLowerCase().replace('_', '-');
}

/**
 * Microsoft Pablo (es-ES) only.
 * Matches the Chromium display name or the OneCore token `MSTTS_V110_esES_PabloM`.
 * Does not accept Helena, Laura, another locale, or a cloud voice.
 */
export function isPabloVoice(
  voice: Pick<TtsVoiceDescriptor, 'name' | 'lang'> & Partial<Pick<TtsVoiceDescriptor, 'voiceURI' | 'localService'>>,
): boolean {
  if (voice.localService === false) {
    return false;
  }
  const name = voice.name ?? '';
  const uri = voice.voiceURI ?? '';
  const haystack = `${name} ${uri}`;
  if (/\b(?:helena|laura|zira)\b/i.test(name)) {
    return false;
  }
  const named = /\bpablo\b/i.test(name) || /\bpablo\b/i.test(uri);
  const token = /esES_Pablo|PabloM/i.test(haystack);
  if (!named && !token) {
    return false;
  }
  const lang = normalizeLang(voice.lang ?? '');
  if (lang === normalizeLang(PABLO_LOCALE)) {
    return true;
  }
  if (lang.length > 0) {
    return false;
  }
  return /es[-_]?es/i.test(haystack) || /spanish \(spain\)/i.test(haystack) || token;
}

export function pickPabloVoice(voices: readonly TtsVoiceDescriptor[]): TtsVoiceDescriptor | null {
  const matches = voices.filter((voice) => isPabloVoice(voice));
  return matches.find((voice) => voice.name === PABLO_VOICE_NAME) ?? matches[0] ?? null;
}

export function sanitizeSpeechText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TTS_CHARS) {
    return '';
  }
  return trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
}

/** Sequential chunks for long assistant replies. */
export function splitSpeechText(text: string): string[] {
  if (text.length <= MAX_TTS_CHUNK_CHARS) {
    return [text];
  }
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX_TTS_CHUNK_CHARS) {
    let cut = rest.lastIndexOf('. ', MAX_TTS_CHUNK_CHARS);
    if (cut < MAX_TTS_CHUNK_CHARS * 0.4) {
      cut = rest.lastIndexOf(' ', MAX_TTS_CHUNK_CHARS);
    }
    if (cut < 1) {
      cut = MAX_TTS_CHUNK_CHARS;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) {
    chunks.push(rest);
  }
  return chunks.filter((part) => part.length > 0);
}

export function clampSpeechRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return DEFAULT_TTS_RATE;
  }
  return Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, rate));
}
