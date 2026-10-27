/**
 * Optional per-user Windows login startup.
 *
 * Electron 44.9.3 writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
 * The value name defaults to the app user model id, and getLoginItemSettings
 * reads openAtLogin from that same id. This module never stores the choice in
 * user preferences: a later read of the login item is the source of truth.
 */

import path from 'node:path';

export const APP_USER_MODEL_ID = 'com.desktopcompanion.shell';
export const LOGIN_STARTUP_ARGS: readonly string[] = Object.freeze([]);
export const INSTALLED_FOLDER_NAME = 'DesktopCompanion';
export const INSTALLED_EXECUTABLE_NAME = 'DesktopCompanion.exe';

export interface LoginLaunchItem {
  name: string;
  path: string;
  args: readonly string[];
  scope: 'user' | 'machine' | 'other';
  enabled: boolean;
}

export interface LoginStartupSnapshot {
  openAtLogin: boolean;
  executableWillLaunchAtLogin: boolean;
  launchItems: readonly LoginLaunchItem[];
}

export interface LoginStartupQuery {
  path: string;
  args: readonly string[];
}

export interface LoginStartupWrite {
  openAtLogin: boolean;
  path: string;
  args: readonly string[];
  name: string;
  enabled: true;
}

export interface LoginStartupAdapter {
  read(query: LoginStartupQuery): LoginStartupSnapshot;
  write(settings: LoginStartupWrite): void;
}

export interface LoginStartupEnvironment {
  platform: string;
  execPath: string;
  localAppData: string | undefined;
  dev: boolean;
  smoke: boolean;
  exists(candidate: string): boolean;
}

export interface OwnLoginStartupState {
  registered: boolean;
  effectivelyEnabled: boolean;
  canonical: boolean;
}

export interface LoginStartupToggleResult {
  ok: boolean;
  checked: boolean;
  reason: 'ok' | 'unavailable' | 'write-failed' | 'read-failed' | 'mismatch';
}

export interface LoginStartupController {
  available(): boolean;
  checked(): boolean;
  setEnabled(enabled: boolean): LoginStartupToggleResult;
}

export interface LoginStartupMenuItem {
  label: 'Start with Windows';
  type: 'checkbox';
  checked: boolean;
  enabled: boolean;
}

export function expectedInstalledExecutable(localAppData: string | undefined): string | null {
  if (typeof localAppData !== 'string' || localAppData.trim() === '') {
    return null;
  }
  return path.win32.join(localAppData, 'Programs', INSTALLED_FOLDER_NAME, INSTALLED_EXECUTABLE_NAME);
}

export function sameWindowsPath(left: string, right: string): boolean {
  return normalizeWindowsPath(left) === normalizeWindowsPath(right);
}

export function isVerifiedInstalledExecutable(execPath: string, localAppData: string | undefined): boolean {
  const expected = expectedInstalledExecutable(localAppData);
  if (expected == null || execPath.trim() === '') {
    return false;
  }
  if (!sameWindowsPath(execPath, expected)) {
    return false;
  }
  const folded = execPath.toLowerCase();
  const blocked = ['\\node_modules\\', '\\win-unpacked\\', '\\release\\', '\\cursor\\'];
  if (blocked.some((part) => folded.includes(part))) {
    return false;
  }
  const fileName = path.win32.basename(execPath).toLowerCase();
  const blockedNames = ['electron.exe', 'node.exe', 'npm.cmd', 'npm.exe', 'npx.cmd', 'vite.exe', 'vite.cmd'];
  return !blockedNames.includes(fileName);
}

export function loginStartupAvailable(env: LoginStartupEnvironment): boolean {
  if (env.platform !== 'win32' || env.dev || env.smoke) {
    return false;
  }
  if (!isVerifiedInstalledExecutable(env.execPath, env.localAppData)) {
    return false;
  }
  try {
    return env.exists(env.execPath) === true;
  } catch {
    return false;
  }
}

export function inspectOwnLoginStartup(snapshot: LoginStartupSnapshot, execPath: string): OwnLoginStartupState {
  const own = snapshot.launchItems.filter((item) =>
    item.scope === 'user'
    && item.name === APP_USER_MODEL_ID
    && sameWindowsPath(item.path, execPath));
  const item = own.length === 1 ? own[0] : undefined;
  if (item == null) {
    return { registered: false, effectivelyEnabled: false, canonical: false };
  }
  const canonical = snapshot.openAtLogin === true && sameArgs(item.args, LOGIN_STARTUP_ARGS);
  return {
    registered: true,
    effectivelyEnabled: item.enabled === true,
    canonical,
  };
}

export function startupWillLaunch(snapshot: LoginStartupSnapshot, execPath: string): boolean {
  return inspectOwnLoginStartup(snapshot, execPath).effectivelyEnabled;
}

export function loginStartupMenuItem(available: boolean, checked: boolean): LoginStartupMenuItem {
  return {
    label: 'Start with Windows',
    type: 'checkbox',
    checked: available && checked,
    enabled: available,
  };
}

export function uninstallRemovesLoginValue(registryValue: string | null | undefined, installDir: string): boolean {
  if (typeof registryValue !== 'string' || registryValue.trim() === '' || installDir.trim() === '') {
    return false;
  }
  const value = registryValue.trim();
  const exe = path.win32.join(installDir, INSTALLED_EXECUTABLE_NAME);
  const quoted = `"${exe}"`;
  const foldedValue = value.toLowerCase();
  if (foldedValue === quoted.toLowerCase() || foldedValue === exe.toLowerCase()) {
    return true;
  }
  if (!foldedValue.startsWith(quoted.toLowerCase())) {
    return false;
  }
  const next = value.charAt(quoted.length);
  return next === ' ' || next === '\t';
}

export function createLoginStartupController(
  env: LoginStartupEnvironment,
  adapter: LoginStartupAdapter,
): LoginStartupController {
  const query = (): LoginStartupQuery => ({ path: env.execPath, args: [...LOGIN_STARTUP_ARGS] });

  const readState = (): { state: OwnLoginStartupState; failed: boolean } => {
    try {
      return { state: inspectOwnLoginStartup(adapter.read(query()), env.execPath), failed: false };
    } catch {
      return {
        state: { registered: false, effectivelyEnabled: false, canonical: false },
        failed: true,
      };
    }
  };

  return {
    available: () => loginStartupAvailable(env),
    checked: () => {
      if (!loginStartupAvailable(env)) {
        return false;
      }
      return readState().state.effectivelyEnabled;
    },
    setEnabled: (enabled) => {
      if (!loginStartupAvailable(env)) {
        return { ok: false, checked: false, reason: 'unavailable' };
      }
      const openAtLogin = enabled === true;
      const command = { path: env.execPath, args: [...LOGIN_STARTUP_ARGS] };
      try {
        adapter.write({
          openAtLogin,
          path: command.path,
          args: command.args,
          name: APP_USER_MODEL_ID,
          enabled: true,
        });
      } catch {
        const current = readState();
        return { ok: false, checked: current.state.effectivelyEnabled, reason: 'write-failed' };
      }
      const current = readState();
      if (current.failed) {
        return { ok: false, checked: false, reason: 'read-failed' };
      }
      const accepted = openAtLogin
        ? current.state.registered && current.state.effectivelyEnabled && current.state.canonical
        : !current.state.registered && !current.state.effectivelyEnabled;
      if (!accepted) {
        return { ok: false, checked: current.state.effectivelyEnabled, reason: 'mismatch' };
      }
      return { ok: true, checked: current.state.effectivelyEnabled, reason: 'ok' };
    },
  };
}

function sameArgs(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function normalizeWindowsPath(value: string): string {
  const trimmed = value.trim();
  const unquoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
  return path.win32.normalize(unquoted.replaceAll('/', '\\')).replace(/[\\]+$/u, '').toLowerCase();
}
