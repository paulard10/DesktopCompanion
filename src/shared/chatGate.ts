/** Composer enablement. Pablo availability is intentionally not an input. */

export type SendBlock = 'generating' | 'microphone' | 'tts' | 'draft';

export function sendDisabledReason(input: {
  generating: boolean;
  microphoneBusy: boolean;
  ttsSpeaking: boolean;
  draftValid: boolean;
}): SendBlock | null {
  if (input.generating) {
    return 'generating';
  }
  if (input.microphoneBusy) {
    return 'microphone';
  }
  if (input.ttsSpeaking) {
    return 'tts';
  }
  if (!input.draftValid) {
    return 'draft';
  }
  return null;
}
