/** Provider event stream. Imports nothing. */

export interface ModelTurnMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export type ProviderEvent =
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
      code:
        | 'cancelled'
        | 'unavailable'
        | 'authentication'
        | 'rate-limit'
        | 'quota'
        | 'invalid'
        | 'malformed';
    };

export interface AIProvider {
  readonly id: 'demo' | 'qwen';
  send(messages: readonly ModelTurnMessage[], signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
