/** Local tray preferences. No secrets, transcripts, or movement leases. */

import fs from 'node:fs';
import path from 'node:path';

export const USER_PREFERENCES_VERSION = 1;

export const MOVEMENT_SPEEDS = ['calm', 'normal', 'lively'] as const;
export type MovementSpeed = (typeof MOVEMENT_SPEEDS)[number];

export interface UserPreferences {
  version: 1;
  neonTrailEnabled: boolean;
  /** Kept so older files still parse. Launch uses manualSleep. */
  startAwake: boolean;
  /** Set only by an explicit sleep. Cleared on an explicit wake. */
  manualSleep: boolean;
  followCursor: boolean;
  autonomousMovement: boolean;
  reducedMotion: boolean;
  movementSpeed: MovementSpeed;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  version: USER_PREFERENCES_VERSION,
  neonTrailEnabled: true,
  startAwake: false,
  manualSleep: false,
  followCursor: true,
  autonomousMovement: true,
  reducedMotion: false,
  movementSpeed: 'normal',
};

export function movementScale(speed: MovementSpeed): number {
  if (speed === 'calm') {
    return 0.72;
  }
  if (speed === 'lively') {
    return 1.28;
  }
  return 1;
}

export interface PreferenceDocument {
  ok: boolean;
  reason: 'ok' | 'invalid-json' | 'unsupported-version' | 'invalid-shape';
  preferences: UserPreferences;
}

export function parseUserPreferences(raw: string): PreferenceDocument {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return rejected('invalid-json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return rejected('invalid-shape');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== USER_PREFERENCES_VERSION) {
    return rejected('unsupported-version');
  }
  return {
    ok: true,
    reason: 'ok',
    preferences: {
      version: USER_PREFERENCES_VERSION,
      neonTrailEnabled: booleanOr(record.neonTrailEnabled, true),
      startAwake: booleanOr(record.startAwake, false),
      manualSleep: booleanOr(record.manualSleep, false),
      followCursor: booleanOr(record.followCursor, true),
      autonomousMovement: booleanOr(record.autonomousMovement, true),
      reducedMotion: booleanOr(record.reducedMotion, false),
      movementSpeed: speedOr(record.movementSpeed),
    },
  };
}

export function serializeUserPreferences(preferences: UserPreferences): string {
  return JSON.stringify({
    version: USER_PREFERENCES_VERSION,
    neonTrailEnabled: preferences.neonTrailEnabled === true,
    startAwake: preferences.startAwake === true,
    manualSleep: preferences.manualSleep === true,
    followCursor: preferences.followCursor === true,
    autonomousMovement: preferences.autonomousMovement === true,
    reducedMotion: preferences.reducedMotion === true,
    movementSpeed: speedOr(preferences.movementSpeed),
  });
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function speedOr(value: unknown): MovementSpeed {
  return value === 'calm' || value === 'lively' || value === 'normal' ? value : 'normal';
}

function rejected(reason: PreferenceDocument['reason']): PreferenceDocument {
  return { ok: false, reason, preferences: { ...DEFAULT_USER_PREFERENCES } };
}

export interface UserPreferencesStore {
  current(): UserPreferences;
  update(patch: Partial<Omit<UserPreferences, 'version'>>): UserPreferences;
  close(): void;
}

export function createUserPreferencesStore(
  filePath: string,
  options?: { failBeforeReplace?: boolean },
): UserPreferencesStore {
  let state = loadPreferences(filePath);
  let closed = false;

  return {
    current(): UserPreferences {
      return state;
    },
    update(patch): UserPreferences {
      if (closed) {
        return state;
      }
      const next: UserPreferences = {
        version: USER_PREFERENCES_VERSION,
        neonTrailEnabled: patch.neonTrailEnabled ?? state.neonTrailEnabled,
        startAwake: patch.startAwake ?? state.startAwake,
        manualSleep: patch.manualSleep ?? state.manualSleep,
        followCursor: patch.followCursor ?? state.followCursor,
        autonomousMovement: patch.autonomousMovement ?? state.autonomousMovement,
        reducedMotion: patch.reducedMotion ?? state.reducedMotion,
        movementSpeed: patch.movementSpeed ?? state.movementSpeed,
      };
      if (samePreferences(next, state)) {
        return state;
      }
      try {
        writePreferences(filePath, next, options?.failBeforeReplace === true);
      } catch (error) {
        console.log(`desktop-companion: preferences-write-failed code=${errorCode(error)}`);
        return state;
      }
      state = next;
      return state;
    },
    close(): void {
      closed = true;
    },
  };
}

function samePreferences(left: UserPreferences, right: UserPreferences): boolean {
  return (
    left.neonTrailEnabled === right.neonTrailEnabled &&
    left.startAwake === right.startAwake &&
    left.manualSleep === right.manualSleep &&
    left.followCursor === right.followCursor &&
    left.autonomousMovement === right.autonomousMovement &&
    left.reducedMotion === right.reducedMotion &&
    left.movementSpeed === right.movementSpeed
  );
}

function loadPreferences(filePath: string): UserPreferences {
  const backup = backupPath(filePath);
  let target = filePath;
  if (!fs.existsSync(filePath)) {
    if (!fs.existsSync(backup)) {
      return { ...DEFAULT_USER_PREFERENCES };
    }
    target = backup;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (error) {
    console.log(`desktop-companion: preferences-read-failed code=${errorCode(error)}`);
    return { ...DEFAULT_USER_PREFERENCES };
  }
  const parsed = parseUserPreferences(raw);
  if (!parsed.ok) {
    console.log(`desktop-companion: preferences-read-failed code=${parsed.reason}`);
    return { ...DEFAULT_USER_PREFERENCES };
  }
  return parsed.preferences;
}

function writePreferences(filePath: string, preferences: UserPreferences, failBeforeReplace: boolean): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, serializeUserPreferences(preferences), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (failBeforeReplace) {
    fs.rmSync(temp, { force: true });
    throw Object.assign(new Error('preferences-write-failed'), { code: 'interrupted' });
  }
  replaceFile(temp, filePath);
}

function replaceFile(temp: string, filePath: string): void {
  const backup = backupPath(filePath);
  fs.rmSync(backup, { force: true });
  let moved = false;
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, backup);
    moved = true;
  }
  try {
    fs.renameSync(temp, filePath);
  } catch (error) {
    if (moved) {
      try {
        if (!fs.existsSync(filePath)) {
          fs.renameSync(backup, filePath);
        }
      } catch {
        // The previous file remains at the backup path for the next read.
      }
    }
    fs.rmSync(temp, { force: true });
    throw error;
  }
  fs.rmSync(backup, { force: true });
}

function backupPath(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.bak`);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'error';
}
