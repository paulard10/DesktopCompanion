import type { EyePreviewCue } from './faceExpression.js';

export const IpcChannels = {
  frameReady: 'overlay:frame-ready',
  circleClick: 'overlay:circle-click',
  selectScreen: 'overlay:select-screen',
  cursorSample: 'overlay:cursor-sample',
  behavior: 'overlay:behavior',
  explore: 'overlay:explore',
  phase: 'overlay:phase',
  openChat: 'overlay:open-chat',
  gesture: 'overlay:gesture',
  chatReady: 'chat:ready',
  chatSend: 'chat:send',
  chatClose: 'chat:close',
  chatMinimize: 'chat:minimize',
  chatActivity: 'chat:activity',
  chatHistory: 'chat:history',
  chatFocus: 'chat:focus',
  chatDelta: 'chat:delta',
  chatStatus: 'chat:status',
  chatStop: 'chat:stop',
  chatSaveKey: 'chat:save-key',
  chatRemoveKey: 'chat:remove-key',
  chatSetProvider: 'chat:set-provider',
  chatSetEndpoint: 'chat:set-endpoint',
  chatReset: 'chat:reset',
  chatPreviewPresence: 'chat:preview-presence',
  speechArm: 'speech:arm',
  speechDisarm: 'speech:disarm',
  speechTranscribe: 'speech:transcribe',
  speechCancel: 'speech:cancel',
  speechForceStop: 'speech:force-stop',
  ttsPresence: 'chat:tts-presence',
  voicePresence: 'chat:voice-presence',
  ttsForceStop: 'chat:tts-force-stop',
  ttsGetSettings: 'chat:tts-get-settings',
  ttsSetSettings: 'chat:tts-set-settings',
  ttsSettings: 'chat:tts-settings',
  ttsDiag: 'chat:tts-diag',
  sendGate: 'chat:send-gate',
  presence: 'overlay:presence',
  eyePreview: 'overlay:eye-preview',
  moveTest: 'chat:move-test',
  travel: 'overlay:travel',
  trailHello: 'trail:hello',
  trailMotion: 'trail:motion',
  trailSpawn: 'trail:spawn',
  trailViewport: 'trail:viewport',
  trailClear: 'trail:clear',
  trailIdle: 'trail:idle',
  trailFault: 'trail:fault',
  trailDrew: 'trail:drew',
  trailMarker: 'trail:marker',
  homeReady: 'home:ready',
  homeClick: 'home:click',
  homeFeedback: 'home:feedback',
} as const;

/** Home has no movement, capture-region, filesystem or generic IPC capability. */
export type HomeFeedback = 'pulse' | 'busy' | 'docked' | 'idle' | 'blocked';
export interface HomeBridge {
  notifyReady: () => void;
  notifyClick: () => void;
  onFeedback: (listener: (feedback: HomeFeedback) => void) => () => void;
}

export const BEHAVIOR_PHASES = [
  'SLEEPING',
  'WAKING',
  'IDLE',
  'TRACKING',
  'RETURNING_TO_SLEEP',
] as const;

export type BehaviorPhaseName = (typeof BEHAVIOR_PHASES)[number];

export type BehaviorCommand = 'wake' | 'sleep';

/** Screen DIP from the main-process cursor poll. No window titles or key state. */
export interface CursorSample {
  x: number;
  y: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  at: number;
  /** Main-owned temporary input suppression during experimental follow. */
  inputSuppressed?: boolean;
}

export interface ChatLineMessage {
  role: 'user' | 'demo' | 'assistant';
  text: string;
}

export interface ChatUsageMessage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export interface ChatStatusMessage {
  provider: 'demo' | 'qwen';
  model: 'qwen3.7-plus';
  key: 'saved' | 'missing' | 'unavailable';
  endpoint: 'saved' | 'missing';
  busy: boolean;
  presence: 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'SPEAKING' | 'HAPPY' | 'ERROR' | 'IDLE' | 'CLEAR';
  notice: string | null;
  usage: ChatUsageMessage | null;
  endpointPreview: string | null;
}

export interface CompanionBridge {
  notifyFrameReady: () => void;
  notifyCircleClick: () => void;
  notifyPhase: (phase: BehaviorPhaseName) => void;
  requestOpenChat: () => void;
  requestSelectScreen: () => void;
  onCursorSample: (listener: (sample: CursorSample) => void) => () => void;
  onBehavior: (listener: (command: BehaviorCommand) => void) => () => void;
  onExplore: (listener: (durationMs: number | null) => void) => () => void;
  onGesture: (listener: (gesture: 'greet' | 'nod' | 'explain') => void) => () => void;
  onPresence: (
    listener: (presence: 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'SPEAKING' | 'HAPPY' | 'ERROR' | 'IDLE' | 'CLEAR') => void,
  ) => () => void;
  onEyePreview: (listener: (cue: EyePreviewCue) => void) => () => void;
  onTravel: (listener: (moving: boolean) => void) => () => void;
}

export interface ChatBridge {
  notifyReady: () => void;
  sendMessage: (text: string) => void;
  stopGeneration: () => void;
  saveKey: (key: string) => void;
  removeKey: () => void;
  setProvider: (provider: 'demo' | 'qwen') => void;
  setEndpoint: (endpoint: string) => void;
  resetConversation: () => void;
  previewPresence: (
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
  ) => void;
  testWindowMove: () => Promise<{ received: boolean; block: 'chat' | 'voice' | 'busy' | 'none'; message: string }>;
  closeChat: () => void;
  minimizeChat: () => void;
  notifyActivity: () => void;
  onHistory: (listener: (lines: readonly ChatLineMessage[]) => void) => () => void;
  onFocusComposer: (listener: () => void) => () => void;
  onDelta: (listener: (text: string) => void) => () => void;
  onStatus: (listener: (status: ChatStatusMessage) => void) => () => void;
  armMicrophone: () => Promise<boolean>;
  disarmMicrophone: () => void;
  transcribeAudio: (wav: Uint8Array) => Promise<{ text?: string; error?: string }>;
  cancelTranscription: () => void;
  onSpeechForceStop: (listener: () => void) => () => void;
  onTtsForceStop: (listener: () => void) => () => void;
  getTtsSettings: () => Promise<{ enabled: boolean; autoRead: boolean; conversation: boolean; rate: number }>;
  setTtsSettings: (next: { enabled?: boolean; autoRead?: boolean; conversation?: boolean; rate?: number }) => void;
  notifyTtsSpeaking: (active: boolean) => void;
  notifyVoicePresence: (pose: 'ATTENTIVE' | 'THINKING' | 'IDLE' | 'ERROR' | 'CLEAR') => void;
  onTtsSettings: (listener: (settings: { enabled: boolean; autoRead: boolean; conversation: boolean; rate: number }) => void) => () => void;
  reportTtsVoices: (report: {
    count: number;
    pablo: boolean;
    phase: 'pending' | 'settled';
    voices: readonly { name: string; lang: string; voiceURI: string; localService: boolean }[];
  }) => void;
  reportSendGate: (reason: 'generating' | 'microphone' | 'tts' | 'draft' | 'ready') => void;
}

export interface TtsSettingsMessage {
  enabled: boolean;
  autoRead: boolean;
  conversation: boolean;
  rate: number;
}
