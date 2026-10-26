import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import { createFileVault, type KeyVault } from '../shared/keyVault.js';

const SMOKE_MARKER = 'dummy-key-1';

/** Async OS encryption. A missing or unreadable blob is not a key. */
export function createSafeCredentialStore(filePath: string): KeyVault {
  return createFileVault(filePath, {
    isAvailable(): Promise<boolean> {
      return safeStorage.isAsyncEncryptionAvailable();
    },
    encrypt(plain: string): Promise<Buffer> {
      return safeStorage.encryptStringAsync(plain);
    },
    async decrypt(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
      const decoded = await safeStorage.decryptStringAsync(encrypted);
      return { result: decoded.result, shouldReEncrypt: decoded.shouldReEncrypt };
    },
  });
}

/**
 * Encrypts a disposable marker outside userData, then deletes it.
 * The marker is compared in memory and is not written to the log.
 */
export async function checkDisposableCredential(directory: string): Promise<'ok' | 'unavailable' | 'failed'> {
  const root = path.resolve(directory);
  const temporary = path.resolve(os.tmpdir());
  if (!root.startsWith(`${temporary}${path.sep}`)) {
    return 'failed';
  }
  const filePath = path.join(root, 'dummy-key.bin');
  const vault = createSafeCredentialStore(filePath);
  try {
    await vault.prepare();
    if (!vault.available()) {
      return 'unavailable';
    }
    if ((await vault.save(SMOKE_MARKER)) !== 'saved') {
      return 'failed';
    }
    const loaded = await vault.load();
    const stored = fs.readFileSync(filePath);
    const leaked = stored.includes(Buffer.from(SMOKE_MARKER));
    vault.clear();
    if (loaded !== SMOKE_MARKER || leaked || fs.existsSync(filePath)) {
      return 'failed';
    }
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
