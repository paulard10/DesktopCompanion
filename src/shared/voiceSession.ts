/** Voice conversation coordinator. Imports nothing. Does not record, transcribe, or call a model. */

export const VOICE_PHASES = [
  'IDLE',
  'RECORDING',
  'TRANSCRIBING',
  'DRAFT_READY',
  'WAITING_FOR_AI',
  'AI_RESPONDING',
  'SPEAKING',
  'CANCELLING',
  'ERROR',
] as const;

export type VoicePhase = (typeof VOICE_PHASES)[number];

export type VoiceEvent =
  | 'mic'
  | 'asr'
  | 'transcript'
  | 'send'
  | 'responding'
  | 'speak'
  | 'done'
  | 'cancel'
  | 'released'
  | 'fail'
  | 'reset'
  | 'close';

const NEXT: Record<VoicePhase, Partial<Record<VoiceEvent, VoicePhase>>> = {
  IDLE: { mic: 'RECORDING', send: 'WAITING_FOR_AI', fail: 'ERROR' },
  RECORDING: { asr: 'TRANSCRIBING', cancel: 'CANCELLING', fail: 'ERROR', close: 'CANCELLING', reset: 'CANCELLING' },
  TRANSCRIBING: { transcript: 'DRAFT_READY', cancel: 'CANCELLING', fail: 'ERROR', close: 'CANCELLING', reset: 'CANCELLING' },
  DRAFT_READY: { mic: 'RECORDING', send: 'WAITING_FOR_AI', cancel: 'IDLE', close: 'CANCELLING', reset: 'CANCELLING' },
  WAITING_FOR_AI: { responding: 'AI_RESPONDING', speak: 'SPEAKING', fail: 'ERROR', cancel: 'CANCELLING', close: 'CANCELLING', reset: 'CANCELLING' },
  AI_RESPONDING: { speak: 'SPEAKING', fail: 'ERROR', cancel: 'CANCELLING', close: 'CANCELLING', reset: 'CANCELLING' },
  SPEAKING: { done: 'IDLE', cancel: 'CANCELLING', close: 'CANCELLING', reset: 'CANCELLING' },
  CANCELLING: { released: 'IDLE' },
  ERROR: { mic: 'RECORDING', send: 'WAITING_FOR_AI', cancel: 'IDLE', close: 'CANCELLING', reset: 'CANCELLING' },
};

export function transitionVoice(phase: VoicePhase, event: VoiceEvent): VoicePhase {
  return NEXT[phase][event] ?? phase;
}

export type VoiceErrorKind = 'memory' | 'denied' | 'generic';

export function classifyVoiceError(message: string): VoiceErrorKind {
  if (/1,024 MiB|available memory/i.test(message)) {
    return 'memory';
  }
  if (/permission denied|notallowed|microphone permission/i.test(message)) {
    return 'denied';
  }
  return 'generic';
}

/** Listening and transcription poses only. Speaking stays on the TTS path. */
export function overlayForVoicePhase(phase: VoicePhase): 'ATTENTIVE' | 'THINKING' | null {
  if (phase === 'RECORDING') {
    return 'ATTENTIVE';
  }
  if (phase === 'TRANSCRIBING') {
    return 'THINKING';
  }
  return null;
}

export function voicePhaseLabel(phase: VoicePhase, errorKind: VoiceErrorKind | null, enabled: boolean): string {
  if (!enabled) {
    return '';
  }
  if (phase === 'RECORDING') {
    return 'Recording';
  }
  if (phase === 'TRANSCRIBING') {
    return 'Transcribing';
  }
  if (phase === 'DRAFT_READY') {
    return 'Ready to send';
  }
  if (phase === 'WAITING_FOR_AI' || phase === 'AI_RESPONDING') {
    return 'Thinking';
  }
  if (phase === 'SPEAKING') {
    return 'Speaking';
  }
  if (phase === 'ERROR' && errorKind === 'memory') {
    return 'Memory insufficient';
  }
  if (phase === 'ERROR' && errorKind === 'denied') {
    return 'Microphone denied';
  }
  if (phase === 'CANCELLING') {
    return 'Conversation ready';
  }
  return 'Conversation ready';
}

export function shouldSpeakCompletedReply(input: {
  conversation: boolean;
  armed: boolean;
  alreadySpoken: boolean;
  role: 'user' | 'demo' | 'assistant';
  busy: boolean;
  streaming: boolean;
  error: boolean;
}): boolean {
  return input.conversation
    && input.armed
    && !input.alreadySpoken
    && !input.busy
    && !input.streaming
    && !input.error
    && input.role !== 'user';
}

export function createVoiceSession(): {
  phase(): VoicePhase;
  token(): number;
  armed(): boolean;
  spoken(): boolean;
  errorKind(): VoiceErrorKind | null;
  apply(event: VoiceEvent, errorKind?: VoiceErrorKind): VoicePhase;
  arm(): number;
  claim(token: number): boolean;
  release(): void;
} {
  let phase: VoicePhase = 'IDLE';
  let epoch = 0;
  let activeToken = 0;
  let spokenToken = 0;
  let errorKind: VoiceErrorKind | null = null;

  const finishRelease = (): void => {
    epoch += 1;
    activeToken = 0;
    spokenToken = 0;
    errorKind = null;
    phase = 'IDLE';
  };

  return {
    phase: () => phase,
    token: () => activeToken,
    armed: () => activeToken !== 0 && spokenToken !== activeToken,
    spoken: () => activeToken !== 0 && spokenToken === activeToken,
    errorKind: () => errorKind,
    apply(event: VoiceEvent, kind?: VoiceErrorKind): VoicePhase {
      if (event === 'reset' || event === 'close') {
        phase = transitionVoice(phase, event);
        finishRelease();
        return phase;
      }
      if (event === 'fail') {
        errorKind = kind ?? 'generic';
      }
      if (event === 'mic' || event === 'send') {
        errorKind = null;
      }
      phase = transitionVoice(phase, event);
      if (event === 'released' && phase === 'IDLE') {
        errorKind = null;
      }
      return phase;
    },
    arm(): number {
      if (phase === 'RECORDING' || phase === 'TRANSCRIBING' || phase === 'WAITING_FOR_AI' || phase === 'AI_RESPONDING' || phase === 'SPEAKING' || phase === 'CANCELLING') {
        return activeToken;
      }
      epoch += 1;
      activeToken = epoch;
      spokenToken = 0;
      errorKind = null;
      phase = transitionVoice(phase, 'send');
      if (phase !== 'WAITING_FOR_AI') {
        phase = 'WAITING_FOR_AI';
      }
      return activeToken;
    },
    claim(token: number): boolean {
      if (token === 0 || token !== activeToken || spokenToken === token) {
        return false;
      }
      spokenToken = token;
      return true;
    },
    release(): void {
      finishRelease();
    },
  };
}
