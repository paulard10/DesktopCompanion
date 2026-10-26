import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sendDisabledReason } from './chatGate.ts';
import { acceptUserMessage } from './demoConversation.ts';
import { createConversationSession } from './conversationSession.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('send stays available when Pablo is missing and only real work blocks it', () => {
  assert.equal(
    sendDisabledReason({ generating: false, microphoneBusy: false, ttsSpeaking: false, draftValid: true }),
    null,
  );
  assert.equal(
    sendDisabledReason({ generating: false, microphoneBusy: false, ttsSpeaking: true, draftValid: true }),
    'tts',
  );
  assert.equal(
    sendDisabledReason({ generating: true, microphoneBusy: false, ttsSpeaking: false, draftValid: true }),
    'generating',
  );
  const demo = acceptUserMessage([], 'Hola');
  assert.equal(demo.ok, true);
});

test('demo and mocked qwen sends do not depend on Pablo', async () => {
  const hooks = {
    history() {},
    delta() {},
    status() {},
    gesture() {},
    presence() {},
  };
  const demo = createConversationSession({
    vault: {
      available: () => true,
      present: () => false,
      load: async () => null,
      clear() {},
      save: async () => 'saved',
    },
    settings: {
      current: () => ({ provider: 'demo', endpoint: null }),
      update() {},
    },
    hooks,
    createDemo: () => ({
      gesture: 'nod',
      async *send() {
        yield { type: 'done' as const };
      },
    }),
    modelMessages: () => [],
    createQwen: () => {
      throw new Error('demo must not call qwen');
    },
    validateEndpoint: () => ({ ok: false }),
    validateKey: () => false,
    failureMessage: (code) => code,
    happyMs: 0,
    errorMs: 0,
  });
  await demo.send('Hola desde demo');
  assert.equal(demo.history().some((line) => line.role === 'user' && line.text === 'Hola desde demo'), true);

  let qwenCalls = 0;
  const qwen = createConversationSession({
    vault: {
      available: () => true,
      present: () => true,
      load: async () => 'test-key',
      clear() {},
      save: async () => 'saved',
    },
    settings: {
      current: () => ({ provider: 'qwen', endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }),
      update() {},
    },
    hooks,
    createDemo: () => {
      throw new Error('qwen mode must not use demo');
    },
    modelMessages: (history) => history.filter((line) => line.role === 'user').map((line) => ({ role: 'user' as const, text: line.text })),
    createQwen: () => ({
      async *send() {
        qwenCalls += 1;
        yield { type: 'delta' as const, text: 'respuesta' };
        yield { type: 'done' as const };
      },
    }),
    validateEndpoint: () => ({ ok: true as const, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }),
    validateKey: () => true,
    failureMessage: (code) => code,
    happyMs: 0,
    errorMs: 0,
  });
  await qwen.send('Hola qwen');
  assert.equal(qwenCalls, 1);
  assert.equal(qwen.history().some((line) => line.role === 'assistant'), true);
  assert.equal(sendDisabledReason({ generating: false, microphoneBusy: false, ttsSpeaking: false, draftValid: true }), null);
});

test('chat startup, ASR, and click-through stay independent of a missing voice', () => {
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  const css = readFileSync(path.join(root, 'src/renderer/chat.css'), 'utf8');
  const refresh = chat.slice(chat.indexOf('const refreshSend'), chat.indexOf('const scrollToEnd'));
  assert.equal(refresh.includes('refreshTtsUi'), false);
  assert.equal(refresh.includes('pabloReady'), false);
  assert.equal(chat.includes('bridge.notifyReady()'), true);
  assert.match(chat, /try \{\s*tts\.start\(\);\s*refreshSend\(\);\s*\} finally \{\s*bridge\.notifyReady\(\);/);
  assert.equal(css.includes('.tts-bar[hidden]'), true);
  const speech = readFileSync(path.join(root, 'src/renderer/speechCapture.ts'), 'utf8');
  const click = readFileSync(path.join(root, 'src/shared/clickThrough.ts'), 'utf8');
  const behavior = readFileSync(path.join(root, 'src/shared/behavior.ts'), 'utf8');
  assert.equal(speech.includes('speechSynthesis'), false);
  assert.equal(speech.includes('textToSpeech'), false);
  assert.equal(click.includes('speechSynthesis'), false);
  assert.equal(behavior.includes('speechSynthesis'), false);
});
