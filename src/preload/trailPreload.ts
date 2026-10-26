import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * Sandbox allows this file to require Electron only. A relative require of
 * another application file throws "module not found" and the bridge never
 * appears, so the main process never becomes ready and never delivers pearls.
 * Frame checks live in the trail page, which Vite bundles.
 */

const HELLO_CHANNEL = 'trail:hello';
const MOTION_CHANNEL = 'trail:motion';
const SPAWN_CHANNEL = 'trail:spawn';
const VIEWPORT_CHANNEL = 'trail:viewport';
const CLEAR_CHANNEL = 'trail:clear';
const IDLE_CHANNEL = 'trail:idle';
const FAULT_CHANNEL = 'trail:fault';
const DREW_CHANNEL = 'trail:drew';
const MARKER_CHANNEL = 'trail:marker';

export interface TrailDrawReport {
  count: number;
  ageMs: number;
  expired: number;
  clipped: number;
  canvasW: number;
  canvasH: number;
  dipW: number;
  dipH: number;
}

contextBridge.exposeInMainWorld('trail', {
  notifyHello(reduced: boolean): void {
    ipcRenderer.send(HELLO_CHANNEL, reduced === true);
  },
  notifyMotion(reduced: boolean): void {
    ipcRenderer.send(MOTION_CHANNEL, reduced === true);
  },
  notifyIdle(): void {
    ipcRenderer.send(IDLE_CHANNEL);
  },
  notifyFault(): void {
    ipcRenderer.send(FAULT_CHANNEL);
  },
  notifyDrew(report: TrailDrawReport): void {
    const safe = readReport(report);
    if (safe) {
      ipcRenderer.send(DREW_CHANNEL, safe);
    }
  },
  onSpawn(listener: (payload: unknown) => void): () => void {
    return listen(SPAWN_CHANNEL, listener);
  },
  onViewport(listener: (payload: unknown) => void): () => void {
    return listen(VIEWPORT_CHANNEL, listener);
  },
  onClear(listener: () => void): () => void {
    return listen(CLEAR_CHANNEL, () => {
      listener();
    });
  },
  onMarker(listener: (payload: unknown) => void): () => void {
    return listen(MARKER_CHANNEL, listener);
  },
});

function listen(channel: string, receive: (payload: unknown) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
    receive(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

function readReport(value: unknown): TrailDrawReport | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const count = readCount(record.count, 33);
  const ageMs = readCount(record.ageMs, 20_000);
  const expired = readCount(record.expired, 33);
  const clipped = readCount(record.clipped, 33);
  const canvasW = readCount(record.canvasW, 16_000);
  const canvasH = readCount(record.canvasH, 16_000);
  const dipW = readCount(record.dipW, 16_000);
  const dipH = readCount(record.dipH, 16_000);
  if (
    count === null ||
    ageMs === null ||
    expired === null ||
    clipped === null ||
    canvasW === null ||
    canvasH === null ||
    dipW === null ||
    dipH === null
  ) {
    return null;
  }
  return { count, ageMs, expired, clipped, canvasW, canvasH, dipW, dipH };
}

function readCount(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : null;
}
