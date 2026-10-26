import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { finishPresenceTransition, presenceLogReason, resolveCharacterPresence, type PresenceSignals } from './characterPresence.ts';
import { eyeCueFromState } from './faceExpression.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const quiet: PresenceSignals = {
  speaking: false,
  voice: null,
  session: 'CLEAR',
  busy: false,
  preview: null,
};

test('recording, transcription, and an editable draft stay on the microphone path', () => {
  assert.deepEqual(resolveCharacterPresence(quiet), { presence: 'CLEAR', reason: 'cleared' });
  assert.deepEqual(resolveCharacterPresence({ ...quiet, voice: 'ATTENTIVE' }), { presence: 'ATTENTIVE', reason: 'mic-start' });
  assert.deepEqual(resolveCharacterPresence({ ...quiet, voice: 'THINKING' }), { presence: 'THINKING', reason: 'asr-start' });
  assert.deepEqual(resolveCharacterPresence({ ...quiet, voice: 'IDLE', session: 'HAPPY' }), { presence: 'IDLE', reason: 'draft-ready' });
  assert.deepEqual(resolveCharacterPresence({ ...quiet, voice: 'ERROR' }), { presence: 'ERROR', reason: 'voice-error' });
});

test('send, the first token, completion, cancel, and provider failure use the session', () => {
  assert.deepEqual(
    resolveCharacterPresence({ ...quiet, busy: true, session: 'THINKING' }),
    { presence: 'THINKING', reason: 'send' },
  );
  const streaming = resolveCharacterPresence({ ...quiet, busy: true, session: 'RESPONDING' });
  assert.deepEqual(streaming, { presence: 'RESPONDING', reason: 'first-token' });
  assert.deepEqual(resolveCharacterPresence({ ...quiet, busy: true, session: 'RESPONDING' }), streaming);
  assert.deepEqual(resolveCharacterPresence({ ...quiet, session: 'HAPPY' }), { presence: 'HAPPY', reason: 'reply-done' });
  assert.deepEqual(resolveCharacterPresence({ ...quiet, session: 'IDLE' }), { presence: 'IDLE', reason: 'idle' });
  assert.deepEqual(resolveCharacterPresence({ ...quiet, session: 'ERROR' }), { presence: 'ERROR', reason: 'provider-error' });
  assert.deepEqual(
    resolveCharacterPresence({ ...quiet, busy: false, session: 'RESPONDING' }),
    { presence: 'CLEAR', reason: 'cleared' },
  );
});

test('playback outranks text, and a draft does not look like a model request', () => {
  const speaking = resolveCharacterPresence({ ...quiet, speaking: true, session: 'HAPPY', voice: 'IDLE' });
  assert.deepEqual(speaking, { presence: 'SPEAKING', reason: 'tts-start' });
  assert.equal(resolveCharacterPresence({ ...quiet, session: 'HAPPY', speaking: false }).presence, 'HAPPY');
  assert.equal(resolveCharacterPresence({ ...quiet, voice: 'IDLE', busy: true, session: 'THINKING' }).reason, 'send');
  assert.equal(resolveCharacterPresence({ ...quiet, voice: 'ATTENTIVE', speaking: true }).presence, 'SPEAKING');
  assert.equal(resolveCharacterPresence({ ...quiet, voice: 'THINKING', session: 'HAPPY' }).presence, 'THINKING');
});

test('ending playback does not replay a celebration that speech already replaced', () => {
  const afterSpeech = finishPresenceTransition('tts-start', { presence: 'HAPPY', reason: 'reply-done' });
  assert.deepEqual(afterSpeech, { presence: 'IDLE', reason: 'idle' });
  assert.equal(presenceLogReason('SPEAKING', afterSpeech), 'tts-end');
  assert.deepEqual(
    finishPresenceTransition('first-token', { presence: 'HAPPY', reason: 'reply-done' }),
    { presence: 'HAPPY', reason: 'reply-done' },
  );
  assert.equal(presenceLogReason('RESPONDING', { presence: 'HAPPY', reason: 'reply-done' }), 'reply-done');
});

test('a development preview loses to real work and does not return after it', () => {
  assert.equal(resolveCharacterPresence({ ...quiet, preview: 'HAPPY' }).reason, 'preview');
  assert.equal(resolveCharacterPresence({ ...quiet, preview: 'SPEAKING', speaking: true }).reason, 'tts-start');
  assert.equal(resolveCharacterPresence({ ...quiet, preview: 'HAPPY', voice: 'ATTENTIVE' }).presence, 'ATTENTIVE');
  assert.equal(resolveCharacterPresence({ ...quiet, preview: 'HAPPY', busy: true, session: 'THINKING' }).reason, 'send');
  assert.equal(resolveCharacterPresence({ ...quiet, preview: null, session: 'IDLE' }).presence, 'IDLE');
});

test('sleep still closes the face and the lifecycle module stays free of devices', () => {
  assert.equal(eyeCueFromState({ presence: 'SPEAKING', phase: 'SLEEPING', tracking: true, preview: null }), 'SLEEPING');
  assert.equal(eyeCueFromState({ presence: 'HAPPY', phase: 'RETURNING_TO_SLEEP', tracking: false, preview: 'HAPPY' }), 'SLEEPING');
  assert.equal(eyeCueFromState({ presence: 'IDLE', phase: 'TRACKING', tracking: true, preview: null }), 'CURIOUS');
  const source = readFileSync(path.join(root, 'src/shared/characterPresence.ts'), 'utf8');
  assert.equal(source.includes('getUserMedia'), false);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('setTimeout'), false);
  assert.equal(source.includes('setInterval'), false);
  assert.equal(source.includes('speechSynthesis'), false);
});

test('the app publishes one presence decision and does not restart a stream gesture', () => {
  const chat = readFileSync(path.join(root, 'src/main/chatWindow.ts'), 'utf8');
  const session = readFileSync(path.join(root, 'src/shared/conversationSession.ts'), 'utf8');
  const page = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  const robot = readFileSync(path.join(root, 'src/renderer/avatar/proceduralRobot.ts'), 'utf8');
  const movement = readFileSync(path.join(root, 'src/shared/desktopMovement.ts'), 'utf8');
  const wander = readFileSync(path.join(root, 'src/shared/wander.ts'), 'utf8');
  const trail = readFileSync(path.join(root, 'src/shared/neonTrail.ts'), 'utf8');
  assert.match(chat, /resolveCharacterPresence/);
  assert.match(chat, /presence \$\{from\} -> \$\{choice\.presence\} reason=\$\{reason\}/);
  assert.match(chat, /previewPose = null/);
  assert.match(chat, /ttsSpeaking = false/);
  const send = session.slice(session.indexOf('async send('), session.indexOf('reset(): void {'));
  assert.match(send, /presence = 'THINKING'/);
  assert.equal(send.slice(0, send.indexOf("presence = 'THINKING'")).includes("presence = 'ATTENTIVE'"), false);
  assert.match(send, /phase !== 'generating'/);
  assert.match(send, /if \(mine !== turn\)/);
  assert.match(page, /noteCapture\('ATTENTIVE'\)/);
  assert.match(page, /noteCapture\('THINKING'\)/);
  assert.match(page, /noteCapture\('IDLE'\)/);
  assert.match(page, /noteCapture\('ERROR'\)/);
  const speak = page.slice(page.indexOf('async function speakReply'), page.indexOf('const maybeAutoRead'));
  assert.match(speak, /if \(!ttsSettings\.enabled\) \{\s*return;\s*\}/);
  assert.match(page, /notifyTtsSpeaking\(active\)/);
  assert.match(robot, /face\.rotation\.set\(0, 0, 0\)/);
  assert.equal(movement.includes('characterPresence'), false);
  assert.equal(wander.includes('characterPresence'), false);
  assert.equal(trail.includes('characterPresence'), false);
  assert.match(robot, /TorusGeometry\(0\.15, 0\.06/);
});
