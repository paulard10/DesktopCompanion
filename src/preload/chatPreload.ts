import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const READY_CHANNEL = 'chat:ready';
const SEND_CHANNEL = 'chat:send';
const STOP_CHANNEL = 'chat:stop';
const SAVE_KEY_CHANNEL = 'chat:save-key';
const REMOVE_KEY_CHANNEL = 'chat:remove-key';
const SET_PROVIDER_CHANNEL = 'chat:set-provider';
const SET_ENDPOINT_CHANNEL = 'chat:set-endpoint';
const RESET_CHANNEL = 'chat:reset';
const PREVIEW_CHANNEL = 'chat:preview-presence';
const MOVE_TEST_CHANNEL = 'chat:move-test';
const CLOSE_CHANNEL = 'chat:close';
const MINIMIZE_CHANNEL = 'chat:minimize';
const ACTIVITY_CHANNEL = 'chat:activity';
const CONVERSATION_CHANNEL = 'chat:conversation';
const HISTORY_CHANNEL = 'chat:history';
const FOCUS_CHANNEL = 'chat:focus';
const DELTA_CHANNEL = 'chat:delta';
const STATUS_CHANNEL = 'chat:status';
const SPEECH_ARM = 'speech:arm';
const SPEECH_DISARM = 'speech:disarm';
const SPEECH_TRANSCRIBE = 'speech:transcribe';
const SPEECH_CANCEL = 'speech:cancel';
const SPEECH_FORCE_STOP = 'speech:force-stop';
const TTS_PRESENCE = 'chat:tts-presence';
const VOICE_PRESENCE = 'chat:voice-presence';
const TTS_FORCE_STOP = 'chat:tts-force-stop';
const TTS_GET_SETTINGS = 'chat:tts-get-settings';
const TTS_SET_SETTINGS = 'chat:tts-set-settings';
const TTS_SETTINGS = 'chat:tts-settings';
const TTS_DIAG = 'chat:tts-diag';
const SEND_GATE = 'chat:send-gate';
const MAX_CHAT_CHARS = 500;
const MAX_ASSISTANT_CHARS = 1600;
const MAX_CHAT_LINES = 40;

contextBridge.exposeInMainWorld('chat', {
  notifyReady(): void {
    ipcRenderer.send(READY_CHANNEL);
  },
  sendMessage(text: string): void {
    if (typeof text !== 'string' || text.length > MAX_CHAT_CHARS + 8) {
      return;
    }
    ipcRenderer.send(SEND_CHANNEL, text);
  },
  stopGeneration(): void {
    ipcRenderer.send(STOP_CHANNEL);
  },
  saveKey(key: string): void {
    if (typeof key !== 'string' || key.length > 300) {
      return;
    }
    ipcRenderer.send(SAVE_KEY_CHANNEL, key);
  },
  removeKey(): void {
    ipcRenderer.send(REMOVE_KEY_CHANNEL);
  },
  setProvider(provider: 'demo' | 'qwen'): void {
    if (provider !== 'demo' && provider !== 'qwen') {
      return;
    }
    ipcRenderer.send(SET_PROVIDER_CHANNEL, provider);
  },
  setEndpoint(endpoint: string): void {
    if (typeof endpoint !== 'string' || endpoint.length > 300) {
      return;
    }
    ipcRenderer.send(SET_ENDPOINT_CHANNEL, endpoint);
  },
  resetConversation(): void {
    ipcRenderer.send(RESET_CHANNEL);
  },
  previewPresence(
    presence:
      | 'ATTENTIVE'
      | 'THINKING'
      | 'RESPONDING'
      | 'SPEAKING'
      | 'HAPPY'
      | 'ERROR'
      | 'IDLE'
      | 'CURIOUS'
      | 'SLEEPING'
      | 'BLINK'
      | 'WAKING'
      | 'PROBE_LEFT'
      | 'PROBE_RIGHT'
      | 'PROBE_ANTENNA'
      | 'PROBE_BODY'
      | 'PROBE_RESET',
  ): void {
    if (
      presence !== 'ATTENTIVE' &&
      presence !== 'THINKING' &&
      presence !== 'RESPONDING' &&
      presence !== 'SPEAKING' &&
      presence !== 'HAPPY' &&
      presence !== 'ERROR' &&
      presence !== 'IDLE' &&
      presence !== 'CURIOUS' &&
      presence !== 'SLEEPING' &&
      presence !== 'BLINK' &&
      presence !== 'WAKING' &&
      presence !== 'PROBE_LEFT' &&
      presence !== 'PROBE_RIGHT' &&
      presence !== 'PROBE_ANTENNA' &&
      presence !== 'PROBE_BODY' &&
      presence !== 'PROBE_RESET'
    ) {
      return;
    }
    ipcRenderer.send(PREVIEW_CHANNEL, presence);
  },
  async testWindowMove(): Promise<{ received: boolean; block: 'chat' | 'voice' | 'busy' | 'none'; message: string }> {
    const result: unknown = await ipcRenderer.invoke(MOVE_TEST_CHANNEL);
    if (!result || typeof result !== 'object') {
      return { received: false, block: 'none', message: 'Move test was not received.' };
    }
    const record = result as { received?: unknown; block?: unknown; message?: unknown };
    const block = record.block === 'chat' || record.block === 'voice' || record.block === 'busy' ? record.block : 'none';
    return {
      received: record.received === true,
      block,
      message: typeof record.message === 'string' ? record.message : 'Move test was not received.',
    };
  },
  closeChat(): void {
    ipcRenderer.send(CLOSE_CHANNEL);
  },
  minimizeChat(): void {
    ipcRenderer.send(MINIMIZE_CHANNEL);
  },
  notifyActivity(): void {
    ipcRenderer.send(ACTIVITY_CHANNEL);
  },
  notifyConversation(active: boolean): void {
    ipcRenderer.send(CONVERSATION_CHANNEL, active === true);
  },
  async armMicrophone(): Promise<boolean> {
    return (await ipcRenderer.invoke(SPEECH_ARM)) === true;
  },
  disarmMicrophone(): void {
    ipcRenderer.send(SPEECH_DISARM);
  },
  async transcribeAudio(wav: Uint8Array, language?: 'es' | 'en' | 'auto'): Promise<{ text?: string; error?: string }> {
    if (!(wav instanceof Uint8Array) || wav.byteLength > 640_044 || wav.byteLength < 46) {
      return { error: 'Unsupported audio.' };
    }
    const chosen = language === 'en' || language === 'auto' ? language : 'es';
    return ipcRenderer.invoke(SPEECH_TRANSCRIBE, wav, chosen);
  },
  cancelTranscription(): void {
    ipcRenderer.send(SPEECH_CANCEL);
  },
  onSpeechForceStop(listener: () => void): () => void {
    return listen(SPEECH_FORCE_STOP, () => listener());
  },
  notifyTtsSpeaking(active: boolean): void {
    ipcRenderer.send(TTS_PRESENCE, active === true);
  },
  notifyVoicePresence(pose: 'ATTENTIVE' | 'THINKING' | 'IDLE' | 'ERROR' | 'CLEAR'): void {
    if (pose !== 'ATTENTIVE' && pose !== 'THINKING' && pose !== 'IDLE' && pose !== 'ERROR' && pose !== 'CLEAR') {
      return;
    }
    ipcRenderer.send(VOICE_PRESENCE, pose);
  },
  reportTtsVoices(report: {
    count: number;
    pablo: boolean;
    phase: 'pending' | 'settled';
    voices: readonly { name: string; lang: string; voiceURI: string; localService: boolean }[];
  }): void {
    const safe = readTtsVoiceReport(report);
    if (safe) {
      ipcRenderer.send(TTS_DIAG, safe);
    }
  },
  reportSendGate(reason: 'generating' | 'microphone' | 'tts' | 'draft' | 'ready'): void {
    if (reason !== 'generating' && reason !== 'microphone' && reason !== 'tts' && reason !== 'draft' && reason !== 'ready') {
      return;
    }
    ipcRenderer.send(SEND_GATE, reason);
  },
  onTtsForceStop(listener: () => void): () => void {
    return listen(TTS_FORCE_STOP, () => listener());
  },
  async getTtsSettings(): Promise<{ enabled: boolean; autoRead: boolean; conversation: boolean; rate: number }> {
    const payload = await ipcRenderer.invoke(TTS_GET_SETTINGS);
    return readTtsSettings(payload) ?? { enabled: true, autoRead: false, conversation: false, rate: 1 };
  },
  setTtsSettings(next: { enabled?: boolean; autoRead?: boolean; conversation?: boolean; rate?: number }): void {
    if (!next || typeof next !== 'object') {
      return;
    }
    ipcRenderer.send(TTS_SET_SETTINGS, next);
  },
  onTtsSettings(listener: (settings: { enabled: boolean; autoRead: boolean; conversation: boolean; rate: number }) => void): () => void {
    return listen(TTS_SETTINGS, (payload) => {
      const settings = readTtsSettings(payload);
      if (settings) {
        listener(settings);
      }
    });
  },
  onHistory(listener: (lines: readonly ChatLinePayload[]) => void): () => void {
    return listen(HISTORY_CHANNEL, (payload) => {
      const lines = readHistory(payload);
      if (lines) {
        listener(lines);
      }
    });
  },
  onFocusComposer(listener: () => void): () => void {
    return listen(FOCUS_CHANNEL, () => {
      listener();
    });
  },
  onDelta(listener: (text: string) => void): () => void {
    return listen(DELTA_CHANNEL, (payload) => {
      if (typeof payload === 'string' && payload.length <= MAX_ASSISTANT_CHARS) {
        listener(payload);
      }
    });
  },
  onStatus(listener: (status: ChatStatusPayload) => void): () => void {
    return listen(STATUS_CHANNEL, (payload) => {
      const status = readStatus(payload);
      if (status) {
        listener(status);
      }
    });
  },
});

interface ChatLinePayload {
  role: 'user' | 'demo' | 'assistant';
  text: string;
}

interface ChatStatusPayload {
  provider: 'demo' | 'qwen';
  model: 'qwen3.7-plus';
  key: 'saved' | 'missing' | 'unavailable';
  endpoint: 'saved' | 'missing';
  busy: boolean;
  presence: 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'SPEAKING' | 'HAPPY' | 'ERROR' | 'IDLE' | 'CLEAR';
  notice: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number | null;
    totalTokens: number | null;
  } | null;
  endpointPreview: string | null;
}

function listen(channel: string, receive: (payload: unknown) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
    receive(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

function readHistory(value: unknown): ChatLinePayload[] | null {
  if (!Array.isArray(value) || value.length > MAX_CHAT_LINES) {
    return null;
  }
  const lines: ChatLinePayload[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const record = item as Record<string, unknown>;
    const role = record.role;
    const text = record.text;
    if ((role !== 'user' && role !== 'demo' && role !== 'assistant') || typeof text !== 'string') {
      return null;
    }
    const limit = role === 'assistant' ? MAX_ASSISTANT_CHARS : MAX_CHAT_CHARS;
    if (text.length === 0 || text.length > limit) {
      return null;
    }
    lines.push({ role, text });
  }
  return lines;
}

function readStatus(value: unknown): ChatStatusPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.provider !== 'demo' && record.provider !== 'qwen') {
    return null;
  }
  if (record.model !== 'qwen3.7-plus') {
    return null;
  }
  if (record.key !== 'saved' && record.key !== 'missing' && record.key !== 'unavailable') {
    return null;
  }
  if (record.endpoint !== 'saved' && record.endpoint !== 'missing') {
    return null;
  }
  if (typeof record.busy !== 'boolean') {
    return null;
  }
  if (
    record.presence !== 'ATTENTIVE' &&
    record.presence !== 'THINKING' &&
    record.presence !== 'RESPONDING' &&
    record.presence !== 'SPEAKING' &&
    record.presence !== 'HAPPY' &&
    record.presence !== 'ERROR' &&
    record.presence !== 'IDLE' &&
    record.presence !== 'CLEAR'
  ) {
    return null;
  }
  if (record.notice !== null && (typeof record.notice !== 'string' || record.notice.length > 400)) {
    return null;
  }
  if (record.endpointPreview !== null && (typeof record.endpointPreview !== 'string' || record.endpointPreview.length > 300)) {
    return null;
  }
  const usage = readUsage(record.usage);
  if (record.usage !== null && !usage) {
    return null;
  }
  return {
    provider: record.provider,
    model: 'qwen3.7-plus',
    key: record.key,
    endpoint: record.endpoint,
    busy: record.busy,
    presence: record.presence,
    notice: record.notice,
    usage,
    endpointPreview: record.endpointPreview,
  };
}

function readTtsSettings(value: unknown): { enabled: boolean; autoRead: boolean; conversation: boolean; rate: number } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean' || typeof record.autoRead !== 'boolean' || typeof record.rate !== 'number') {
    return null;
  }
  if (record.rate < 0.75 || record.rate > 1.25) {
    return null;
  }
  return {
    enabled: record.enabled,
    autoRead: record.autoRead,
    conversation: record.conversation === true,
    rate: record.rate,
  };
}

function clipField(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max) {
    return null;
  }
  return value;
}

function readTtsVoiceReport(value: unknown): {
  count: number;
  pablo: boolean;
  phase: 'pending' | 'settled';
  voices: { name: string; lang: string; voiceURI: string; localService: boolean }[];
} | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.count !== 'number' || record.count < 0 || record.count > 80) {
    return null;
  }
  if (typeof record.pablo !== 'boolean') {
    return null;
  }
  if (record.phase !== 'pending' && record.phase !== 'settled') {
    return null;
  }
  if (!Array.isArray(record.voices) || record.voices.length > 24) {
    return null;
  }
  const voices = [];
  for (const item of record.voices) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const voice = item as Record<string, unknown>;
    const name = clipField(voice.name, 120);
    const lang = clipField(voice.lang, 32);
    const voiceURI = clipField(voice.voiceURI, 160);
    if (name === null || lang === null || voiceURI === null || typeof voice.localService !== 'boolean') {
      return null;
    }
    voices.push({ name, lang, voiceURI, localService: voice.localService });
  }
  return { count: record.count, pablo: record.pablo, phase: record.phase, voices };
}

function readCount(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || value < 0) {
    return undefined;
  }
  return value;
}

function readUsage(value: unknown): ChatStatusPayload['usage'] {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.promptTokens !== 'number' || typeof record.completionTokens !== 'number') {
    return null;
  }
  if (record.promptTokens < 0 || record.completionTokens < 0) {
    return null;
  }
  const reasoningTokens = readCount(record.reasoningTokens);
  const totalTokens = readCount(record.totalTokens);
  if (record.reasoningTokens !== undefined && reasoningTokens === undefined) {
    return null;
  }
  if (record.totalTokens !== undefined && totalTokens === undefined) {
    return null;
  }
  return {
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    reasoningTokens: reasoningTokens ?? null,
    totalTokens: totalTokens ?? null,
  };
}
