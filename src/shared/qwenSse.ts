/** OpenAI-compatible SSE parser. Imports nothing. */

export type SsePiece =
  | { type: 'delta'; text: string }
  | { type: 'activity' }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      reasoningTokens: number | null;
      totalTokens: number | null;
    }
  | { type: 'done' }
  | { type: 'malformed' };

export interface SseParser {
  push(chunk: string): SsePiece[];
  flush(): SsePiece[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  const consume = (ending: boolean): SsePiece[] => {
    const pieces: SsePiece[] = [];
    while (true) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) {
        break;
      }
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      pieces.push(...readDataLine(line));
    }
    if (ending && buffer.trim() !== '') {
      pieces.push(...readDataLine(buffer));
      buffer = '';
    }
    return pieces;
  };
  return {
    push(chunk: string): SsePiece[] {
      buffer += chunk;
      return consume(false);
    },
    flush(): SsePiece[] {
      return consume(true);
    },
  };
}

function readDataLine(line: string): SsePiece[] {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith(':')) {
    return [];
  }
  if (!trimmed.startsWith('data:')) {
    return [{ type: 'malformed' }];
  }
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') {
    return [{ type: 'done' }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [{ type: 'malformed' }];
  }
  if (!parsed || typeof parsed !== 'object') {
    return [{ type: 'malformed' }];
  }
  const record = parsed as Record<string, unknown>;
  if ('error' in record) {
    return [{ type: 'malformed' }];
  }
  const pieces: SsePiece[] = [];
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === 'object') {
      const delta = (first as Record<string, unknown>).delta;
      if (delta && typeof delta === 'object') {
        const content = (delta as Record<string, unknown>).content;
        const reasoning = (delta as Record<string, unknown>).reasoning_content;
        if (typeof content === 'string' && content.length > 0) {
          pieces.push({ type: 'delta', text: content });
        } else if (typeof reasoning === 'string' && reasoning.length > 0) {
          pieces.push({ type: 'activity' });
        }
      }
    }
  }
  const usage = readUsage(record.usage);
  if (usage) {
    pieces.push(usage);
  }
  return pieces;
}

function readUsage(value: unknown): SsePiece | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const usage = value as Record<string, unknown>;
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  if (typeof prompt !== 'number' || typeof completion !== 'number' || prompt < 0 || completion < 0) {
    return null;
  }
  const total = usage.total_tokens;
  const details = usage.completion_tokens_details;
  let reasoningTokens: number | null = null;
  if (details && typeof details === 'object') {
    const reasoning = (details as Record<string, unknown>).reasoning_tokens;
    if (typeof reasoning === 'number' && reasoning >= 0) {
      reasoningTokens = Math.floor(reasoning);
    }
  }
  return {
    type: 'usage',
    promptTokens: Math.floor(prompt),
    completionTokens: Math.floor(completion),
    reasoningTokens,
    totalTokens: typeof total === 'number' && total >= 0 ? Math.floor(total) : null,
  };
}
