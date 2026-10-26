/**
 * One presence decision for the robot.
 * Sleep is applied later by the director and wins over this result.
 * This module does not record, speak, or call a provider.
 */

export type LivePresence =
  | 'ATTENTIVE'
  | 'THINKING'
  | 'RESPONDING'
  | 'SPEAKING'
  | 'HAPPY'
  | 'ERROR'
  | 'IDLE'
  | 'CLEAR';

/** Capture and draft signals. Null means the microphone path is quiet. */
export type VoiceSignal = 'ATTENTIVE' | 'THINKING' | 'IDLE' | 'ERROR' | null;

export type PresenceReason =
  | 'tts-start'
  | 'mic-start'
  | 'asr-start'
  | 'draft-ready'
  | 'send'
  | 'first-token'
  | 'reply-done'
  | 'provider-error'
  | 'voice-error'
  | 'idle'
  | 'preview'
  | 'cleared';

export interface PresenceSignals {
  /** True only while Pablo reports active playback. */
  speaking: boolean;
  voice: VoiceSignal;
  /** Conversation session presence. CLEAR before any turn. */
  session: LivePresence;
  /** True from Send until the provider iterator finishes. */
  busy: boolean;
  /** Development preview. Ignored while a real signal is active. */
  preview: LivePresence | null;
}

export interface PresenceChoice {
  presence: LivePresence;
  reason: PresenceReason;
}

export function resolveCharacterPresence(input: PresenceSignals): PresenceChoice {
  if (input.speaking) {
    return { presence: 'SPEAKING', reason: 'tts-start' };
  }
  if (input.voice === 'ATTENTIVE') {
    return { presence: 'ATTENTIVE', reason: 'mic-start' };
  }
  if (input.voice === 'THINKING') {
    return { presence: 'THINKING', reason: 'asr-start' };
  }
  if (input.busy && input.session === 'RESPONDING') {
    return { presence: 'RESPONDING', reason: 'first-token' };
  }
  if (input.busy && (input.session === 'THINKING' || input.session === 'ATTENTIVE')) {
    return { presence: 'THINKING', reason: 'send' };
  }
  if (input.session === 'ERROR') {
    return { presence: 'ERROR', reason: 'provider-error' };
  }
  if (input.voice === 'ERROR') {
    return { presence: 'ERROR', reason: 'voice-error' };
  }
  if (input.voice === 'IDLE') {
    return { presence: 'IDLE', reason: 'draft-ready' };
  }
  if (input.session === 'HAPPY') {
    return { presence: 'HAPPY', reason: 'reply-done' };
  }
  if (isPreview(input.preview)) {
    return { presence: input.preview, reason: 'preview' };
  }
  if (input.session === 'IDLE') {
    return { presence: 'IDLE', reason: 'idle' };
  }
  return { presence: 'CLEAR', reason: 'cleared' };
}

/** Speech already replaced the reply celebration, so ending playback does not start it again. */
export function finishPresenceTransition(previousReason: PresenceReason | '', choice: PresenceChoice): PresenceChoice {
  if (choice.reason === 'reply-done' && previousReason === 'tts-start') {
    return { presence: 'IDLE', reason: 'idle' };
  }
  return choice;
}

/** Log the reason of the state being entered. Leaving playback for idle names that exit. */
export function presenceLogReason(from: string, choice: PresenceChoice): PresenceReason | 'tts-end' {
  if (from === 'SPEAKING' && choice.presence !== 'SPEAKING' && choice.reason === 'idle') {
    return 'tts-end';
  }
  return choice.reason;
}

function isPreview(value: LivePresence | null): value is LivePresence {
  return value !== null && value !== 'CLEAR';
}
