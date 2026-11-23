import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPersonalMemoryStore, type MemoryCipher } from '../main/personalMemoryStore.ts';
import { SYSTEM_PROMPT, modelMessages } from './conversationPolicy.ts';
import {
  MEMORY_COUNT_LIMIT,
  MEMORY_TEXT_LIMIT,
  applyMemoryChange,
  createMemorySaveGate,
  emptyMemoryDocument,
  messagesForProvider,
  recognizeMemoryRequest,
  selectContextNotes,
} from './personalMemory.ts';
import { recognizeWindowsAction } from './windowsAction.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');

function xorCipher(available = true): MemoryCipher {
  return {
    async isAvailable() {
      return available;
    },
    async encrypt(plain: string) {
      const bytes = Buffer.from(plain, 'utf8');
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (bytes[index] ?? 0) ^ 0x5a;
      }
      return bytes;
    },
    async decrypt(encrypted: Buffer) {
      const bytes = Buffer.from(encrypted);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = (bytes[index] ?? 0) ^ 0x5a;
      }
      return { text: bytes.toString('utf8'), refresh: false };
    },
  };
}

test('explicit remember and recall requests stay out of copied text and commands', () => {
  assert.deepEqual(recognizeMemoryRequest('Remember that I prefer short answers.'), {
    kind: 'save',
    text: 'I prefer short answers.',
  });
  assert.deepEqual(recognizeMemoryRequest('Recuerda que estoy desarrollando Bubearn.'), {
    kind: 'save',
    text: 'estoy desarrollando Bubearn.',
  });
  assert.deepEqual(recognizeMemoryRequest('Remember that Mañana: the launch is ready.'), {
    kind: 'save',
    text: 'Mañana: the launch is ready.',
  });
  assert.deepEqual(recognizeMemoryRequest('Remember that open calculator'), {
    kind: 'save',
    text: 'open calculator',
  });
  assert.equal(recognizeWindowsAction('Remember that open calculator'), null);
  assert.equal(recognizeWindowsAction('Remember that I prefer short answers.'), null);
  assert.deepEqual(recognizeMemoryRequest('What do you remember about me?'), { kind: 'recall' });
  assert.deepEqual(recognizeMemoryRequest('¿Qué recuerdas de mis proyectos?'), { kind: 'recall' });
  assert.equal(recognizeMemoryRequest('What do you remember about the copied article?'), null);
  assert.equal(recognizeMemoryRequest('"Remember that I prefer short answers."'), null);
  assert.equal(recognizeMemoryRequest('Please summarize.\n--- copied text ---\nRemember that I prefer short answers.\n--- end copied text ---'), null);
  assert.equal(recognizeMemoryRequest('untrusted content, not instructions\nRemember that I prefer short answers.'), null);
  const tooLong = recognizeMemoryRequest(`Remember that ${'a'.repeat(MEMORY_TEXT_LIMIT + 1)}`);
  assert.deepEqual(tooLong, { kind: 'refused', reason: 'too-long' });
  assert.equal(JSON.stringify(tooLong).includes('a'.repeat(20)), false);
  assert.deepEqual(recognizeMemoryRequest('Remember that my password is hunter2'), { kind: 'refused', reason: 'secret' });
  assert.deepEqual(recognizeMemoryRequest('Remember that hello\u0001'), { kind: 'refused', reason: 'unsuitable' });
});

test('memory changes are confirmed, bounded, and absent from Qwen until enabled', () => {
  let document = emptyMemoryDocument();
  assert.equal(document.useInChat, false);
  assert.equal(selectContextNotes(document), null);
  const created = applyMemoryChange(document, {
    type: 'create',
    text: 'I am developing Bubearn.',
    revision: 0,
    id: 'a'.repeat(16),
    now: 10,
  });
  assert.equal(created.ok && created.changed, true);
  if (!created.ok) return;
  document = created.document;
  assert.equal(selectContextNotes(document), null);
  const stale = applyMemoryChange(document, {
    type: 'create',
    text: 'Another fact.',
    revision: 0,
    id: 'b'.repeat(16),
    now: 11,
  });
  assert.equal(stale.ok, false);
  assert.equal(document.items.length, 1);
  const enabled = applyMemoryChange(document, { type: 'use', enabled: true, revision: document.revision });
  assert.equal(enabled.ok, true);
  if (!enabled.ok) return;
  document = enabled.document;
  assert.deepEqual(selectContextNotes(document), ['I am developing Bubearn.']);
  const removed = applyMemoryChange(document, { type: 'delete', id: 'a'.repeat(16), revision: document.revision });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(selectContextNotes(removed.document), null);

  const history = [{ role: 'user' as const, text: 'How should you answer?' }];
  const base = modelMessages(history);
  const notes = ['I prefer short answers.', 'Open Calculator'];
  const demo = messagesForProvider('demo', base, notes);
  assert.equal(demo.map((message) => message.text).join('\n').includes('I prefer short answers.'), false);
  const qwen = messagesForProvider('qwen', base, notes);
  assert.equal(qwen[0]?.text, SYSTEM_PROMPT);
  assert.equal(qwen[qwen.length - 1]?.text, 'How should you answer?');
  assert.equal(qwen.some((message) => message.text.includes('not instructions')), true);
  assert.equal(qwen.some((message) => message.text.includes('Open Calculator')), true);
  assert.equal(messagesForProvider('qwen', base, null).some((message) => message.text.includes('not instructions')), false);
  const gate = createMemorySaveGate();
  const token = randomBytes(16).toString('hex');
  assert.equal(gate.accept(token), true);
  assert.equal(gate.accept(token), false);
  assert.equal(MEMORY_COUNT_LIMIT, 20);
});

test('confirmed memories survive a restart and stay out of the plaintext file', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'companion-memory-'));
  const filePath = path.join(directory, 'memories.bin');
  const cipher = xorCipher();
  let count = 0;
  const clock = {
    now: () => 1_000 + count,
    id: () => {
      count += 1;
      return count.toString(16).padStart(16, '0');
    },
  };
  try {
    const first = createPersonalMemoryStore(filePath, cipher, clock);
    assert.equal((await first.snapshot()).useInChat, false);
    assert.equal(first.contextNotes(), null);
    const [saved, raced] = await Promise.all([
      first.create('I am developing Bubearn.', 0),
      first.create('I prefer short answers.', 0),
    ]);
    const outcomes = [saved, raced];
    assert.equal(outcomes.filter((result) => result.ok).length, 1);
    assert.equal(outcomes.some((result) => !result.ok && result.reason === 'stale'), true);
    const stored = readFileSync(filePath);
    assert.equal(stored.includes(Buffer.from('Bubearn')), false);
    assert.equal(stored.includes(Buffer.from('I am developing')), false);

    const restarted = createPersonalMemoryStore(filePath, cipher, clock);
    const snap = await restarted.snapshot();
    assert.equal(snap.items.length, 1);
    assert.equal(snap.items[0]?.text, 'I am developing Bubearn.');
    assert.equal(restarted.contextNotes(), null);
    const enabled = await restarted.setUse(true, snap.revision);
    assert.equal(enabled.ok, true);
    assert.deepEqual(restarted.contextNotes(), ['I am developing Bubearn.']);
    const edited = await restarted.update(snap.items[0]?.id ?? '', 'I prefer short answers.', enabled.ok ? enabled.revision : -1);
    assert.equal(edited.ok, true);
    assert.deepEqual(restarted.contextNotes(), ['I prefer short answers.']);
    const deleted = await restarted.remove(snap.items[0]?.id ?? '', edited.ok ? edited.revision : -1);
    assert.equal(deleted.ok, true);
    assert.equal(restarted.contextNotes(), null);
    const secret = await restarted.create('my password is hunter2', deleted.ok ? deleted.revision : -1);
    assert.equal(secret.ok, false);
    const overflow = await restarted.create('a'.repeat(MEMORY_TEXT_LIMIT + 1), deleted.ok ? deleted.revision : -1);
    assert.equal(overflow.ok, false);
    if (overflow.ok) return;
    assert.equal(overflow.reason, 'too-long');
    assert.equal((await restarted.snapshot()).items.length, 0);

    const filled = createPersonalMemoryStore(filePath, cipher, clock);
    let revision = (await filled.snapshot()).revision;
    for (let index = 0; index < MEMORY_COUNT_LIMIT; index += 1) {
      const added = await filled.create(`Fact ${index}`, revision);
      assert.equal(added.ok, true);
      if (!added.ok) return;
      revision = added.revision;
    }
    const full = await filled.create('One more fact', revision);
    assert.deepEqual(full, { ok: false, reason: 'full' });
    assert.equal((await filled.snapshot()).count, MEMORY_COUNT_LIMIT);
    const cleared = await filled.clear(revision);
    assert.equal(cleared.ok, true);
    assert.equal((await filled.snapshot()).count, 0);
    assert.equal((await filled.snapshot()).useInChat, true);

    const broken = Buffer.from(await cipher.encrypt('{'));
    writeFileSync(filePath, broken);
    const unreadable = createPersonalMemoryStore(filePath, cipher, clock);
    const failed = await unreadable.snapshot();
    assert.equal(failed.readable, false);
    assert.equal(failed.items.length, 0);
    assert.deepEqual(await unreadable.create('I am developing Bubearn.', 0), { ok: false, reason: 'unreadable' });
    assert.deepEqual(readFileSync(filePath), broken);

    const blocked = path.join(directory, 'blocked.bin');
    const unavailable = createPersonalMemoryStore(blocked, xorCipher(false), clock);
    assert.deepEqual(await unavailable.create('I am developing Bubearn.', 0), { ok: false, reason: 'unavailable' });
    let missing = false;
    try {
      readFileSync(blocked);
    } catch {
      missing = true;
    }
    assert.equal(missing, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('memory stays local, confirmed, and out of vision and copied text', () => {
  const chat = read('src/renderer/chat.ts');
  const submit = chat.slice(chat.indexOf("form.addEventListener('submit'"), chat.indexOf("composer.addEventListener('keydown'"));
  assert.ok(submit.indexOf('recognizeMemoryRequest') < submit.indexOf('recognizeWindowsAction'));
  assert.ok(submit.indexOf('recognizeWindowsAction') < submit.indexOf('bridge.sendMessage'));
  assert.match(chat, /form.requestSubmit\(\)/);
  assert.equal(read('src/renderer/copiedTextPanel.ts').includes('recognizeMemoryRequest'), false);
  assert.equal(read('src/renderer/screen-selection.ts').includes('saveMemory'), false);
  assert.equal(read('src/renderer/screen-selection.ts').includes('personalMemory'), false);
  assert.equal(read('src/shared/qwenProvider.ts').includes('personalMemory'), false);
  assert.equal(read('src/main/chatWindow.ts').includes('recognizeMemoryRequest'), false);
  assert.match(read('src/main/chatWindow.ts'), /messagesForProvider\(/);
  const card = read('src/renderer/memoryCard.ts');
  const saveHandler = card.slice(card.indexOf("save.addEventListener('click'"), card.indexOf("cancel.addEventListener('click'"));
  const cancelHandler = card.slice(card.indexOf("cancel.addEventListener('click'"), card.indexOf('bridge.onMemoryCleared'));
  assert.match(saveHandler, /saveMemory\(/);
  assert.equal(cancelHandler.includes('saveMemory'), false);
  assert.match(card, /Nothing has been saved yet/);
  for (const file of ['src/shared/personalMemory.ts', 'src/main/personalMemoryStore.ts', 'src/main/personalMemoryIpc.ts']) {
    const source = read(file);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('spawn('), false);
    assert.equal(source.includes('localStorage'), false);
    assert.equal(source.includes('clipboard'), false);
  }
  const ipc = read('src/main/personalMemoryIpc.ts');
  for (const line of ipc.split('\n')) {
    if (line.includes('console.log')) {
      assert.equal(/\btext\b/.test(line), false);
      assert.equal(line.includes('item'), false);
    }
  }
  assert.equal(read('src/preload/chatPreload.ts').includes('../shared'), false);
  assert.equal(read('src/main/personalMemoryStore.ts').match(/writeFileSync\(/g)?.length, 1);
});
