import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('tts pilot html requires an explicit button click to speak', async () => {
  const html = await readFile(path.join(here, 'tts-pilot.html'), 'utf8');
  assert.equal(html.includes('Nothing plays until you press a button'), true);
  assert.equal(/speechSynthesis\.speak\(/.test(html), true);
  assert.equal(html.includes('DOMContentLoaded') && html.includes('.click()'), false);
});

test('tts pilot is not wired into production vite inputs or chat', async () => {
  const vite = await readFile(path.join(root, 'vite.config.mts'), 'utf8');
  const chat = await readFile(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  assert.equal(vite.includes('tts-pilot'), false);
  assert.equal(chat.includes('speechSynthesis'), false);
  assert.equal(chat.includes('TextToSpeech'), false);
});

test('qwen provider and ASR guard remain unchanged by tts pilot files', async () => {
  const qwen = await readFile(path.join(root, 'src/shared/qwenProvider.ts'), 'utf8');
  const speech = await readFile(path.join(root, 'src/main/localSpeech.ts'), 'utf8');
  assert.equal(qwen.includes('enable_thinking: false'), true);
  assert.equal(speech.includes('MINIMUM_ASR_AVAILABLE_BYTES'), true);
});
