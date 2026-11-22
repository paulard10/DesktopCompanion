/** Conversation session. Imports nothing. Callers pass Demo, Qwen, and storage. */

export interface SessionLine {
  role: 'user' | 'demo' | 'assistant';
  text: string;
  /** One confirmed copied-text question. Later turns omit it from the model. */
  context?: boolean;
}

export interface SessionMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

export type SessionPresence = 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'HAPPY' | 'ERROR' | 'IDLE';

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export interface PublicStatus {
  provider: 'demo' | 'qwen';
  model: 'qwen3.7-plus';
  key: 'saved' | 'missing' | 'unavailable';
  endpoint: 'saved' | 'missing';
  busy: boolean;
  presence: SessionPresence | 'CLEAR';
  notice: string | null;
  usage: SessionUsage | null;
  endpointPreview: string | null;
}

export interface SessionVault {
  available(): boolean;
  save(secret: string): Promise<'saved' | 'unavailable' | 'rejected'>;
  present(): boolean;
  load(): Promise<string | null>;
  clear(): void;
}

export interface SessionSettings {
  current(): { provider: 'demo' | 'qwen'; endpoint: string | null };
  update(next: { provider: 'demo' | 'qwen'; endpoint: string | null }): void;
}

export interface TurnProvider {
  send(messages: readonly SessionMessage[], signal: AbortSignal): AsyncIterable<TurnEvent>;
}

export type TurnEvent =
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
  | { type: 'error'; code: string };

export interface SessionHooks {
  history(lines: readonly SessionLine[]): void;
  delta(text: string): void;
  status(status: PublicStatus): void;
  gesture(gesture: 'greet' | 'nod' | 'explain'): void;
  presence(presence: SessionPresence | 'CLEAR'): void;
}

const HAPPY_MS = 1_600;
const ERROR_MS = 2_400;

const OUTPUT_CAP = 1600;

export function createConversationSession(options: {
  vault: SessionVault;
  settings: SessionSettings;
  hooks: SessionHooks;
  createDemo: (text: string) => TurnProvider & { gesture: 'greet' | 'nod' | 'explain' };
  modelMessages: (history: readonly SessionLine[]) => SessionMessage[];
  createQwen: (input: { endpoint: string; apiKey: string }) => TurnProvider;
  validateEndpoint: (raw: string) => { ok: true; baseUrl: string } | { ok: false };
  validateKey: (raw: string) => boolean;
  failureMessage: (code: string) => string;
  connectMs?: number;
  firstTokenMs?: number;
  overallMs?: number;
  maxLines?: number;
  happyMs?: number;
  errorMs?: number;
}): {
  history(): readonly SessionLine[];
  status(): PublicStatus;
  send(text: string, delivery?: { context?: boolean }): Promise<void>;
  stop(): void;
  reset(): void;
  setProvider(provider: string): 'saved' | 'rejected';
  setEndpoint(raw: string): 'saved' | 'rejected';
  saveKey(raw: string): Promise<'saved' | 'unavailable' | 'rejected'>;
  removeKey(): void;
} {
  const connectMs = options.connectMs ?? 15_000;
  const firstTokenMs = options.firstTokenMs ?? 20_000;
  const overallMs = options.overallMs ?? 45_000;
  const maxLines = options.maxLines ?? 40;
  const happyMs = options.happyMs ?? HAPPY_MS;
  const errorMs = options.errorMs ?? ERROR_MS;
  let history: SessionLine[] = [];
  let busy = false;
  let notice: string | null = null;
  let usage: SessionUsage | null = null;
  let presence: SessionPresence | 'CLEAR' = 'CLEAR';
  let abort: AbortController | null = null;
  let turn = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const stopState: { reason: 'user' | 'connection-timeout' | 'timeout' | null } = { reason: null };
  const cancelSettle = (): void => {
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer);
      settleTimer = undefined;
    }
  };
  const showBriefly = (next: 'HAPPY' | 'ERROR'): void => {
    cancelSettle();
    presence = next;
    const wait = next === 'HAPPY' ? happyMs : errorMs;
    if (wait <= 0) {
      presence = 'IDLE';
      return;
    }
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      if (presence !== next) {
        return;
      }
      presence = 'IDLE';
      options.hooks.status(status());
      options.hooks.presence('IDLE');
    }, wait);
    if (typeof settleTimer === 'object' && settleTimer && 'unref' in settleTimer) {
      settleTimer.unref();
    }
  };

  const publish = (): void => {
    options.hooks.history(history);
    options.hooks.status(status());
    options.hooks.presence(presence);
  };

  const status = (): PublicStatus => {
    const current = options.settings.current();
    const encryption = options.vault.available();
    return {
      provider: current.provider,
      model: 'qwen3.7-plus',
      key: !encryption ? 'unavailable' : options.vault.present() ? 'saved' : 'missing',
      endpoint: current.endpoint ? 'saved' : 'missing',
      busy,
      presence,
      notice,
      usage,
      endpointPreview: current.endpoint,
    };
  };

  const fail = (code: string, nextPresence: SessionPresence | 'CLEAR'): void => {
    notice = options.failureMessage(code);
    presence = nextPresence;
    publish();
  };

  return {
    history: () => history,
    status,
    setProvider(provider: string): 'saved' | 'rejected' {
      if (busy || (provider !== 'demo' && provider !== 'qwen')) {
        options.hooks.status(status());
        return 'rejected';
      }
      const current = options.settings.current();
      options.settings.update({ provider, endpoint: current.endpoint });
      notice = null;
      presence = 'CLEAR';
      publish();
      return 'saved';
    },
    setEndpoint(raw: string): 'saved' | 'rejected' {
      if (busy) {
        options.hooks.status(status());
        return 'rejected';
      }
      const parsed = options.validateEndpoint(raw);
      if (!parsed.ok) {
        fail('missing-endpoint', 'ERROR');
        return 'rejected';
      }
      const current = options.settings.current();
      options.settings.update({ provider: current.provider, endpoint: parsed.baseUrl });
      notice = null;
      publish();
      return 'saved';
    },
    async saveKey(raw: string): Promise<'saved' | 'unavailable' | 'rejected'> {
      if (busy) {
        options.hooks.status(status());
        return 'rejected';
      }
      if (!options.validateKey(raw)) {
        fail('rejected', 'ERROR');
        return 'rejected';
      }
      const saved = await options.vault.save(raw);
      if (saved !== 'saved') {
        fail(saved === 'unavailable' ? 'encryption-unavailable' : 'rejected', 'ERROR');
        return saved;
      }
      notice = null;
      publish();
      return 'saved';
    },
    removeKey(): void {
      options.vault.clear();
      if (busy) {
        return;
      }
      notice = null;
      publish();
    },
    stop(): void {
      stopState.reason = 'user';
      cancelSettle();
      abort?.abort();
      if (!busy && presence !== 'IDLE' && presence !== 'CLEAR') {
        presence = 'IDLE';
        publish();
      }
    },
    async send(text: string, delivery?: { context?: boolean }): Promise<void> {
      const context = delivery?.context === true;
      const cap = context ? 4_800 : 500;
      const trimmed = text.trim();
      if (trimmed.length === 0 || trimmed.length > cap) {
        return;
      }
      if (busy) {
        options.hooks.status({ ...status(), notice: options.failureMessage('busy') });
        return;
      }
      const mine = (turn += 1);
      cancelSettle();
      const current = options.settings.current();
      let provider: TurnProvider;
      if (current.provider === 'qwen') {
        if (!options.vault.available()) {
          fail('encryption-unavailable', 'ERROR');
          return;
        }
        if (!current.endpoint) {
          fail('missing-endpoint', 'ERROR');
          return;
        }
        const apiKey = await options.vault.load();
        if (mine !== turn) {
          return;
        }
        if (!apiKey) {
          fail('missing-key', 'ERROR');
          return;
        }
        provider = options.createQwen({ endpoint: current.endpoint, apiKey });
      } else {
        const demo = options.createDemo(trimmed);
        provider = demo;
        options.hooks.gesture(demo.gesture);
      }
      if (mine !== turn) {
        return;
      }

      busy = true;
      notice = null;
      usage = null;
      stopState.reason = null;
      const userLine: SessionLine = context ? { role: 'user', text: trimmed, context: true } : { role: 'user', text: trimmed };
      history = [...history, userLine].slice(-maxLines);
      presence = 'THINKING';
      publish();
      if (mine !== turn) {
        return;
      }

      const controller = new AbortController();
      abort = controller;
      let assistant = '';
      let phase: 'connecting' | 'waiting-text' | 'generating' = 'connecting';
      let phaseStarted = Date.now();
      const iterator = provider.send(options.modelMessages(history), controller.signal)[Symbol.asyncIterator]();
      const markTimeout = (): void => {
        if (readStop(stopState) === 'user') {
          return;
        }
        stopState.reason = phase === 'connecting' ? 'connection-timeout' : 'timeout';
      };
      try {
        while (true) {
          const limit = phase === 'connecting' ? connectMs : phase === 'waiting-text' ? firstTokenMs : overallMs;
          const elapsed = Date.now() - phaseStarted;
          if (elapsed >= limit) {
            markTimeout();
            controller.abort();
            break;
          }
          const remaining = limit - elapsed;
          const timer = delay(remaining);
          const pending = iterator.next().then(
            (result) => ({ kind: 'next' as const, result }),
            () => ({ kind: 'failed' as const }),
          );
          const raced = await Promise.race([pending, timer.promise.then(() => 'timeout' as const)]);
          timer.cancel();
          if (mine !== turn) {
            break;
          }
          if (raced === 'timeout') {
            markTimeout();
            controller.abort();
            break;
          }
          if (raced.kind === 'failed') {
            if (!notice) {
              notice = options.failureMessage(readStop(stopState) === 'user' ? 'cancelled' : 'unavailable');
              presence = readStop(stopState) === 'user' ? 'ATTENTIVE' : 'ERROR';
            }
            break;
          }
          const next = raced.result;
          if (next.done) {
            break;
          }
          const event = next.value;
          if (event.type === 'open') {
            if (phase === 'connecting') {
              phase = 'waiting-text';
              phaseStarted = Date.now();
            }
          } else if (event.type === 'activity') {
            continue;
          } else if (event.type === 'delta') {
            if (phase !== 'generating') {
              phase = 'generating';
              phaseStarted = Date.now();
              presence = 'RESPONDING';
            }
            assistant = (assistant + event.text).slice(0, OUTPUT_CAP);
            options.hooks.delta(assistant);
            options.hooks.status(status());
            options.hooks.presence(presence);
            if (assistant.length >= OUTPUT_CAP) {
              controller.abort();
              break;
            }
          } else if (event.type === 'usage') {
            usage = {
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              reasoningTokens: event.reasoningTokens,
              totalTokens: event.totalTokens,
            };
          } else if (event.type === 'error') {
            const code = readStop(stopState) === 'timeout' ? 'timeout' : readStop(stopState) === 'user' ? 'cancelled' : event.code;
            notice = options.failureMessage(code);
            presence = code === 'cancelled' ? 'ATTENTIVE' : 'ERROR';
            break;
          } else if (event.type === 'done') {
            break;
          }
        }
      } catch {
        if (mine === turn && !notice) {
          notice = options.failureMessage(readStop(stopState) === 'user' ? 'cancelled' : 'unavailable');
          presence = readStop(stopState) === 'user' ? 'ATTENTIVE' : 'ERROR';
        }
      } finally {
        void iterator.return?.().catch(() => undefined);
        abort = null;
        busy = false;
        if (mine !== turn) {
          return;
        }
        const reason = readStop(stopState);
        if (reason === 'user') {
          notice = options.failureMessage('cancelled');
          cancelSettle();
          presence = 'IDLE';
        } else if (reason === 'timeout' || reason === 'connection-timeout') {
          if (!notice) {
            notice = options.failureMessage(reason);
          }
          showBriefly('ERROR');
        } else if (notice) {
          showBriefly('ERROR');
        } else {
          showBriefly('HAPPY');
        }
        if (assistant.length > 0) {
          const replyRole: SessionLine['role'] = current.provider === 'demo' ? 'demo' : 'assistant';
          const replyLine: SessionLine = { role: replyRole, text: assistant };
          history = [...history, replyLine].slice(-maxLines);
        }
        publish();
      }
    },
    reset(): void {
      turn += 1;
      cancelSettle();
      stopState.reason = 'user';
      abort?.abort();
      abort = null;
      busy = false;
      history = [];
      notice = null;
      usage = null;
      presence = 'IDLE';
      publish();
    },
  };
}

function readStop(
  state: { reason: 'user' | 'connection-timeout' | 'timeout' | null },
): 'user' | 'connection-timeout' | 'timeout' | null {
  return state.reason;
}

function delay(ms: number): { promise: Promise<'timeout'>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return {
    promise,
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}
