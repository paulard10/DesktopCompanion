/** Fixed demo replies. The reply function is passed in, so this file imports nothing. */

/** Long enough for one painted Thinking pose, and shorter than a wake. */
export const DEMO_THINK_MS = 720;
/** Keeps Replying on screen after the text appears, before Happy. */
export const DEMO_REPLY_MS = 480;
/** A caller cannot stretch the demo past this. Qwen is not paced here. */
export const DEMO_PACE_CAP_MS = 1_200;

export function boundDemoPace(ms: number | undefined, fallback: number): number {
  const value = ms === undefined ? fallback : ms;
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(value, DEMO_PACE_CAP_MS);
}

export function createDemoProvider(
  reply: (text: string) => { text: string; gesture: 'greet' | 'nod' | 'explain' },
  text: string,
  pace?: { thinkMs?: number; replyMs?: number },
): {
  id: 'demo';
  gesture: 'greet' | 'nod' | 'explain';
  send(messages: unknown, signal?: AbortSignal): AsyncIterable<{ type: 'delta'; text: string } | { type: 'done' }>;
} {
  const result = reply(text);
  const thinkMs = boundDemoPace(pace?.thinkMs, DEMO_THINK_MS);
  const replyMs = boundDemoPace(pace?.replyMs, DEMO_REPLY_MS);
  return {
    id: 'demo',
    gesture: result.gesture,
    async *send(_messages: unknown, signal?: AbortSignal) {
      await pause(thinkMs, signal);
      yield { type: 'delta', text: result.text };
      await pause(replyMs, signal);
      yield { type: 'done' };
    },
  };
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
