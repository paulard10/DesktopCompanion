import { existsSync } from 'node:fs';
import path from 'node:path';

/** Paths inside the packaged layout. Unpackaged `dist/main` keeps the same relative joins. */

export function companionPreload(mainDirectory: string): string {
  return path.join(mainDirectory, '..', 'preload', 'preload.js');
}

export function companionChatPreload(mainDirectory: string): string {
  return path.join(mainDirectory, '..', 'preload', 'chatPreload.js');
}

export function companionTrailPreload(mainDirectory: string): string {
  return path.join(mainDirectory, '..', 'preload', 'trailPreload.js');
}

export function companionRendererRoot(mainDirectory: string): string {
  return path.join(mainDirectory, '..', 'renderer');
}

export function companionSpeechRoot(resourcesPath: string): string {
  return path.join(resourcesPath, 'speech');
}

/** Where whisper-cli.exe and ggml-tiny.bin live. They are not part of the repository. */
export function speechAssetRoot(input: {
  packaged: boolean;
  resourcesPath: string;
  projectRoot: string;
  configuredPath?: string | undefined;
}): string {
  const configured = input.configuredPath?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  if (input.packaged) {
    return companionSpeechRoot(input.resourcesPath);
  }
  return path.join(input.projectRoot, '.local-asr');
}

/**
 * The tray PNG is unpacked beside the asar because the native image loader
 * does not read files stored only inside the archive.
 */
export function resolveTrayIcon(
  mainDirectory: string,
  fileExists: (candidate: string) => boolean = existsSync,
): string {
  const packed = path.join(mainDirectory, '..', '..', 'assets', 'tray.png');
  const marker = `${path.sep}app.asar${path.sep}`;
  if (!packed.includes(marker)) {
    return packed;
  }
  const unpacked = packed.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
  return fileExists(unpacked) ? unpacked : packed;
}
