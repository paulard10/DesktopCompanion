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
  speak(text: string, options: { rate: number; signal: AbortSignal; lang?: 'es' | 'en' }): Promise<'done' | 'cancelled' | 'failed'>;
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

export type SpeechLanguage = 'es' | 'en' | 'auto';

export function speechLanguage(value: unknown): SpeechLanguage {
  return value === 'en' || value === 'es' || value === 'auto' ? value : 'es';
}

const SPANISH_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'hola', 'gracias', 'por', 'para', 'con', 'es', 'está', 'como', 'qué', 'dónde']);
const ENGLISH_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'and', 'to', 'of', 'hello', 'thanks', 'please', 'what', 'how', 'you', 'i', 'where', 'can']);

/** A short guess used only to choose a local voice. A tie keeps the fallback. */
export function guessSpeechLang(text: string, fallback: 'es' | 'en' = 'es'): 'es' | 'en' {
  const words = text.toLowerCase().match(/[a-záéíóúüñ]+/g) ?? [];
  let spanish = 0;
  let english = 0;
  for (const word of words) {
    if (SPANISH_WORDS.has(word)) spanish += 1;
    if (ENGLISH_WORDS.has(word)) english += 1;
  }
  if (/[áéíóúñ¿¡]/i.test(text)) spanish += 2;
  if (spanish > english) return 'es';
  if (english > spanish) return 'en';
  return fallback;
}

function localVoices(voices: readonly TtsVoiceDescriptor[]): TtsVoiceDescriptor[] {
  return voices.filter((voice) => voice.localService !== false);
}

/**
 * A voice installed on this PC. Spanish prefers Pablo, then Helena.
 * English prefers Zira, then David or Mark. Cloud voices are ignored.
 */
export function pickSpokenVoice(voices: readonly TtsVoiceDescriptor[], language: 'es' | 'en'): TtsVoiceDescriptor | null {
  const local = localVoices(voices);
  if (language === 'es') {
    return pickPabloVoice(local)
      ?? local.find((voice) => /helena/i.test(voice.name) && normalizeLang(voice.lang).startsWith('es'))
      ?? local.find((voice) => normalizeLang(voice.lang).startsWith('es'))
      ?? null;
  }
  return local.find((voice) => /zira/i.test(voice.name) && normalizeLang(voice.lang).startsWith('en'))
    ?? local.find((voice) => /\b(?:david|mark)\b/i.test(voice.name) && normalizeLang(voice.lang).startsWith('en'))
    ?? local.find((voice) => normalizeLang(voice.lang).startsWith('en'))
    ?? null;
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
