import fs from 'node:fs';
import path from 'node:path';
import { clampSpeechRate, DEFAULT_TTS_RATE } from '../shared/textToSpeech.js';

export interface TtsSettings {
  enabled: boolean;
  autoRead: boolean;
  conversation: boolean;
  rate: number;
}

const DEFAULTS: TtsSettings = {
  enabled: true,
  autoRead: false,
  conversation: false,
  rate: DEFAULT_TTS_RATE,
};

export function createTtsSettings(filePath: string): {
  current(): TtsSettings;
  update(next: Partial<TtsSettings>): TtsSettings;
} {
  let state = readSettings(filePath);
  return {
    current: () => state,
    update(next: Partial<TtsSettings>): TtsSettings {
      state = sanitize({
        enabled: next.enabled ?? state.enabled,
        autoRead: next.autoRead ?? state.autoRead,
        conversation: next.conversation ?? state.conversation,
        rate: next.rate ?? state.rate,
      });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');
      return state;
    },
  };
}

function readSettings(filePath: string): TtsSettings {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULTS };
    }
    const record = parsed as Record<string, unknown>;
    return sanitize({
      enabled: record.enabled === true,
      autoRead: record.autoRead === true,
      conversation: record.conversation === true,
      rate: typeof record.rate === 'number' ? record.rate : DEFAULT_TTS_RATE,
    });
  } catch {
    return { ...DEFAULTS };
  }
}

function sanitize(input: TtsSettings): TtsSettings {
  return {
    enabled: input.enabled === true,
    autoRead: input.autoRead === true,
    conversation: input.conversation === true,
    rate: clampSpeechRate(input.rate),
  };
}
