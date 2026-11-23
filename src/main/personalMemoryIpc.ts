/**
 * Chat-frame memory IPC. Results are status codes. Memory text is not logged.
 */

import { ipcMain, safeStorage, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '../shared/ipc.js';
import { createMemorySaveGate, isMemoryId, isMemoryRevision } from '../shared/personalMemory.js';
import { createPersonalMemoryStore, type MemoryStoreResult, type PersonalMemoryStore } from './personalMemoryStore.js';

export function createDesktopMemoryStore(filePath: string): PersonalMemoryStore {
  return createPersonalMemoryStore(filePath, {
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptStringAsync(plain),
    async decrypt(encrypted) {
      const decoded = await safeStorage.decryptStringAsync(encrypted);
      return { text: decoded.result, refresh: decoded.shouldReEncrypt === true };
    },
  });
}

export function attachPersonalMemoryIpc(options: {
  isChatFrame: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  store: PersonalMemoryStore;
  send: (state: ReturnType<PersonalMemoryStore['publicState']>) => void;
}): { publish: () => void; dispose: () => void } {
  const gate = createMemorySaveGate();

  const publish = (): void => {
    options.send(options.store.publicState());
  };

  const finish = (op: string, result: MemoryStoreResult): MemoryStoreResult => {
    console.log(`desktop-companion: memory op=${op} result=${result.ok ? 'saved' : result.reason}`);
    publish();
    return result;
  };

  const onSnapshot = (event: IpcMainInvokeEvent) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    return options.store.snapshot().then((snapshot) => {
      console.log(`desktop-companion: memory op=list result=${snapshot.readable ? 'ready' : 'unavailable'} count=${snapshot.count}`);
      return snapshot;
    });
  };

  const onCreate = (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    const record = recordOf(payload);
    if (!record || !gate.accept(record.token) || !isMemoryRevision(record.revision) || typeof record.text !== 'string') {
      return { ok: false, reason: 'duplicate' };
    }
    return options.store.create(record.text, record.revision).then((result) => finish('save', result));
  };

  const onUpdate = (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    const record = recordOf(payload);
    if (!record || !gate.accept(record.token) || !isMemoryId(record.id) || !isMemoryRevision(record.revision) || typeof record.text !== 'string') {
      return { ok: false, reason: 'duplicate' };
    }
    return options.store.update(record.id, record.text, record.revision).then((result) => finish('edit', result));
  };

  const onDelete = (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    const record = recordOf(payload);
    if (!record || !gate.accept(record.token) || !isMemoryId(record.id) || !isMemoryRevision(record.revision)) {
      return { ok: false, reason: 'duplicate' };
    }
    return options.store.remove(record.id, record.revision).then((result) => finish('delete', result));
  };

  const onClear = (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    const record = recordOf(payload);
    if (!record || !gate.accept(record.token) || !isMemoryRevision(record.revision)) {
      return { ok: false, reason: 'duplicate' };
    }
    return options.store.clear(record.revision).then((result) => finish('clear', result));
  };

  const onUse = (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    const record = recordOf(payload);
    if (!record || !gate.accept(record.token) || !isMemoryRevision(record.revision) || typeof record.enabled !== 'boolean') {
      return { ok: false, reason: 'duplicate' };
    }
    return options.store.setUse(record.enabled, record.revision).then((result) => finish('use', result));
  };

  ipcMain.handle(IpcChannels.memorySnapshot, onSnapshot);
  ipcMain.handle(IpcChannels.memoryCreate, onCreate);
  ipcMain.handle(IpcChannels.memoryUpdate, onUpdate);
  ipcMain.handle(IpcChannels.memoryDelete, onDelete);
  ipcMain.handle(IpcChannels.memoryClear, onClear);
  ipcMain.handle(IpcChannels.memoryUse, onUse);
  void options.store.load().then(publish);

  return {
    publish,
    dispose() {
      ipcMain.removeHandler(IpcChannels.memorySnapshot);
      ipcMain.removeHandler(IpcChannels.memoryCreate);
      ipcMain.removeHandler(IpcChannels.memoryUpdate);
      ipcMain.removeHandler(IpcChannels.memoryDelete);
      ipcMain.removeHandler(IpcChannels.memoryClear);
      ipcMain.removeHandler(IpcChannels.memoryUse);
    },
  };
}

function recordOf(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}
