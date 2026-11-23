/**
 * Encrypted personal memories in userData.
 * The file is ciphertext. Memory text is never written to the log.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyMemoryChange,
  emptyMemoryDocument,
  parseMemoryDocument,
  selectContextNotes,
  serializeMemoryDocument,
  type MemoryChange,
  type MemoryDocument,
} from '../shared/personalMemory.ts';

const FILE_LIMIT = 65_536;

export interface MemoryCipher {
  isAvailable(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(encrypted: Buffer): Promise<{ text: string; refresh: boolean }>;
}

export interface MemorySnapshot {
  ok: true;
  available: boolean;
  readable: boolean;
  revision: number;
  useInChat: boolean;
  count: number;
  items: readonly { id: string; text: string }[];
}

export type MemoryStoreResult =
  | { ok: true; revision: number; count: number; useInChat: boolean }
  | { ok: false; reason: 'unavailable' | 'unreadable' | 'stale' | 'full' | 'invalid' | 'missing' | 'secret' | 'too-long' | 'unsuitable' | 'empty' };

export interface PersonalMemoryStore {
  load(): Promise<void>;
  snapshot(): Promise<MemorySnapshot>;
  contextNotes(): readonly string[] | null;
  publicState(): { useInChat: boolean; count: number; available: boolean; readable: boolean; revision: number };
  create(text: string, revision: number): Promise<MemoryStoreResult>;
  update(id: string, text: string, revision: number): Promise<MemoryStoreResult>;
  remove(id: string, revision: number): Promise<MemoryStoreResult>;
  clear(revision: number): Promise<MemoryStoreResult>;
  setUse(enabled: boolean, revision: number): Promise<MemoryStoreResult>;
}

export function createPersonalMemoryStore(
  filePath: string,
  cipher: MemoryCipher,
  clock?: { now?: () => number; id?: () => string },
): PersonalMemoryStore {
  let phase: 'loading' | 'ready' | 'unreadable' | 'unavailable' = 'loading';
  let document: MemoryDocument = emptyMemoryDocument();
  let chain: Promise<void> = Promise.resolve();
  let loaded = false;

  const now = (): number => clock?.now?.() ?? Date.now();
  const nextId = (): string => clock?.id?.() ?? randomBytes(8).toString('hex');

  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };

  const readFromDisk = async (): Promise<void> => {
    let available = false;
    try {
      available = await cipher.isAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      phase = 'unavailable';
      document = emptyMemoryDocument();
      return;
    }
    let encrypted: Buffer;
    try {
      const metadata = fs.lstatSync(filePath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0 || metadata.size > FILE_LIMIT) {
        phase = 'unreadable';
        return;
      }
      encrypted = fs.readFileSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        phase = 'ready';
        document = emptyMemoryDocument();
        return;
      }
      phase = 'unreadable';
      return;
    }
    try {
      const decoded = await cipher.decrypt(encrypted);
      const parsed = parseMemoryDocument(decoded.text);
      if (!parsed.ok) {
        phase = 'unreadable';
        return;
      }
      document = parsed.document;
      phase = 'ready';
      if (decoded.refresh) {
        await writeCipher(serializeMemoryDocument(document));
      }
    } catch {
      phase = 'unreadable';
    }
  };

  const ensure = async (): Promise<void> => {
    if (loaded) {
      return;
    }
    await readFromDisk();
    loaded = true;
  };

  const writeCipher = async (plain: string): Promise<void> => {
    const cipherText = await cipher.encrypt(plain);
    if (cipherText.includes(Buffer.from(plain))) {
      throw new Error('cipher left the document readable');
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, cipherText);
    fs.renameSync(temporary, filePath);
  };

  const mutate = (change: MemoryChange): Promise<MemoryStoreResult> => exclusive(async () => {
    await ensure();
    if (phase === 'unavailable') {
      return { ok: false, reason: 'unavailable' };
    }
    if (phase !== 'ready') {
      return { ok: false, reason: 'unreadable' };
    }
    const applied = applyMemoryChange(document, change);
    if (!applied.ok) {
      return { ok: false, reason: applied.reason };
    }
    if (applied.changed) {
      try {
        await writeCipher(serializeMemoryDocument(applied.document));
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
      document = applied.document;
    }
    return { ok: true, revision: document.revision, count: document.items.length, useInChat: document.useInChat };
  });

  return {
    load(): Promise<void> {
      return exclusive(async () => {
        await ensure();
      });
    },
    snapshot(): Promise<MemorySnapshot> {
      return exclusive(async () => {
        await ensure();
        const readable = phase === 'ready';
        return {
          ok: true,
          available: phase !== 'unavailable',
          readable,
          revision: readable ? document.revision : 0,
          useInChat: readable ? document.useInChat : false,
          count: readable ? document.items.length : 0,
          items: readable ? document.items.map((item) => ({ id: item.id, text: item.text })) : [],
        };
      });
    },
    contextNotes(): readonly string[] | null {
      if (phase !== 'ready') {
        return null;
      }
      return selectContextNotes(document);
    },
    publicState() {
      const readable = phase === 'ready';
      return {
        useInChat: readable ? document.useInChat : false,
        count: readable ? document.items.length : 0,
        available: phase !== 'unavailable' && phase !== 'loading',
        readable,
        revision: readable ? document.revision : 0,
      };
    },
    create(text, revision) {
      return mutate({ type: 'create', text, revision, id: nextId(), now: now() });
    },
    update(id, text, revision) {
      return mutate({ type: 'update', id, text, revision, now: now() });
    },
    remove(id, revision) {
      return mutate({ type: 'delete', id, revision });
    },
    clear(revision) {
      return mutate({ type: 'clear', revision });
    },
    setUse(enabled, revision) {
      return mutate({ type: 'use', enabled, revision });
    },
  };
}
