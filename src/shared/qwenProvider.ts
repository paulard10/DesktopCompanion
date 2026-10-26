/**
 * Model Studio streaming client.
 * Collaborators are passed in so this file imports nothing.
 * Tests and the main process both load it directly.
 */

export interface QwenTurnMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export type QwenEvent =
  | { type: 'open' }
  | { type: 'activity' }
  | { type: 'delta'; text: string }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      reasoningTokens: number | null;
      totalTokens: number | null;
    }
  | { type: 'done' }
  | {
      type: 'error';
      code: 'cancelled' | 'unavailable' | 'authentication' | 'rate-limit' | 'quota' | 'invalid' | 'malformed' | 'timeout';
    };

export interface QwenSsePiece {
  type: 'delta' | 'activity' | 'usage' | 'done' | 'malformed';
  text?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
}

export interface QwenSseParser {
  push(chunk: string): QwenSsePiece[];
  flush(): QwenSsePiece[];
}

export function createQwenProvider(options: {
  fetchImpl: typeof fetch;
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  completionsUrl: (endpoint: string) => string | null;
  classifyHttp: (status: number, body: string) => string;
  createParser: () => QwenSseParser;
}): {
  id: 'qwen';
  send(messages: readonly QwenTurnMessage[], signal: AbortSignal): AsyncIterable<QwenEvent>;
} {
  return {
    id: 'qwen',
    async *send(messages, signal) {
      const url = options.completionsUrl(options.endpoint);
      if (!url) {
        yield { type: 'error', code: 'invalid' };
        return;
      }
      let response: Response;
      try {
        response = await options.fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            messages: messages.map((message) => ({ role: message.role, content: message.text })),
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: options.maxTokens,
            enable_thinking: false,
          }),
        });
      } catch {
        yield { type: 'error', code: signal.aborted ? 'cancelled' : 'unavailable' };
        return;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        yield { type: 'error', code: httpCode(options.classifyHttp(response.status, body.slice(0, 4000))) };
        return;
      }
      yield { type: 'open' };
      if (!response.body) {
        yield { type: 'error', code: 'malformed' };
        return;
      }
      const parser = options.createParser();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const step = await reader.read();
          if (step.done) {
            break;
          }
          const stop = yield* emit(parser.push(decoder.decode(step.value, { stream: true })));
          if (stop) {
            return;
          }
        }
        const stop = yield* emit(parser.flush());
        if (!stop) {
          yield { type: 'done' };
        }
      } catch {
        yield { type: 'error', code: signal.aborted ? 'cancelled' : 'malformed' };
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function httpCode(
  code: string,
): 'authentication' | 'rate-limit' | 'quota' | 'invalid' | 'unavailable' | 'timeout' {
  if (
    code === 'authentication' ||
    code === 'rate-limit' ||
    code === 'quota' ||
    code === 'invalid' ||
    code === 'timeout'
  ) {
    return code;
  }
  return 'unavailable';
}

function* emit(pieces: readonly QwenSsePiece[]): Generator<QwenEvent, boolean> {
  for (const piece of pieces) {
    if (piece.type === 'delta' && piece.text) {
      yield { type: 'delta', text: piece.text };
    } else if (piece.type === 'activity') {
      yield { type: 'activity' };
    } else if (
      piece.type === 'usage' &&
      typeof piece.promptTokens === 'number' &&
      typeof piece.completionTokens === 'number'
    ) {
      yield {
        type: 'usage',
        promptTokens: piece.promptTokens,
        completionTokens: piece.completionTokens,
        reasoningTokens: typeof piece.reasoningTokens === 'number' ? piece.reasoningTokens : null,
        totalTokens: typeof piece.totalTokens === 'number' ? piece.totalTokens : null,
      };
    } else if (piece.type === 'done') {
      yield { type: 'done' };
      return true;
    } else if (piece.type === 'malformed') {
      yield { type: 'error', code: 'malformed' };
      return true;
    }
  }
  return false;
}
