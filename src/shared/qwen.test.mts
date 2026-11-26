import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decidePointerMode, INITIAL_POINTER_STATE } from './clickThrough.ts';
import { BEHAVIOR_PHASES } from './ipc.ts';
import { contentSecurityPolicy } from './csp.ts';
import { DEMO_GREETING, demoReply } from './demoConversation.ts';
import { boundDemoPace, createDemoProvider, DEMO_PACE_CAP_MS, DEMO_REPLY_MS, DEMO_THINK_MS } from './demoProvider.ts';
import { MAX_OUTPUT_TOKENS, modelMessages, SYSTEM_PROMPT } from './conversationPolicy.ts';
import { createConversationSession, type PublicStatus, type SessionLine, type TurnEvent } from './conversationSession.ts';
import { createFileVault, createMemoryVault, validateApiKey } from './keyVault.ts';
import { applyPresence } from './presence.ts';
import { ambientPose } from './ambientMotion.ts';
import { presentCharacter } from './presentation.ts';
import { classifyProviderHttp, providerFailureMessage } from './providerErrors.ts';
import { chatCompletionsUrl, parseSingaporeEndpoint, QWEN_MODEL_ID, sanitizeStoredSettings } from './qwenEndpoint.ts';
import { createQwenProvider, type QwenEvent } from './qwenProvider.ts';
import { createSseParser } from './qwenSse.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const ENDPOINT = 'https://fixture-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const KEY = 'test-key-1';

test('Singapore workspace endpoints are the only accepted Model Studio URLs', () => {
  assert.equal(parseSingaporeEndpoint(ENDPOINT).ok, true);
  assert.equal(
    chatCompletionsUrl(`${ENDPOINT}/chat/completions`),
    `${ENDPOINT}/chat/completions`,
  );
  assert.equal(parseSingaporeEndpoint('https://fixture-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1').ok, false);
  assert.equal(parseSingaporeEndpoint('https://fixture-workspace.us-east-1.maas.aliyuncs.com/compatible-mode/v1').ok, false);
  assert.equal(parseSingaporeEndpoint('https://dashscope-intl.aliyuncs.com/compatible-mode/v1').ok, false);
  assert.equal(parseSingaporeEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1').ok, false);
  assert.equal(parseSingaporeEndpoint(ENDPOINT.replace('https://', 'http://')).ok, false);
  assert.equal(parseSingaporeEndpoint(`${ENDPOINT}?x=1`).ok, false);
  assert.equal(parseSingaporeEndpoint(`${ENDPOINT}#key`).ok, false);
  assert.equal(parseSingaporeEndpoint(ENDPOINT.replace('https://', 'https://user:secret@')).ok, false);
  assert.equal(parseSingaporeEndpoint(ENDPOINT.replace('.com', '.com:8443')).ok, false);
  assert.equal(parseSingaporeEndpoint('https://evil.example/compatible-mode/v1').ok, false);
  assert.equal(QWEN_MODEL_ID, 'qwen3.7-plus');
});

test('stored settings drop secrets and reject a non-Singapore endpoint', () => {
  const clean = sanitizeStoredSettings({ provider: 'qwen', endpoint: ENDPOINT, apiKey: KEY, token: 'nope' });
  assert.equal(clean.strippedSecret, true);
  assert.equal(clean.endpoint, ENDPOINT);
  assert.equal(JSON.stringify(clean).includes(KEY), false);
  const rejected = sanitizeStoredSettings({
    provider: 'qwen',
    endpoint: 'https://fixture-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    authorization: KEY,
  });
  assert.equal(rejected.endpoint, null);
  assert.equal(rejected.strippedSecret, true);
});

test('SSE parser accepts split chunks and ignores empty deltas', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":"Hel"'), []);
  assert.deepEqual(parser.push('}}]}\r\n\r\n'), [{ type: 'delta', text: 'Hel' }]);
  assert.deepEqual(parser.push('data: {"choices":[{"delta":{"content":""}}]}\n\n'), []);
  assert.deepEqual(parser.push(': keep-alive\n\n'), []);
  assert.deepEqual(parser.push('data: {"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n'), [
    { type: 'usage', promptTokens: 4, completionTokens: 2, reasoningTokens: null, totalTokens: null },
  ]);
  const reasoning = createSseParser();
  const hidden = reasoning.push(
    'data: {"choices":[{"delta":{"content":null,"reasoning_content":"private-chain"}}]}\n\n',
  );
  assert.deepEqual(hidden, [{ type: 'activity' }]);
  assert.equal(JSON.stringify(hidden).includes('private-chain'), false);
  const mixed = createSseParser();
  const visible = mixed.push(
    'data: {"choices":[{"delta":{"content":"Hi","reasoning_content":"private-chain"}}]}\n\n',
  );
  assert.deepEqual(visible, [{ type: 'delta', text: 'Hi' }]);
  assert.deepEqual(
    createSseParser().push(
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":12,"total_tokens":22,"completion_tokens_details":{"reasoning_tokens":4}}}\n\n',
    ),
    [{ type: 'usage', promptTokens: 10, completionTokens: 12, reasoningTokens: 4, totalTokens: 22 }],
  );
  assert.deepEqual(parser.push('data: [DONE]\n\n'), [{ type: 'done' }]);
  const broken = createSseParser();
  assert.deepEqual(broken.push('not-sse\n'), [{ type: 'malformed' }]);
  const unfinished = createSseParser();
  unfinished.push('data: {');
  assert.deepEqual(unfinished.flush(), [{ type: 'malformed' }]);
});

test('streaming provider reads partial chunks once and does not retry', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const body =
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
    'data: {"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n' +
    'data: [DONE]\n\n';
  const provider = createQwenProvider({
    fetchImpl: recordingFetch(seen, () => streamResponse(body, 17)),
    endpoint: ENDPOINT,
    apiKey: KEY,
    model: QWEN_MODEL_ID,
    maxTokens: MAX_OUTPUT_TOKENS,
    completionsUrl: chatCompletionsUrl,
    classifyHttp: classifyProviderHttp,
    createParser: createSseParser,
  });
  const events: QwenEvent[] = [];
  for await (const event of provider.send([{ role: 'user', text: 'Hi' }], new AbortController().signal)) {
    events.push(event);
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, `${ENDPOINT}/chat/completions`);
  assert.equal(seen[0]?.init.redirect, 'error');
  assert.equal(seen[0]?.init.method, 'POST');
  const headers = seen[0]?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  const payload = JSON.parse(String(seen[0]?.init.body)) as Record<string, unknown>;
  assert.equal(payload.model, 'qwen3.7-plus');
  assert.equal(payload.stream, true);
  assert.deepEqual(payload.stream_options, { include_usage: true });
  assert.equal(payload.max_tokens, 256);
  assert.equal(payload.enable_thinking, false);
  assert.equal('tools' in payload, false);
  assert.deepEqual(events.map((event) => event.type), ['open', 'delta', 'delta', 'usage', 'done']);
});

test('provider maps authentication, rate limit, quota, and malformed replies', async () => {
  assert.equal(await providerError(401, '{"code":"invalid_api_key"}'), 'authentication');
  assert.equal(await providerError(429, 'Rate limit reached for requests'), 'rate-limit');
  assert.equal(
    await providerError(429, 'You exceeded your current quota, please check your plan and billing details'),
    'quota',
  );
  assert.equal(await providerError(200, 'data: {"error":{"message":"bad"}}\n\n'), 'malformed');
  assert.equal(await providerError(400, 'bad request'), 'invalid');
  assert.equal(await providerError(504, 'gateway timeout'), 'timeout');
});

test('a cancelled stream and a timeout each make one request', async () => {
  let calls = 0;
  const session = qwenSession({
    fetchImpl: (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    },
    firstTokenMs: 40,
  });
  await arm(session);
  const hanging = session.send('hello');
  await wait(5);
  session.stop();
  await hanging;
  assert.equal(calls, 1);
  assert.equal(session.status().notice, providerFailureMessage('cancelled'));
  assert.equal(session.status().presence, 'IDLE');
  assert.equal(session.status().busy, false);

  let timed = 0;
  const slow = qwenSession({
    fetchImpl: () => {
      timed += 1;
      return new Promise(() => {});
    },
    connectMs: 30,
  });
  await arm(slow);
  await slow.send('hello');
  assert.equal(timed, 1);
  assert.equal(slow.status().notice, providerFailureMessage('connection-timeout'));
  assert.equal(slow.status().presence, 'ERROR');
});

test('reasoning stays hidden until visible text, which has its own timeout', async () => {
  const presences: string[] = [];
  const session = qwenSession({
    fetchImpl: () => Promise.reject(new Error('unused')),
    createProvider: () => ({
      async *send() {
        yield { type: 'open' as const };
        yield { type: 'activity' as const };
        yield { type: 'delta' as const, text: 'Hola' };
        yield { type: 'done' as const };
      },
    }),
    onStatus(status) {
      presences.push(status.presence);
    },
  });
  await arm(session);
  await session.send('hola');
  assert.equal(session.history().at(-1)?.text, 'Hola');
  assert.equal(JSON.stringify(session.history()).includes('private-chain'), false);
  assert.equal(presences.includes('ATTENTIVE'), false);
  assert.equal(presences.includes('THINKING'), true);
  assert.equal(presences.indexOf('THINKING') < presences.indexOf('RESPONDING'), true);
  assert.equal(presences.includes('RESPONDING'), true);
  assert.equal(session.status().presence, 'HAPPY');

  let opened = 0;
  const waiting = qwenSession({
    fetchImpl: () => Promise.reject(new Error('unused')),
    firstTokenMs: 40,
    createProvider: () => ({
      async *send(_messages: unknown, signal: AbortSignal) {
        opened += 1;
        yield { type: 'open' as const };
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
      },
    }),
  });
  await arm(waiting);
  await waiting.send('hello');
  assert.equal(opened, 1);
  assert.equal(waiting.status().notice, providerFailureMessage('timeout'));
  assert.equal(waiting.history().some((line) => line.role === 'assistant'), false);
});

test('Qwen session streams, caps output, and keeps reported usage separate from billing', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const deltas: string[] = [];
  const session = qwenSession({
    fetchImpl: recordingFetch(seen, () =>
      streamResponse('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: [DONE]\n\n', 20),
    ),
    onDelta(text) {
      deltas.push(text);
    },
  });
  await arm(session);
  await session.send('Hola');
  assert.deepEqual(deltas, ['Hola']);
  assert.equal(session.history().at(-1)?.role, 'assistant');
  assert.equal(session.history().at(-1)?.text, 'Hola');
  const request = JSON.parse(String(seen[0]?.init.body)) as { messages: Array<{ content: string }> };
  assert.equal(request.messages[0]?.content, SYSTEM_PROMPT);
  assert.equal(JSON.stringify(session.status()).includes(KEY), false);

  const long = qwenSession({
    createProvider: () => ({
      async *send(): AsyncIterable<TurnEvent> {
        yield { type: 'usage', promptTokens: 9, completionTokens: 8, reasoningTokens: null, totalTokens: null };
        yield { type: 'delta', text: 'x'.repeat(2000) };
        yield { type: 'done' };
      },
    }),
  });
  await arm(long);
  await long.send('count');
  assert.equal(long.history().at(-1)?.text.length, 1600);
  assert.deepEqual(long.status().usage, {
    promptTokens: 9,
    completionTokens: 8,
    reasoningTokens: null,
    totalTokens: null,
  });
  assert.equal(long.status().notice, null);
});

test('missing key, bad endpoint, invalid key, and credential removal fail closed', async () => {
  const session = qwenSession({ fetchImpl: () => Promise.reject(new Error('should not send')) });
  session.setProvider('qwen');
  await session.send('hello');
  assert.equal(session.status().notice, providerFailureMessage('missing-endpoint'));
  assert.equal(session.setEndpoint('https://fixture-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'), 'rejected');
  assert.equal(session.setEndpoint(ENDPOINT), 'saved');
  await session.send('hello');
  assert.equal(session.status().notice, providerFailureMessage('missing-key'));
  assert.equal(await session.saveKey('bad key'), 'rejected');
  assert.equal(await session.saveKey(KEY), 'saved');
  assert.equal(session.status().key, 'saved');
  session.removeKey();
  assert.equal(session.status().key, 'missing');
  assert.equal(JSON.stringify(session.status()).includes(KEY), false);
  assert.equal(validateApiKey('short'), false);

  const locked = qwenSession({
    fetchImpl: () => Promise.reject(new Error('should not send')),
    encryptionAvailable: false,
  });
  locked.setProvider('qwen');
  locked.setEndpoint(ENDPOINT);
  assert.equal(await locked.saveKey(KEY), 'unavailable');
  assert.equal(locked.status().key, 'unavailable');
  await locked.send('hello');
  assert.equal(locked.status().notice, providerFailureMessage('encryption-unavailable'));
});

test('one request at a time, with no provider change during that request', async () => {
  let calls = 0;
  let opened: (() => void) | null = null;
  const session = qwenSession({
    fetchImpl: (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        opened?.();
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    },
    firstTokenMs: 5_000,
  });
  await arm(session);
  const gate = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const first = session.send('hello');
  await gate;
  const notices: Array<string | null> = [];
  const original = session.status();
  assert.equal(original.busy, true);
  await session.send('again');
  notices.push(session.status().notice);
  assert.equal(session.setProvider('demo'), 'rejected');
  assert.equal(session.status().provider, 'qwen');
  assert.equal(calls, 1);
  assert.equal(notices[0], null);
  session.stop();
  await first;
  assert.equal(calls, 1);
});

test('busy send reports the busy notice without dropping the active reply', async () => {
  let opened: (() => void) | null = null;
  const notices: Array<string | null> = [];
  const session = qwenSession({
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        opened?.();
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      }),
    firstTokenMs: 5_000,
    onStatus(status) {
      notices.push(status.notice);
    },
  });
  await arm(session);
  const gate = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const first = session.send('hello');
  await gate;
  await session.send('second');
  assert.equal(notices.at(-1), providerFailureMessage('busy'));
  assert.equal(session.status().busy, true);
  session.stop();
  await first;
  assert.equal(session.status().presence, 'IDLE');
  assert.equal(session.status().notice, providerFailureMessage('cancelled'));
});

test('demo mode never calls the network and survives close and reopen', async () => {
  let calls = 0;
  const gestures: string[] = [];
  const session = qwenSession({
    fetchImpl: () => {
      calls += 1;
      return Promise.reject(new Error('offline'));
    },
    onGesture(gesture) {
      gestures.push(gesture);
    },
  });
  await session.send('Hello');
  session.stop();
  await session.send('Hello');
  assert.equal(calls, 0);
  assert.deepEqual(gestures, ['greet', 'greet']);
  assert.equal(session.history().length, 4);
  assert.equal(session.history()[1]?.role, 'demo');
  assert.equal(session.history()[1]?.text, DEMO_GREETING);
  assert.equal(session.status().provider, 'demo');
});

test('user text and model context stay inside the local limits', async () => {
  const session = qwenSession({ fetchImpl: () => Promise.reject(new Error('no')) });
  await session.send(` ${'a'.repeat(501)} `);
  assert.equal(session.history().length, 0);
  const lines: SessionLine[] = [];
  for (let index = 0; index < 8; index += 1) {
    lines.push({ role: 'user', text: `u${index}` }, { role: 'demo', text: 'demo line' }, { role: 'assistant', text: `a${index}` });
  }
  const messages = modelMessages(lines);
  const users = messages.filter((message) => message.role === 'user');
  assert.equal(users.length, 6);
  assert.equal(users[0]?.text, 'u2');
  assert.equal(messages.some((message) => message.text === 'demo line'), false);
  assert.equal(messages[0]?.role, 'system');
});

test('authentication failure is shown once and is not retried', async () => {
  let calls = 0;
  const session = qwenSession({
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(new Response('Incorrect API key', { status: 401 }));
    },
  });
  await arm(session);
  await session.send('hello');
  assert.equal(calls, 1);
  assert.equal(session.status().notice, providerFailureMessage('authentication'));
  assert.equal(session.status().presence, 'ERROR');
  assert.equal(session.status().provider, 'qwen');
  assert.equal(session.status().model, 'qwen3.7-plus');
  assert.equal(session.history().length, 1);
  assert.equal(session.history()[0]?.role, 'user');
  await session.send('hello again');
  assert.equal(calls, 2);
  assert.equal(session.history().filter((line) => line.role === 'user').length, 2);
  assert.equal(session.history().some((line) => line.role === 'assistant'), false);
});

test('presence does not change a sleeping robot, and click-through stays passthrough', () => {
  const asleep = { glow: 0.18, antenna: 0.42, hover: 0, blink: 0.8 };
  assert.equal(applyPresence(asleep, 'THINKING', 0, 1000, false), asleep);
  assert.equal(applyPresence(asleep, 'ERROR', 0.5, 1000, false), asleep);
  assert.equal(applyPresence(asleep, 'HAPPY', 0, 1000, false), asleep);
  assert.equal(applyPresence(asleep, 'SPEAKING', 0, 1000, false), asleep);
  const resting = { glow: 1, antenna: 0, hover: 0, blink: 0 };
  assert.equal(applyPresence(resting, 'IDLE', 1, 0, true), resting);
  const cheerful = applyPresence(resting, 'HAPPY', 1, 0, true);
  assert.equal(cheerful.glow > resting.glow, true);
  assert.equal(cheerful.antenna < resting.antenna, true);
  assert.equal(cheerful.blink, 0);
  const awake = applyPresence({ glow: 1, antenna: 0, hover: 0, blink: 0 }, 'THINKING', 1, 0, true);
  assert.equal(awake.glow, 1.12);
  assert.equal(awake.antenna, -0.16);
  assert.equal(awake.blink, 0);
  assert.equal((awake.eyeScale ?? 1) < 1, true);
  assert.equal((awake.eyeScale ?? 0) > 0.6, true);
  assert.deepEqual(BEHAVIOR_PHASES, ['SLEEPING', 'WAKING', 'IDLE', 'TRACKING', 'RETURNING_TO_SLEEP']);
  const pointer = decidePointerMode(null, INITIAL_POINTER_STATE, {
    visible: true,
    recoveryCapture: false,
    now: 0,
  });
  assert.equal(pointer.mode, 'passthrough');
});

test('chat IPC and storage stay out of the renderer', () => {
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  const html = readFileSync(path.join(root, 'src/renderer/chat.html'), 'utf8');
  const preload = readFileSync(path.join(root, 'src/preload/chatPreload.ts'), 'utf8');
  const robotPreload = readFileSync(path.join(root, 'src/preload/preload.ts'), 'utf8');
  const windowSource = readFileSync(path.join(root, 'src/main/chatWindow.ts'), 'utf8');
  for (const source of [chat, html, preload, robotPreload]) {
    assert.equal(source.includes('localStorage'), false);
    assert.equal(source.includes('safeStorage'), false);
    assert.equal(source.includes('Authorization'), false);
  }
  assert.equal(preload.includes('type="password"') || html.includes('type="password"'), true);
  assert.equal(html.includes('Remove API key'), true);
  assert.equal(windowSource.includes('event.preventDefault()'), true);
  assert.equal(windowSource.includes('session.stop()'), true);
  assert.equal(contentSecurityPolicy(false).includes("connect-src 'none'"), true);
  assert.equal(demoReply('cursor').gesture, 'explain');
  assert.equal(html.includes('id="connection"'), true);
  assert.equal(html.includes('Stop-on-Exhaust'), true);
  assert.equal(html.includes('qwen3.7-plus'), true);
  assert.equal(html.includes('Alibaba Model Studio'), true);
  assert.equal(html.includes('Clear conversation'), true);
  assert.equal(html.includes('aria-label="Stop reply"'), true);
  assert.equal(chat.includes('resetConversation'), true);
  assert.equal(chat.includes('shouldFollowTranscript'), true);
  assert.equal(windowSource.includes('session.reset()'), true);
  assert.equal(windowSource.includes('writeFile'), false);
  const providerSource = readFileSync(path.join(root, 'src/shared/qwenProvider.ts'), 'utf8');
  assert.equal(providerSource.includes('enable_thinking: false'), true);
  assert.equal(providerSource.includes('DEMO_THINK_MS'), false);
  const robotPreloadPresence = robotPreload;
  for (const name of ['ATTENTIVE', 'THINKING', 'RESPONDING', 'SPEAKING', 'HAPPY', 'ERROR', 'IDLE', 'CLEAR']) {
    assert.equal(robotPreloadPresence.includes(`'${name}'`), true);
    assert.equal(preload.includes(`'${name}'`), true);
  }
  assert.equal(windowSource.includes('if (!options.dev'), true);
  assert.equal(windowSource.includes('chat:preview-presence') || windowSource.includes('chatPreviewPresence'), true);
  assert.equal(chat.includes('import.meta.env.DEV'), false);
  assert.equal(chat.includes('previewPresence'), false);
  assert.equal(html.includes('Developer Tools'), false);
  assert.equal(html.includes('Dev preview'), false);
  const store = readFileSync(path.join(root, 'src/main/safeCredentialStore.ts'), 'utf8');
  const chatMain = readFileSync(path.join(root, 'src/main/chatWindow.ts'), 'utf8');
  assert.equal(store.includes('isAsyncEncryptionAvailable'), true);
  assert.equal(store.includes('encryptStringAsync'), true);
  assert.equal(store.includes('decryptStringAsync'), true);
  assert.equal(/safeStorage\.encryptString\(/.test(store), false);
  assert.equal(/safeStorage\.decryptString\(/.test(store), false);
  assert.equal(/safeStorage\.isEncryptionAvailable\(/.test(store), false);
  assert.equal(store.includes('console.log'), false);
  assert.equal(chatMain.includes('model: QWEN_MODEL_ID'), true);
  assert.equal(robotPreload.includes("'m1.6'"), true);
  assert.equal(windowSource.includes('console.log(payload'), false);
});

test('demo pacing is capped and plays thinking before the reply', async () => {
  assert.equal(boundDemoPace(undefined, DEMO_THINK_MS), DEMO_THINK_MS);
  assert.equal(boundDemoPace(-5, DEMO_THINK_MS), DEMO_THINK_MS);
  assert.equal(boundDemoPace(50_000, DEMO_REPLY_MS), DEMO_PACE_CAP_MS);
  assert.equal(DEMO_THINK_MS <= DEMO_PACE_CAP_MS, true);
  assert.equal(DEMO_REPLY_MS <= DEMO_PACE_CAP_MS, true);

  const marks: Array<{ presence: string; at: number }> = [];
  let calls = 0;
  const session = qwenSession({
    fetchImpl: () => {
      calls += 1;
      return Promise.reject(new Error('demo must stay offline'));
    },
    demoThinkMs: 45,
    demoReplyMs: 45,
    happyMs: 40,
    onStatus(status) {
      marks.push({ presence: status.presence, at: Date.now() });
    },
  });
  const started = Date.now();
  await session.send('Hello');
  const thinking = marks.find((mark) => mark.presence === 'THINKING');
  const responding = marks.find((mark) => mark.presence === 'RESPONDING');
  const happy = marks.find((mark) => mark.presence === 'HAPPY');
  assert.ok(thinking);
  assert.ok(responding);
  assert.ok(happy);
  assert.equal(thinking.at <= responding.at, true);
  assert.equal(responding.at - thinking.at >= 30, true);
  assert.equal(happy.at - responding.at >= 30, true);
  assert.equal(happy.at - started < 400, true);
  assert.equal(calls, 0);
  assert.equal(session.history().some((line) => line.role === 'demo'), true);
  await wait(60);
  assert.equal(session.status().presence, 'IDLE');
});

test('stopping during demo thinking cancels before a reply', async () => {
  const started = Date.now();
  const session = qwenSession({
    fetchImpl: () => Promise.reject(new Error('demo must stay offline')),
    demoThinkMs: 300,
    demoReplyMs: 300,
  });
  const pending = session.send('Hello');
  await wait(20);
  session.stop();
  await pending;
  assert.equal(Date.now() - started < 250, true);
  assert.equal(session.status().notice, providerFailureMessage('cancelled'));
  assert.equal(session.status().presence, 'IDLE');
  assert.equal(session.history().some((line) => line.role === 'demo'), false);
  assert.equal(session.history().filter((line) => line.role === 'user').length, 1);
});

test('a happy timer does not replace a newer turn', async () => {
  let turns = 0;
  const session = qwenSession({
    fetchImpl: () => Promise.reject(new Error('unused')),
    happyMs: 40,
    createProvider: () => ({
      async *send(_messages: unknown, signal: AbortSignal) {
        turns += 1;
        if (turns === 1) {
          yield { type: 'delta' as const, text: 'Hi' };
          yield { type: 'done' as const };
          return;
        }
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
      },
    }),
  });
  await arm(session);
  await session.send('hi');
  assert.equal(session.status().presence, 'HAPPY');
  const second = session.send('again');
  await wait(70);
  assert.equal(session.status().busy, true);
  assert.equal(session.status().presence, 'THINKING');
  session.stop();
  await second;
  assert.equal(session.status().presence, 'IDLE');
  assert.equal(turns, 2);
});

test('conversation expressions stay off while asleep and show while awake', () => {
  const ambient = ambientPose(1_000);
  const asleep = presentCharacter({ ambient, alertness: 0, wakeBounce: 0, gazeYaw: 0, gazePitch: 0 });
  assert.equal(applyPresence(asleep, 'THINKING', 0, 1_000, false), asleep);
  assert.equal(applyPresence(asleep, 'HAPPY', 0.5, 1_000, false), asleep);
  const awake = presentCharacter({ ambient, alertness: 1, wakeBounce: 0, gazeYaw: 0, gazePitch: 0 });
  const thinking = applyPresence(awake, 'THINKING', 1, 0, true);
  const happy = applyPresence(awake, 'HAPPY', 1, 0, true);
  const idle = applyPresence(awake, 'IDLE', 1, 0, true);
  assert.equal(thinking.blink, awake.blink);
  assert.equal((thinking.eyeScale ?? 1) < 1, true);
  assert.equal((thinking.eyeScale ?? 0) > 0.6, true);
  assert.equal(thinking.antenna < awake.antenna, true);
  assert.equal(happy.glow > awake.glow, true);
  assert.equal((happy.eyeScale ?? 1) > 1, true);
  assert.equal(happy.wakeScale, awake.wakeScale);
  assert.equal((happy.tiltX ?? 0) < awake.tiltX, true);
  assert.equal(happy.antenna < awake.antenna, true);
  assert.equal(idle, awake);
});

test('a finished reply is briefly happy, then idle, without another request', async () => {
  let calls = 0;
  const presences: string[] = [];
  const session = qwenSession({
    fetchImpl: () => Promise.reject(new Error('unused')),
    happyMs: 30,
    createProvider: () => ({
      async *send() {
        calls += 1;
        yield { type: 'open' as const };
        yield { type: 'delta' as const, text: 'Hi' };
        yield { type: 'done' as const };
      },
    }),
    onStatus(status) {
      presences.push(status.presence);
    },
  });
  await arm(session);
  await session.send('hi');
  assert.equal(calls, 1);
  assert.equal(presences.includes('ATTENTIVE'), false);
  assert.equal(presences.includes('THINKING'), true);
  assert.equal(presences.indexOf('THINKING') < presences.indexOf('RESPONDING'), true);
  assert.equal(presences.includes('RESPONDING'), true);
  assert.equal(session.status().presence, 'HAPPY');
  await wait(50);
  assert.equal(session.status().presence, 'IDLE');
  assert.equal(calls, 1);
});

test('a failed reply returns to idle and a reset drops the transcript', async () => {
  let calls = 0;
  const session = qwenSession({
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(new Response('network down', { status: 503 }));
    },
    errorMs: 30,
  });
  await arm(session);
  await session.send('hello');
  assert.equal(calls, 1);
  assert.equal(session.status().presence, 'ERROR');
  assert.equal(session.status().notice, providerFailureMessage('unavailable'));
  assert.equal(session.history().length, 1);
  await wait(50);
  assert.equal(session.status().presence, 'IDLE');
  session.reset();
  assert.equal(session.history().length, 0);
  assert.equal(session.status().notice, null);
  assert.equal(session.status().usage, null);
  assert.equal(calls, 1);
});

test('reset stops an in-flight reply and does not send it again', async () => {
  let calls = 0;
  const session = qwenSession({
    fetchImpl: (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    },
    firstTokenMs: 5_000,
  });
  await arm(session);
  const pending = session.send('hello');
  await wait(5);
  session.reset();
  await pending;
  assert.equal(calls, 1);
  assert.equal(session.history().length, 0);
  assert.equal(session.status().busy, false);
  assert.equal(session.status().presence, 'IDLE');
});

test('a dummy key is encrypted outside user data and can be removed', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'desktop-companion-vault-'));
  const filePath = path.join(directory, 'dummy-key.bin');
  const marker = 'dummy-key-1';
  let sealed = Buffer.from('legacy');
  const vault = createFileVault(filePath, {
    async isAvailable(): Promise<boolean> {
      return true;
    },
    async encrypt(plain: string): Promise<Buffer> {
      return Buffer.from(`sealed:${plain}`);
    },
    async decrypt(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
      const text = encrypted.toString('utf8');
      if (text.startsWith('sealed:')) {
        return { result: text.slice('sealed:'.length), shouldReEncrypt: false };
      }
      return { result: marker, shouldReEncrypt: true };
    },
  });
  writeFileSync(filePath, sealed);
  await vault.prepare();
  const loaded = await vault.load();
  sealed = readFileSync(filePath);
  assert.equal(loaded, marker);
  assert.equal(sealed.toString('utf8'), `sealed:${marker}`);
  assert.equal(sealed.includes(Buffer.from('legacy')), false);
  vault.clear();
  assert.equal(existsSync(filePath), false);
  const blocked = createFileVault(filePath, {
    async isAvailable(): Promise<boolean> {
      return false;
    },
    async encrypt(): Promise<Buffer> {
      throw new Error('should not encrypt');
    },
    async decrypt(): Promise<{ result: string; shouldReEncrypt: boolean }> {
      throw new Error('should not decrypt');
    },
  });
  writeFileSync(filePath, Buffer.from('keep-me'));
  await blocked.prepare();
  assert.equal(await blocked.save(marker), 'unavailable');
  assert.equal(readFileSync(filePath).toString('utf8'), 'keep-me');
  rmSync(directory, { recursive: true, force: true });
});

function streamResponse(body: string, splitAt: number): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function recordingFetch(
  seen: Array<{ url: string; init: RequestInit }>,
  respond: () => Response,
): typeof fetch {
  return ((url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    return Promise.resolve(respond());
  }) as typeof fetch;
}

async function providerError(status: number, body: string): Promise<string> {
  const provider = createQwenProvider({
    fetchImpl: (() =>
      Promise.resolve(
        new Response(body, {
          status,
          headers: status === 200 ? { 'content-type': 'text/event-stream' } : undefined,
        }),
      )) as typeof fetch,
    endpoint: ENDPOINT,
    apiKey: KEY,
    model: QWEN_MODEL_ID,
    maxTokens: MAX_OUTPUT_TOKENS,
    completionsUrl: chatCompletionsUrl,
    classifyHttp: classifyProviderHttp,
    createParser: createSseParser,
  });
  for await (const event of provider.send([{ role: 'user', text: 'Hi' }], new AbortController().signal)) {
    if (event.type === 'error') {
      return event.code;
    }
  }
  return 'none';
}

function qwenSession(options: {
  fetchImpl: typeof fetch;
  connectMs?: number;
  firstTokenMs?: number;
  encryptionAvailable?: boolean;
  onDelta?: (text: string) => void;
  onStatus?: (status: PublicStatus) => void;
  onGesture?: (gesture: string) => void;
  happyMs?: number;
  errorMs?: number;
  demoThinkMs?: number;
  demoReplyMs?: number;
  createProvider?: (input: { endpoint: string; apiKey: string }) => { send: () => AsyncIterable<TurnEvent> };
}): {
  history: () => readonly SessionLine[];
  status: () => PublicStatus;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  setProvider: (provider: string) => 'saved' | 'rejected';
  setEndpoint: (raw: string) => 'saved' | 'rejected';
  saveKey: (raw: string) => Promise<'saved' | 'unavailable' | 'rejected'>;
  removeKey: () => void;
} {
  const vault = createMemoryVault(options.encryptionAvailable !== false);
  let settings = { provider: 'demo' as 'demo' | 'qwen', endpoint: null as string | null };
  const session = createConversationSession({
    vault,
    settings: {
      current: () => settings,
      update(next) {
        settings = { provider: next.provider, endpoint: next.endpoint };
      },
    },
    hooks: {
      history() {},
      delta(text) {
        options.onDelta?.(text);
      },
      status(status) {
        options.onStatus?.(status);
      },
      gesture(gesture) {
        options.onGesture?.(gesture);
      },
      presence() {},
    },
    createDemo: (text) =>
      createDemoProvider(demoReply, text, {
        thinkMs: options.demoThinkMs ?? 0,
        replyMs: options.demoReplyMs ?? 0,
      }),
    modelMessages,
    validateEndpoint: parseSingaporeEndpoint,
    validateKey: validateApiKey,
    failureMessage: providerFailureMessage,
    connectMs: options.connectMs,
    firstTokenMs: options.firstTokenMs,
    happyMs: options.happyMs,
    errorMs: options.errorMs,
    createQwen: (input) => {
      if (options.createProvider) {
        return options.createProvider(input);
      }
      return createQwenProvider({
        fetchImpl: options.fetchImpl,
        endpoint: input.endpoint,
        apiKey: input.apiKey,
        model: QWEN_MODEL_ID,
        maxTokens: MAX_OUTPUT_TOKENS,
        completionsUrl: chatCompletionsUrl,
        classifyHttp: classifyProviderHttp,
        createParser: createSseParser,
      });
    },
  });
  return session;
}

async function arm(session: {
  setProvider: (provider: string) => void;
  setEndpoint: (raw: string) => void;
  saveKey: (raw: string) => Promise<unknown>;
}): Promise<void> {
  session.setProvider('qwen');
  session.setEndpoint(ENDPOINT);
  await session.saveKey(KEY);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
