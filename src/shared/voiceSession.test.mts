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
  shouldAutoSubmitTurn,
  shouldResumeListening,
  shouldSpeakCompletedReply,
  transitionVoice,
  visibleVoiceState,
  voicePhaseLabel,
  voiceSessionHold,
} from './voiceSession.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('conversation mode policy stays off until an explicit completed reply', () => {
  assert.equal(voicePhaseLabel('IDLE', null, false), '');
  assert.equal(voicePhaseLabel('IDLE', null, true), 'Paused');
  assert.equal(voicePhaseLabel('RECORDING', null, true), 'Listening');
  assert.equal(voicePhaseLabel('TRANSCRIBING', null, true), 'Transcribing');
  assert.equal(voicePhaseLabel('DRAFT_READY', null, true), 'Paused');
  assert.equal(voicePhaseLabel('WAITING_FOR_AI', null, true), 'Thinking');
  assert.equal(voicePhaseLabel('SPEAKING', null, true), 'Speaking');
  assert.equal(voicePhaseLabel('ERROR', 'memory', true), 'Paused');
  assert.equal(voicePhaseLabel('ERROR', 'denied', true), 'Paused');
  assert.equal(visibleVoiceState({
    conversation: false, phase: 'IDLE', capture: 'recording', speaking: false, thinking: false,
  }), 'Listening');
  assert.equal(visibleVoiceState({
    conversation: true, phase: 'IDLE', capture: 'idle', speaking: true, thinking: false,
  }), 'Speaking');
  assert.equal(visibleVoiceState({
    conversation: true, phase: 'DRAFT_READY', capture: 'idle', speaking: false, thinking: false,
  }), 'Paused');
  assert.equal(shouldAutoSubmitTurn({ conversation: true, autoSubmit: false, placement: 'insert' }), false);
  assert.equal(shouldAutoSubmitTurn({ conversation: false, autoSubmit: true, placement: 'insert' }), false);
  assert.equal(shouldAutoSubmitTurn({ conversation: true, autoSubmit: true, placement: 'stage' }), false);
  assert.equal(shouldAutoSubmitTurn({ conversation: true, autoSubmit: true, placement: 'insert' }), true);
  assert.equal(shouldResumeListening({
    conversation: true, allowResume: true, permissionDenied: false, speaking: true, captureBusy: false, awaitingSend: false,
  }), false);
  assert.equal(shouldResumeListening({
    conversation: true, allowResume: false, permissionDenied: false, speaking: false, captureBusy: false, awaitingSend: false,
  }), false);
  assert.equal(shouldResumeListening({
    conversation: true, allowResume: true, permissionDenied: true, speaking: false, captureBusy: false, awaitingSend: false,
  }), false);
  assert.equal(shouldResumeListening({
    conversation: true, allowResume: true, permissionDenied: false, speaking: false, captureBusy: false, awaitingSend: true,
  }), false);
  assert.equal(shouldResumeListening({
    conversation: true, allowResume: true, permissionDenied: false, speaking: false, captureBusy: false, awaitingSend: false,
  }), true);
  assert.equal(voiceSessionHold({ live: true, captureBusy: false, speaking: false }), true);
  assert.equal(voiceSessionHold({ live: false, captureBusy: false, speaking: false }), false);
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
  assert.match(html, /id="auto-submit"(?![^>]*checked)/);
  assert.match(html, /id="stop-conversation"/);
  assert.match(html, /id="hold-to-talk"(?![^>]*checked)/);
  assert.match(html, /id="settings"/);
  assert.equal(html.includes('>Tap<'), false);
  assert.equal(html.includes('>Hold<'), false);
  assert.equal(html.includes('Wake word'), false);
  assert.match(chat, /shouldAutoSubmitTurn/);
  assert.match(chat, /shouldResumeListening/);
  assert.equal(chat.includes('webkitSpeechRecognition'), false);
  const chatWindow = readFileSync(path.join(root, 'src/main/chatWindow.ts'), 'utf8');
  assert.match(chatWindow, /listening: captureBusy \|\| conversationHold/);
  const transcript = chat.slice(chat.indexOf('speech = new SpeechCapture'), chat.indexOf('composer.maxLength'));
  assert.equal(transcript.includes('sendMessage'), false);
  assert.equal(chat.includes('shouldSpeakCompletedReply'), true);
  assert.equal(click.includes('speechSynthesis'), false);
  assert.equal(click.includes('voiceSession'), false);
});
