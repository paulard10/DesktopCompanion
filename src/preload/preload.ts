import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const FRAME_READY_CHANNEL = 'overlay:frame-ready';
const CIRCLE_CLICK_CHANNEL = 'overlay:circle-click';
const SELECT_SCREEN_CHANNEL = 'overlay:select-screen';
const CURSOR_SAMPLE_CHANNEL = 'overlay:cursor-sample';
const BEHAVIOR_CHANNEL = 'overlay:behavior';
const EXPLORE_CHANNEL = 'overlay:explore';
const MAX_EXPLORE_MS = 360_000;
const PHASE_CHANNEL = 'overlay:phase';
const OPEN_CHAT_CHANNEL = 'overlay:open-chat';
const GESTURE_CHANNEL = 'overlay:gesture';
const PRESENCE_CHANNEL = 'overlay:presence';
const EYE_PREVIEW_CHANNEL = 'overlay:eye-preview';
const TRAVEL_CHANNEL = 'overlay:travel';
const PHASES = ['SLEEPING', 'WAKING', 'IDLE', 'TRACKING', 'RETURNING_TO_SLEEP'];

contextBridge.exposeInMainWorld('companion', {
  notifyFrameReady(): void {
    ipcRenderer.send(FRAME_READY_CHANNEL, 'm1.6');
  },
  notifyCircleClick(): void {
    ipcRenderer.send(CIRCLE_CLICK_CHANNEL);
  },
  notifyPhase(phase: string): void {
    if (PHASES.includes(phase)) {
      ipcRenderer.send(PHASE_CHANNEL, phase);
    }
  },
  requestOpenChat(): void {
    ipcRenderer.send(OPEN_CHAT_CHANNEL);
  },
  requestSelectScreen(): void {
    ipcRenderer.send(SELECT_SCREEN_CHANNEL);
  },
  onCursorSample(listener: (sample: CursorSamplePayload) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      const sample = readCursorSample(payload);
      if (sample) {
        listener(sample);
      }
    };
    ipcRenderer.on(CURSOR_SAMPLE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(CURSOR_SAMPLE_CHANNEL, wrapped);
    };
  },
  onBehavior(listener: (command: 'wake' | 'sleep' | 'engage' | 'linger' | 'hold' | 'release') => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      if (payload === 'wake' || payload === 'sleep' || payload === 'engage' || payload === 'linger' || payload === 'hold' || payload === 'release') {
        listener(payload);
      }
    };
    ipcRenderer.on(BEHAVIOR_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(BEHAVIOR_CHANNEL, wrapped);
    };
  },
  onExplore(listener: (durationMs: number | null) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      if (payload === null || payload === 0) {
        listener(null);
        return;
      }
      if (typeof payload === 'number' && Number.isFinite(payload) && payload >= 0 && payload <= MAX_EXPLORE_MS) {
        listener(payload);
      }
    };
    ipcRenderer.on(EXPLORE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(EXPLORE_CHANNEL, wrapped);
    };
  },
  onGesture(listener: (gesture: 'greet' | 'nod' | 'explain') => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      if (payload === 'greet' || payload === 'nod' || payload === 'explain') {
        listener(payload);
      }
    };
    ipcRenderer.on(GESTURE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(GESTURE_CHANNEL, wrapped);
    };
  },
  onPresence(listener: (presence: 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'SPEAKING' | 'HAPPY' | 'ERROR' | 'IDLE' | 'CLEAR') => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      if (
        payload === 'ATTENTIVE' ||
        payload === 'THINKING' ||
        payload === 'RESPONDING' ||
        payload === 'SPEAKING' ||
        payload === 'HAPPY' ||
        payload === 'ERROR' ||
        payload === 'IDLE' ||
        payload === 'CLEAR'
      ) {
        listener(payload);
      }
    };
    ipcRenderer.on(PRESENCE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(PRESENCE_CHANNEL, wrapped);
    };
  },
  onEyePreview(
    listener: (
      cue: 'CURIOUS' | 'SURPRISED' | 'SLEEPING' | 'BLINK' | 'WAKING' | 'PROBE_LEFT' | 'PROBE_RIGHT' | 'PROBE_ANTENNA' | 'PROBE_BODY' | 'PROBE_RESET' | 'CLEAR',
    ) => void,
  ): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      if (
        payload === 'CURIOUS' ||
        payload === 'SURPRISED' ||
        payload === 'SLEEPING' ||
        payload === 'BLINK' ||
        payload === 'WAKING' ||
        payload === 'PROBE_LEFT' ||
        payload === 'PROBE_RIGHT' ||
        payload === 'PROBE_ANTENNA' ||
        payload === 'PROBE_BODY' ||
        payload === 'PROBE_RESET' ||
        payload === 'CLEAR'
      ) {
        listener(payload);
      }
    };
    ipcRenderer.on(EYE_PREVIEW_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(EYE_PREVIEW_CHANNEL, wrapped);
    };
  },
  onTravel(listener: (moving: boolean) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
      listener(payload === true);
    };
    ipcRenderer.on(TRAVEL_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(TRAVEL_CHANNEL, wrapped);
    };
  },
});

interface CursorSamplePayload {
  x: number;
  y: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  at: number;
  inputSuppressed?: boolean;
  calm?: boolean;
}

function readCursorSample(value: unknown): CursorSamplePayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const sample = value as Record<string, unknown>;
  const x = sample.x;
  const y = sample.y;
  const originX = sample.originX;
  const originY = sample.originY;
  const width = sample.width;
  const height = sample.height;
  const at = sample.at;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof originX !== 'number' ||
    typeof originY !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    typeof at !== 'number'
  ) {
    return null;
  }
  if (![x, y, originX, originY, width, height, at].every((part) => Number.isFinite(part))) {
    return null;
  }
  if (width <= 0 || height <= 0) {
    return null;
  }
  if (sample.inputSuppressed !== undefined && typeof sample.inputSuppressed !== 'boolean') return null;
  if (sample.calm !== undefined && typeof sample.calm !== 'boolean') return null;
  return {
    x, y, originX, originY, width, height, at,
    inputSuppressed: sample.inputSuppressed === true,
    calm: sample.calm === true,
  };
}
