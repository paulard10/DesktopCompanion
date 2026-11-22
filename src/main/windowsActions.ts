/**
 * Allowlisted Windows actions. The renderer chooses a known action.
 * It cannot supply a command line, a shell, or a path of its own.
 */

import { spawn } from 'node:child_process';
import { access, stat, writeFile } from 'node:fs/promises';
import { app, dialog, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels } from '../shared/ipc.js';
import {
  createWindowsActionGate,
  isOpenTarget,
  readNoteText,
  resolveWindowsExecutable,
  validateNoteDestination,
  type OpenTarget,
  type WindowsActionPose,
} from '../shared/windowsAction.js';

export function attachWindowsActionIpc(options: {
  isChatFrame: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  getParent: () => BrowserWindow | null;
  onPose: (pose: WindowsActionPose) => void;
}): { cancel: () => void; dispose: () => void } {
  const gate = createWindowsActionGate({
    open: openInstalledApp,
    chooseNoteFile: () => chooseNoteFile(options.getParent()),
    fileExists,
    writeNote,
  });

  const onOpen = (event: IpcMainInvokeEvent, target: unknown, requestId: unknown) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    return gate.open(target, requestId).then((result) => {
      const name = isOpenTarget(target) ? target : 'rejected';
      console.log(`desktop-companion: windows-action open=${name} result=${result.ok ? 'ok' : result.reason}`);
      return result;
    });
  };
  const onPick = (event: IpcMainInvokeEvent, text: unknown) => {
    if (!options.isChatFrame(event)) {
      return { ok: false, reason: 'invalid' };
    }
    return gate.pickNote(text).then((result) => {
      console.log(`desktop-companion: windows-action note=pick result=${result.ok ? 'ready' : result.reason}`);
      return result;
    });
  };
  const onSave = (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!options.isChatFrame(event) || !payload || typeof payload !== 'object') {
      return { ok: false, reason: 'missing' };
    }
    const record = payload as Record<string, unknown>;
    return gate.saveNote(record.token, record.text, record.overwrite).then((result) => {
      console.log(`desktop-companion: windows-action note=save result=${result.ok ? 'saved' : result.reason}`);
      return result;
    });
  };
  const onCancel = (event: IpcMainEvent) => {
    if (!options.isChatFrame(event)) {
      return;
    }
    gate.cancel();
    console.log('desktop-companion: windows-action cancelled');
  };
  const onPose = (event: IpcMainEvent, payload: unknown) => {
    if (!options.isChatFrame(event) || !isPose(payload)) {
      return;
    }
    options.onPose(payload);
  };

  ipcMain.handle(IpcChannels.windowsOpen, onOpen);
  ipcMain.handle(IpcChannels.windowsPickNote, onPick);
  ipcMain.handle(IpcChannels.windowsSaveNote, onSave);
  ipcMain.on(IpcChannels.windowsCancel, onCancel);
  ipcMain.on(IpcChannels.windowsPose, onPose);

  return {
    cancel() {
      gate.cancel();
    },
    dispose() {
      ipcMain.removeHandler(IpcChannels.windowsOpen);
      ipcMain.removeHandler(IpcChannels.windowsPickNote);
      ipcMain.removeHandler(IpcChannels.windowsSaveNote);
      ipcMain.removeListener(IpcChannels.windowsCancel, onCancel);
      ipcMain.removeListener(IpcChannels.windowsPose, onPose);
    },
  };
}

async function openInstalledApp(target: OpenTarget): Promise<boolean> {
  const root = process.env.SystemRoot || process.env.windir || '';
  const exe = resolveWindowsExecutable(root, target);
  if (!exe) {
    return false;
  }
  try {
    await access(exe);
  } catch {
    return false;
  }
  return launchDetached(exe);
}

async function chooseNoteFile(parent: BrowserWindow | null): Promise<string | null> {
  const dialogOptions = {
    title: 'Save note',
    defaultPath: `${app.getPath('documents')}\\note.txt`,
    filters: [{ name: 'Plain text', extensions: ['txt'] }],
    properties: ['createDirectory'] as ['createDirectory'],
    showOverwriteConfirmation: false,
  };
  const result = parent ? await dialog.showSaveDialog(parent, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
  if (result.canceled || typeof result.filePath !== 'string' || result.filePath.length === 0) {
    return null;
  }
  return result.filePath;
}

async function fileExists(filePath: string): Promise<'file' | 'other' | 'missing'> {
  if (!validateNoteDestination(filePath)) {
    return 'other';
  }
  try {
    const info = await stat(filePath);
    return info.isFile() ? 'file' : 'other';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'other';
  }
}

async function writeNote(filePath: string, text: string, replace: boolean): Promise<'saved' | 'exists' | 'failed'> {
  if (!validateNoteDestination(filePath) || !readNoteText(text)) {
    return 'failed';
  }
  try {
    await writeFile(filePath, text, { encoding: 'utf8', flag: replace ? 'w' : 'wx' });
    return 'saved';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'exists' : 'failed';
  }
}

function launchDetached(exe: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    const child = spawn(exe, [], { shell: false, detached: true, stdio: 'ignore' });
    child.once('error', () => finish(false));
    child.once('spawn', () => {
      child.unref();
      finish(true);
    });
  });
}

function isPose(value: unknown): value is WindowsActionPose {
  return value === 'thinking' || value === 'curious' || value === 'happy' || value === 'surprised' || value === 'clear';
}
