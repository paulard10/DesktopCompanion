/** Context and output limits for one Qwen conversation. Imports nothing. */

import type { ChatLine } from './demoConversation.js';

export const SYSTEM_PROMPT =
  'You are a friendly desktop companion. Answer in the language the user writes, Spanish or English. Keep replies short. You can talk, and that is all. You cannot see the screen, read files, inspect Cursor, use the terminal, or control Windows. If you are asked to do those things, say that you cannot. Do not invent tool results.';

export const MAX_CONTEXT_PAIRS = 6;
export const MAX_ASSISTANT_CHARS = 1600;
export const MAX_OUTPUT_TOKENS = 256;
export const CONNECT_MS = 15_000;
export const FIRST_VISIBLE_MS = 20_000;
export const GENERATION_MS = 45_000;

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export function modelMessages(history: readonly ChatLine[]): ModelMessage[] {
  const spoken: ModelMessage[] = [];
  for (const line of history) {
    if (line.role === 'user') {
      spoken.push({ role: 'user', text: line.text });
    } else if (line.role === 'assistant') {
      spoken.push({ role: 'assistant', text: line.text.slice(0, MAX_ASSISTANT_CHARS) });
    }
  }
  let users = 0;
  let start = spoken.length;
  for (let index = spoken.length - 1; index >= 0; index -= 1) {
    if (spoken[index]?.role === 'user') {
      users += 1;
      if (users > MAX_CONTEXT_PAIRS) {
        break;
      }
    }
    start = index;
  }
  const selected = spoken.slice(start);
  while (selected[0]?.role === 'assistant') {
    selected.shift();
  }
  return [{ role: 'system', text: SYSTEM_PROMPT }, ...selected];
}
