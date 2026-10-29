/** Credential vault boundary. The API key never crosses this as a status field. */

import fs from 'node:fs';
import path from 'node:path';

export type KeySaveResult = 'saved' | 'unavailable' | 'rejected';
export type CredentialLoadStatus = 'CREDENTIAL_ACCESS_UNVERIFIED' | 'AVAILABLE' | 'SECURE_STORAGE_UNAVAILABLE'
  | 'CREDENTIAL_ENTRY_MISSING' | 'CREDENTIAL_LOOKUP_ERROR' | 'CREDENTIAL_RECORD_INVALID';

export interface KeyVault {
  available(): boolean;
  prepare(): Promise<void>;
  save(secret: string): Promise<KeySaveResult>;
  present(): boolean;
  load(): Promise<string | null>;
  clear(): void;
  diagnosticStatus?(): CredentialLoadStatus;
}

export interface AsyncCipher {
  isAvailable(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export type LocalCredentialOutcome = 'AVAILABLE_LOCALLY' | 'CREDENTIAL_ENTRY_MISSING'
  | 'CREDENTIAL_DECRYPTION_FAILED' | 'SECURE_STORAGE_UNAVAILABLE' | 'CREDENTIAL_READ_ERROR'
  | 'UNVERIFIED_SAFE_STOP';

/** Diagnostic only: returns no secret and NEVER rotates, saves or deletes a record. */
export async function checkCredentialReadOnly(filePath: string, cipher: Pick<AsyncCipher, 'isAvailable' | 'decrypt'>): Promise<LocalCredentialOutcome> {
  try { if (!(await cipher.isAvailable())) return 'SECURE_STORAGE_UNAVAILABLE'; }
  catch { return 'SECURE_STORAGE_UNAVAILABLE'; }
  let encrypted: Buffer;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 16_384) return 'UNVERIFIED_SAFE_STOP';
    encrypted = fs.readFileSync(filePath);
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'CREDENTIAL_ENTRY_MISSING' : 'CREDENTIAL_READ_ERROR';
  }
  let decoded: { result: string; shouldReEncrypt: boolean } | undefined;
  try {
    try { decoded = await cipher.decrypt(encrypted); }
    catch { return 'CREDENTIAL_DECRYPTION_FAILED'; }
    return typeof decoded?.result === 'string' && validateApiKey(decoded.result) ? 'AVAILABLE_LOCALLY' : 'UNVERIFIED_SAFE_STOP';
  } finally {
    encrypted.fill(0);
    decoded = undefined; // Release our reference; JavaScript cannot guarantee physical erasure.
  }
}

export function validateApiKey(raw: string): boolean {
  const key = raw.trim();
  return key.length >= 8 && key.length <= 200 && /^[A-Za-z0-9_\-.]+$/.test(key);
}

export function createMemoryVault(encryptionAvailable = true): KeyVault {
  let secret: string | null = null;
  return {
    available: () => encryptionAvailable,
    async prepare(): Promise<void> {},
    async save(value: string): Promise<KeySaveResult> {
      if (!validateApiKey(value)) {
        return 'rejected';
      }
      if (!encryptionAvailable) {
        return 'unavailable';
      }
      secret = value.trim();
      return 'saved';
    },
    present(): boolean {
      return encryptionAvailable && secret !== null;
    },
    async load(): Promise<string | null> {
      if (!encryptionAvailable) {
        return null;
      }
      return secret;
    },
    clear(): void {
      secret = null;
    },
  };
}

/** Ciphertext file. `decrypt` may read an older blob and ask for it to be rewritten. */
export function createFileVault(filePath: string, cipher: AsyncCipher): KeyVault {
  let encryption: boolean | null = null;
  let loadStatus: CredentialLoadStatus = 'CREDENTIAL_ACCESS_UNVERIFIED';
  const ready = async (): Promise<boolean> => {
    if (encryption !== null) {
      return encryption;
    }
    try {
      encryption = await cipher.isAvailable();
    } catch {
      encryption = false;
    }
    return encryption;
  };
  return {
    diagnosticStatus: () => loadStatus,
    available(): boolean {
      return encryption === true;
    },
    async prepare(): Promise<void> {
      await ready();
    },
    async save(secret: string): Promise<KeySaveResult> {
      if (!validateApiKey(secret)) {
        return 'rejected';
      }
      if (!(await ready())) {
        return 'unavailable';
      }
      try {
        const cipherText = await cipher.encrypt(secret.trim());
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, cipherText);
        return 'saved';
      } catch {
        return 'unavailable';
      }
    },
    present(): boolean {
      return encryption === true && fs.existsSync(filePath);
    },
    async load(): Promise<string | null> {
      if (!(await ready())) {
        loadStatus = 'SECURE_STORAGE_UNAVAILABLE';
        return null;
      }
      let encrypted: Buffer;
      try {
        const metadata = fs.lstatSync(filePath);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0 || metadata.size > 16_384) {
          loadStatus = 'CREDENTIAL_RECORD_INVALID'; return null;
        }
        encrypted = fs.readFileSync(filePath);
      } catch (error) {
        loadStatus = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'CREDENTIAL_ENTRY_MISSING' : 'CREDENTIAL_LOOKUP_ERROR';
        return null;
      }
      try {
        const decoded = await cipher.decrypt(encrypted);
        if (!validateApiKey(decoded.result)) {
          loadStatus = 'CREDENTIAL_RECORD_INVALID';
          return null;
        }
        if (decoded.shouldReEncrypt) {
          const next = await cipher.encrypt(decoded.result);
          fs.writeFileSync(filePath, next);
        }
        loadStatus = 'AVAILABLE'; return decoded.result;
      } catch {
        // Failure may mean another crypto profile, temporary OS failure or I/O.
        // Never erase ciphertext as a side effect of a read/decrypt failure.
        loadStatus = 'CREDENTIAL_LOOKUP_ERROR';
        return null;
      }
    },
    clear(): void {
      fs.rmSync(filePath, { force: true });
    },
  };
}
