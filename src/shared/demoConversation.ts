/**
 * Deterministic demo replies. The text is never evaluated, echoed, or treated
 * as an instruction. There is no network and no model.
 */

export const MAX_CHAT_CHARS = 500;
export const MAX_CHAT_LINES = 40;

export const DEMO_GREETING = "Hello! I'm awake and ready. AI features aren't connected yet.";
export const DEMO_CURSOR = "Cursor integration is planned, but isn't connected in this version.";
export const DEMO_FALLBACK =
  "This is a demonstration of the chat window. No AI is connected, so I can't read the screen, use Cursor, or run tasks.";

export type DemoGesture = 'greet' | 'nod' | 'explain';

export interface ChatLine {
  role: 'user' | 'demo' | 'assistant';
  text: string;
}

export type ChatAcceptance =
  | { ok: false; reason: 'empty' | 'too-long' }
  | { ok: true; history: ChatLine[]; reply: string; gesture: DemoGesture };

export function validateChatText(raw: string): { ok: true; text: string } | { ok: false; reason: 'empty' | 'too-long' } {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (text.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (text.length > MAX_CHAT_CHARS) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, text };
}

export function acceptUserMessage(history: readonly ChatLine[], raw: string): ChatAcceptance {
  const validated = validateChatText(raw);
  if (!validated.ok) {
    return validated;
  }
  const reply = demoReply(validated.text);
  const next: ChatLine[] = [
    ...history,
    { role: 'user', text: validated.text },
    { role: 'demo', text: reply.text },
  ];
  return {
    ok: true,
    history: next.slice(-MAX_CHAT_LINES),
    reply: reply.text,
    gesture: reply.gesture,
  };
}

export function demoReply(text: string): { text: string; gesture: DemoGesture } {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === 'hello' || normalized === 'hi' || normalized === 'hey') {
    return { text: DEMO_GREETING, gesture: 'greet' };
  }
  const words = normalized.split(' ');
  if (words.includes('cursor')) {
    return { text: DEMO_CURSOR, gesture: 'explain' };
  }
  return { text: DEMO_FALLBACK, gesture: 'nod' };
}
