import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyPresence } from './presence.ts';
import { sendDisabledReason } from './chatGate.ts';
import {
  classifyVoiceError,
  createVoiceSession,
  overlayForVoicePhase,
  shouldSpeakCompletedReply,
  transitionVoice,
  voicePhaseLabel,
} from './voiceSession.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('conversation mode policy stays off until an explicit completed reply', () => {
  assert.equal(voicePhaseLabel('IDLE', null, false), '');
  assert.equal(voicePhaseLabel('IDLE', null, true), 'Conversation ready');
  assert.equal(voicePhaseLabel('RECORDING', null, true), 'Recording');
  assert.equal(voicePhaseLabel('TRANSCRIBING', null, true), 'Transcribing');
  assert.equal(voicePhaseLabel('DRAFT_READY', null, true), 'Ready to send');
  assert.equal(voicePhaseLabel('WAITING_FOR_AI', null, true), 'Thinking');
  assert.equal(voicePhaseLabel('SPEAKING', null, true), 'Speaking');
  assert.equal(voicePhaseLabel('ERROR', 'memory', true), 'Memory insufficient');
  assert.equal(voicePhaseLabel('ERROR', 'denied', true), 'Microphone denied');
  assert.equal(classifyVoiceError('Microphone permission denied.'), 'denied');
  assert.equal(classifyVoiceError('1,024 MiB required by the current safety policy.'), 'memory');
  assert.equal(shouldSpeakCompletedReply({
    conversation: false,
    armed: true,
    alreadySpoken: false,
    role: 'assistant',
    busy: false,
    streaming: false,
    error: false,
  }), false);
  assert.equal(shouldSpeakCompletedReply({
    conversation: true,
    armed: true,
    alreadySpoken: false,
    role: 'assistant',
    busy: true,
    streaming: true,
    error: false,
  }), false);
  assert.equal(shouldSpeakCompletedReply({
    conversation: true,
    armed: true,
    alreadySpoken: false,
    role: 'assistant',
    busy: false,
    streaming: false,
    error: true,
  }), false);
  assert.equal(shouldSpeakCompletedReply({
    conversation: true,
    armed: true,
    alreadySpoken: false,
    role: 'demo',
    busy: false,
    streaming: false,
    error: false,
  }), true);
  assert.equal(sendDisabledReason({
    generating: false,
    microphoneBusy: false,
    ttsSpeaking: false,
    draftValid: true,
  }), null);
});

test('voice session rejects overlap and speaks one armed reply once', () => {
  const session = createVoiceSession();
  assert.equal(session.phase(), 'IDLE');
  assert.equal(session.apply('mic'), 'RECORDING');
  assert.equal(session.apply('mic'), 'RECORDING');
  assert.equal(session.apply('send'), 'RECORDING');
  assert.equal(session.apply('asr'), 'TRANSCRIBING');
  assert.equal(session.apply('asr'), 'TRANSCRIBING');
  assert.equal(session.apply('transcript'), 'DRAFT_READY');
  const token = session.arm();
  assert.equal(session.phase(), 'WAITING_FOR_AI');
  assert.equal(session.arm(), token);
  assert.equal(session.apply('responding'), 'AI_RESPONDING');
  assert.equal(session.apply('speak'), 'SPEAKING');
  assert.equal(session.apply('mic'), 'SPEAKING');
  assert.equal(session.claim(token), true);
  assert.equal(session.claim(token), false);
  assert.equal(session.claim(token - 1), false);
  assert.equal(session.apply('done'), 'IDLE');
  assert.equal(overlayForVoicePhase('RECORDING'), 'ATTENTIVE');
  assert.equal(overlayForVoicePhase('TRANSCRIBING'), 'THINKING');
  assert.equal(overlayForVoicePhase('SPEAKING'), null);
});

test('cancel, reset, close, and a stale token release the session', () => {
  const session = createVoiceSession();
  session.apply('mic');
  assert.equal(session.apply('cancel'), 'CANCELLING');
  assert.equal(session.apply('released'), 'IDLE');
  session.apply('mic');
  session.apply('asr');
  const token = session.arm();
  session.apply('reset');
  assert.equal(session.phase(), 'IDLE');
  assert.equal(session.claim(token), false);
  session.apply('mic');
  session.apply('close');
  assert.equal(session.phase(), 'IDLE');
  assert.equal(transitionVoice('SPEAKING', 'mic'), 'SPEAKING');
  assert.equal(transitionVoice('TRANSCRIBING', 'mic'), 'TRANSCRIBING');
  assert.equal(transitionVoice('AI_RESPONDING', 'fail'), 'ERROR');
});

test('memory refusal does not block text send, and reduced motion keeps the speaking pose still', () => {
  assert.equal(sendDisabledReason({
    generating: false,
    microphoneBusy: false,
    ttsSpeaking: false,
    draftValid: true,
  }), null);
  const base = { glow: 0.4, antenna: 0.2, hover: 0.1, blink: 0.1 };
  const still = applyPresence(base, 'SPEAKING', 1, 1000, true);
  const moving = applyPresence(base, 'SPEAKING', 1, 1000, false);
  assert.equal(still.hover, base.hover);
  assert.equal(moving.hover === base.hover, false);
  const asleep = applyPresence({ ...base, glow: 0.2 }, 'ATTENTIVE', 0.2, 1000, true);
  assert.equal(asleep.glow, 0.2);
});

test('conversation mode is off in the chat page and does not auto-send a transcript', () => {
  const html = readFileSync(path.join(root, 'src/renderer/chat.html'), 'utf8');
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  const click = readFileSync(path.join(root, 'src/shared/clickThrough.ts'), 'utf8');
  assert.match(html, /id="conversation-mode"(?![^>]*checked)/);
  assert.equal(html.includes('Wake word'), false);
  const transcript = chat.slice(chat.indexOf('speech = new SpeechCapture'), chat.indexOf('composer.maxLength'));
  assert.equal(transcript.includes('sendMessage'), false);
  assert.equal(chat.includes('shouldSpeakCompletedReply'), true);
  assert.equal(click.includes('speechSynthesis'), false);
  assert.equal(click.includes('voiceSession'), false);
});
