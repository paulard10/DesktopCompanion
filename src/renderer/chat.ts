import { sendDisabledReason } from '../shared/chatGate';
import { shouldFollowTranscript } from '../shared/chatScroll';
import { MAX_CHAT_CHARS, validateChatText, type ChatLine } from '../shared/demoConversation';
import type { ChatStatusMessage, TtsSettingsMessage } from '../shared/ipc';
import { guessSpeechLang, pickSpokenVoice, speechLanguage } from '../shared/textToSpeech';
import { transcriptPlacement } from '../shared/speechAudio.ts';
import {
  classifyVoiceError,
  createVoiceSession,
  shouldAutoSubmitTurn,
  shouldResumeListening,
  shouldSpeakCompletedReply,
  visibleVoiceState,
} from '../shared/voiceSession.ts';
import { createChromiumTtsProvider } from './chromiumTtsProvider.ts';
import { SpeechCapture } from './speechCapture.ts';
import { mountCopiedText } from './copiedTextPanel.ts';
import { noteProposalFromReply, recognizeWindowsAction } from '../shared/windowsAction';
import { recognizeMemoryRequest } from '../shared/personalMemory';
import { mountWindowsAction } from './windowsActionCard';
import { mountMemoryCard } from './memoryCard';
import { mountMemorySettings } from './memorySettings';

declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

const thread = document.querySelector<HTMLElement>('#thread');
const log = document.querySelector<HTMLOListElement>('#log');
const empty = document.querySelector<HTMLElement>('#empty');
const jump = document.querySelector<HTMLButtonElement>('#jump');
const form = document.querySelector<HTMLFormElement>('#composer');
const draft = document.querySelector<HTMLTextAreaElement>('#draft');
const send = document.querySelector<HTMLButtonElement>('#send');
const stop = document.querySelector<HTMLButtonElement>('#stop');
const live = document.querySelector<HTMLElement>('#live');
const closeButton = document.querySelector<HTMLButtonElement>('#close');
const minimizeButton = document.querySelector<HTMLButtonElement>('#minimize');
const status = document.querySelector<HTMLElement>('#status');
const thinking = document.querySelector<HTMLElement>('#thinking');
const preflight = document.querySelector<HTMLElement>('#preflight');
const notice = document.querySelector<HTMLElement>('#notice');
const usage = document.querySelector<HTMLElement>('#usage');
const keyState = document.querySelector<HTMLElement>('#key-state');
const endpoint = document.querySelector<HTMLInputElement>('#endpoint');
const apiKey = document.querySelector<HTMLInputElement>('#api-key');
const saveEndpoint = document.querySelector<HTMLButtonElement>('#save-endpoint');
const saveKey = document.querySelector<HTMLButtonElement>('#save-key');
const removeKey = document.querySelector<HTMLButtonElement>('#remove-key');
const disclosure = document.querySelector<HTMLElement>('#disclosure');
const clearButton = document.querySelector<HTMLButtonElement>('#clear');
const mic = document.querySelector<HTMLButtonElement>('#mic');
const speechControls = document.querySelector<HTMLElement>('#speech-controls');
const speechState = document.querySelector<HTMLElement>('#speech-state');
const speechStop = document.querySelector<HTMLButtonElement>('#speech-stop');
const speechCancel = document.querySelector<HTMLButtonElement>('#speech-cancel');
const speechStaged = document.querySelector<HTMLElement>('#speech-staged');
const speechText = document.querySelector<HTMLElement>('#speech-text');
const speechInsert = document.querySelector<HTMLButtonElement>('#speech-insert');
const speechDiscard = document.querySelector<HTMLButtonElement>('#speech-discard');
const speechError = document.querySelector<HTMLElement>('#speech-error');
const ttsBar = document.querySelector<HTMLElement>('#tts-bar');
const ttsStatus = document.querySelector<HTMLElement>('#tts-status');
const ttsStop = document.querySelector<HTMLButtonElement>('#tts-stop');
const ttsError = document.querySelector<HTMLElement>('#tts-error');
const ttsEnabled = document.querySelector<HTMLInputElement>('#tts-enabled');
const ttsAutoRead = document.querySelector<HTMLInputElement>('#tts-autoread');
const ttsRate = document.querySelector<HTMLInputElement>('#tts-rate');
const ttsVoiceLine = document.querySelector<HTMLElement>('#tts-voice-line');
const conversationMode = document.querySelector<HTMLInputElement>('#conversation-mode');
const autoSubmit = document.querySelector<HTMLInputElement>('#auto-submit');
const stopConversation = document.querySelector<HTMLButtonElement>('#stop-conversation');
const conversationLive = document.querySelector<HTMLElement>('#conversation-live');
const holdToTalk = document.querySelector<HTMLInputElement>('#hold-to-talk');
const settingsToggle = document.querySelector<HTMLButtonElement>('#settings-toggle');
const settingsPanel = document.querySelector<HTMLElement>('#settings');
const speechLang = document.querySelector<HTMLSelectElement>('#speech-lang');
const voiceMute = document.querySelector<HTMLButtonElement>('#voice-mute');
const voicePhase = document.querySelector<HTMLElement>('#voice-phase');

const bridge = window.chat;
let beforeHide = (): void => {};
let dismissWindowsAction = (): void => {};
let dismissMemory = (): void => {};
if (closeButton && bridge) {
  closeButton.addEventListener('click', () => {
    beforeHide();
    bridge.closeChat();
  });
}
if (minimizeButton && bridge) {
  minimizeButton.addEventListener('click', () => {
    beforeHide();
    bridge.minimizeChat();
  });
}
let shown: ChatLine[] = [];
let stickToBottom = true;
let streamItem: HTMLLIElement | null = null;
let generating = false;

if (
  !thread ||
  !log ||
  !empty ||
  !jump ||
  !form ||
  !draft ||
  !send ||
  !stop ||
  !live ||
  !closeButton ||
  !minimizeButton ||
  !status ||
  !thinking ||
  !preflight ||
  !notice ||
  !usage ||
  !keyState ||
  !endpoint ||
  !apiKey ||
  !saveEndpoint ||
  !saveKey ||
  !removeKey ||
  !disclosure ||
  !clearButton ||
  !mic || !speechControls || !speechState || !speechStop || !speechCancel ||
  !speechStaged || !speechText || !speechInsert || !speechDiscard || !speechError ||
  !ttsBar || !ttsStatus || !ttsStop || !ttsError || !ttsEnabled || !ttsAutoRead || !ttsRate || !ttsVoiceLine ||
  !conversationMode || !autoSubmit || !stopConversation || !conversationLive || !holdToTalk ||
  !settingsToggle || !settingsPanel || !speechLang || !voiceMute || !voicePhase ||
  !bridge
) {
  console.error('desktop-companion: chat page is incomplete');
} else {
  const history = log;
  const composer = draft;
  const announce = live;
  const follow = jump;
  const statusLine = status;
  const thinkingLine = thinking;
  const preflightLine = preflight;
  const noticeLine = notice;
  const usageLine = usage;
  const keyLine = keyState;
  const endpointInput = endpoint;
  const keyInput = apiKey;
  const micButton = mic;
  const languageChoice = speechLang;
  const muteButton = voiceMute;
  const autoSubmitBox = autoSubmit;
  const stopConversationButton = stopConversation;
  const conversationStrip = conversationLive;
  const holdOption = holdToTalk;
  const settingsButton = settingsToggle;
  const settings = settingsPanel;
  const voiceControls = speechControls;
  const voiceState = speechState;
  const voiceStop = speechStop;
  const voiceCancel = speechCancel;
  const voiceStaged = speechStaged;
  const voiceText = speechText;
  const voiceInsert = speechInsert;
  const voiceDiscard = speechDiscard;
  const voiceError = speechError;
  let draftBeforeRecording = '';
  let pendingTranscript = '';
  let speech: SpeechCapture;
  let ttsSettings: TtsSettingsMessage = { enabled: true, autoRead: false, conversation: false, rate: 1 };
  let speakingItem: HTMLLIElement | null = null;
  let pabloReady: boolean | null = null;
  let lastSendReason = '';
  let capturePose: 'ATTENTIVE' | 'THINKING' | 'IDLE' | 'ERROR' | 'CLEAR' = 'CLEAR';
  let voiceReplyPending = false;
  let pointerHeld = false;
  let micMode: 'tap' | 'hold' = 'tap';
  let liveConversation = false;
  let allowResume = false;
  let permissionBlocked = false;
  let awaitingConfirm = false;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  const voice = createVoiceSession();
  const tts = createChromiumTtsProvider({
    onState() {
      refreshTtsUi();
    },
    onSpeaking(active) {
      bridge.notifyTtsSpeaking(active);
      refreshTtsUi();
    },
    onVoices(voices, picked, phase) {
      const spanish = pickSpokenVoice(voices, 'es');
      const english = pickSpokenVoice(voices, 'en');
      pabloReady = spanish !== null || english !== null;
      if (pabloReady) {
        clearTtsError();
        const names = [spanish, english].filter((voice, index, list) => voice && list.findIndex((item) => item?.voiceURI === voice.voiceURI) === index);
        ttsVoiceLine.textContent = `Voice: ${names.map((voice) => `${voice?.name} (${voice?.lang || 'local'})`).join(' · ')} on this PC.`;
      } else if (phase === 'pending') {
        ttsVoiceLine.textContent = 'Checking voices installed on this PC…';
        clearTtsError();
      } else {
        ttsVoiceLine.textContent = 'No local Spanish or English voice was found.';
        showTtsError('No local Windows voice was found. You can still type and send messages.');
      }
      void picked;
      refreshTtsUi();
      bridge.reportTtsVoices({
        count: voices.length,
        pablo: picked !== null,
        phase,
        voices: voices.slice(0, 24).map((voice) => ({
          name: voice.name.slice(0, 120),
          lang: voice.lang.slice(0, 32),
          voiceURI: voice.voiceURI.slice(0, 160),
          localService: voice.localService,
        })),
      });
    },
  });

  const showTtsError = (message: string): void => {
    ttsError.textContent = message;
    ttsError.hidden = false;
  };
  const clearTtsError = (): void => {
    ttsError.textContent = '';
    ttsError.hidden = true;
  };
  const noteCapture = (pose: 'ATTENTIVE' | 'THINKING' | 'IDLE' | 'ERROR' | 'CLEAR'): void => {
    if (pose === capturePose) {
      return;
    }
    capturePose = pose;
    bridge.notifyVoicePresence(pose);
  };
  const renderVoice = (): void => {
    const label = visibleVoiceState({
      conversation: liveConversation,
      phase: voice.phase(),
      capture: speech.currentState,
      speaking: tts.state() === 'speaking',
      thinking: generating,
    });
    const captureVisible = speech.currentState !== 'idle';
    voicePhase.hidden = label === '' || captureVisible;
    voicePhase.textContent = label === 'Listening' || label === 'Transcribing' ? `${label}...` : label;
    voicePhase.dataset.state = label.toLowerCase();
    micButton.dataset.state = label.toLowerCase();
    const recording = speech.currentState === 'recording';
    micButton.setAttribute('aria-label', micMode === 'hold'
      ? 'Hold to record'
      : recording ? 'Stop recording' : 'Tap to record');
    micButton.title = micMode === 'hold'
      ? 'Hold to talk. Release to transcribe. Nothing is sent until you press Send.'
      : 'Click to start. Click again to transcribe. Nothing is sent until you press Send.';
    holdOption.checked = micMode === 'hold';
    conversationStrip.hidden = !liveConversation;
    stopConversationButton.hidden = !liveConversation;
    const blockStart = generating || tts.state() === 'speaking' || speech.currentState === 'transcribing';
    micButton.disabled = speech.currentState === 'transcribing'
      || (blockStart && !recording && speech.currentState !== 'requesting')
      || (micMode === 'hold' && (recording || speech.currentState === 'requesting'));
  };
  const clearResume = (): void => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };
  const resumeListening = (): void => {
    clearResume();
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      const speaking = tts.state() === 'speaking';
      const captureBusy = speech.currentState !== 'idle';
      if (liveConversation && allowResume && !permissionBlocked && !awaitingConfirm && (speaking || captureBusy)) {
        resumeListening();
        return;
      }
      if (!shouldResumeListening({
        conversation: liveConversation,
        allowResume,
        permissionDenied: permissionBlocked,
        speaking,
        captureBusy,
        awaitingSend: awaitingConfirm,
      })) {
        renderVoice();
        return;
      }
      beginRecording();
    }, 600);
  };
  const maybeSpeakArmed = (): void => {
    const last = shown[shown.length - 1];
    if (!last || !shouldSpeakCompletedReply({
      conversation: ttsSettings.conversation,
      armed: voice.armed(),
      alreadySpoken: voice.spoken(),
      role: last.role,
      busy: generating,
      streaming: streamItem !== null,
      error: voice.phase() === 'ERROR',
    })) {
      return;
    }
    const item = history.lastElementChild;
    if (!(item instanceof HTMLLIElement)) {
      return;
    }
    const token = voice.token();
    if (!voice.claim(token)) {
      return;
    }
    voice.apply('speak');
    renderVoice();
    void speakReply(last.text, item).finally(() => {
      if (voice.phase() === 'SPEAKING') {
        voice.apply('done');
      }
      renderVoice();
      if (liveConversation) {
        resumeListening();
      }
    });
  };
  const refreshTtsUi = (): void => {
    const speaking = tts.state() === 'speaking';
    ttsBar.hidden = !speaking;
    ttsStatus.textContent = speaking ? 'Speaking' : '';
    muteButton.setAttribute('aria-label', ttsSettings.enabled ? 'Mute' : 'Unmute');
    muteButton.dataset.muted = ttsSettings.enabled ? '0' : '1';
    muteButton.setAttribute('aria-pressed', ttsSettings.enabled ? 'false' : 'true');
    for (const button of history.querySelectorAll<HTMLButtonElement>('.speak-reply')) {
      button.disabled = !ttsSettings.enabled || speaking || speech.currentState !== 'idle' || pabloReady === false;
    }
    refreshSend();
  };
  const showSpeechError = (message: string): void => {
    voiceError.textContent = message;
    voiceError.hidden = false;
    noteCapture('ERROR');
    const kind = classifyVoiceError(message);
    if (kind === 'denied') {
      permissionBlocked = true;
      allowResume = false;
      clearResume();
    }
    if (liveConversation || ttsSettings.conversation) {
      voice.apply('fail', kind);
    }
    awaitingConfirm = liveConversation;
    renderVoice();
  };
  const clearSpeechError = (): void => {
    voiceError.textContent = '';
    voiceError.hidden = true;
  };
  const refreshSpeech = (state: 'idle' | 'requesting' | 'recording' | 'transcribing', seconds: number): void => {
    voiceControls.hidden = state === 'idle';
    voiceControls.dataset.state = state;
    voiceStop.hidden = state !== 'recording';
    voiceState.textContent = state === 'recording'
      ? `Listening... ${Math.ceil(seconds)}s`
      : state === 'requesting' ? 'Listening...'
        : state === 'transcribing' ? 'Transcribing...' : '';
    micButton.dataset.live = state === 'recording' ? '1' : '0';
    if (micMode === 'hold' && !liveConversation && state === 'recording' && !pointerHeld) {
      void speech.stop();
    }
    if (state === 'requesting' || state === 'recording') {
      noteCapture('ATTENTIVE');
    } else if (state === 'transcribing') {
      noteCapture('THINKING');
    } else if (capturePose === 'ATTENTIVE' || capturePose === 'THINKING') {
      noteCapture('CLEAR');
    }
    if (liveConversation || ttsSettings.conversation) {
      if (state === 'requesting' || state === 'recording') {
        voice.apply('mic');
      } else if (state === 'transcribing') {
        voice.apply('asr');
      } else if (voice.phase() === 'RECORDING' || voice.phase() === 'CANCELLING') {
        voice.apply(voice.phase() === 'CANCELLING' ? 'released' : 'cancel');
        if (voice.phase() === 'CANCELLING') {
          voice.apply('released');
        }
      }
    }
    renderVoice();
    refreshTtsUi();
  };
  const offerTranscript = (text: string): void => {
    const placement = transcriptPlacement(draftBeforeRecording, composer.value);
    if (placement === 'insert') {
      composer.value = text;
      voiceReplyPending = true;
    } else {
      pendingTranscript = text;
      voiceText.textContent = text;
      voiceStaged.hidden = false;
    }
    if (liveConversation) {
      voice.apply('transcript');
    }
    const sendNow = shouldAutoSubmitTurn({
      conversation: liveConversation,
      autoSubmit: autoSubmitBox.checked,
      placement,
    });
    awaitingConfirm = liveConversation && !sendNow;
    renderVoice();
    refreshSend();
    if (sendNow) {
      form.requestSubmit();
      return;
    }
    composer.focus();
  };
  speech = new SpeechCapture(bridge, refreshSpeech, (text) => {
    noteCapture('IDLE');
    if (text.length > MAX_CHAT_CHARS) {
      showSpeechError('Transcript is too long for one message.');
      return;
    }
    offerTranscript(text);
  }, showSpeechError);

  composer.maxLength = MAX_CHAT_CHARS;

  const refreshSend = (): void => {
    const reason = sendDisabledReason({
      generating,
      microphoneBusy: speech.currentState !== 'idle',
      ttsSpeaking: tts.state() === 'speaking',
      draftValid: validateChatText(composer.value).ok,
    });
    send.disabled = reason !== null;
    renderVoice();
    const label = reason ?? 'ready';
    if (label !== lastSendReason) {
      lastSendReason = label;
      bridge.reportSendGate(label);
    }
  };

  const scrollToEnd = (): void => {
    thread.scrollTop = thread.scrollHeight;
    stickToBottom = true;
    follow.hidden = true;
  };

  const append = (line: ChatLine): void => {
    history.append(renderLine(line));
    empty.hidden = true;
    if (line.role !== 'user') {
      announce.textContent = `${label(line.role)}. ${line.text}`;
    }
  };

  async function speakReply(text: string, item: HTMLLIElement): Promise<void> {
    clearTtsError();
    if (!ttsSettings.enabled) {
      return;
    }
    if (pabloReady === false) {
      showTtsError('No local Windows voice is available.');
      noteCapture('ERROR');
      return;
    }
    if (speech.currentState !== 'idle') {
      return;
    }
    noteCapture('CLEAR');
    tts.stop();
    speakingItem?.classList.remove('is-speaking');
    speakingItem = item;
    speakingItem.classList.add('is-speaking');
    const gate = new AbortController();
    try {
      const outcome = await tts.speak(text, {
        rate: ttsSettings.rate,
        signal: gate.signal,
        lang: guessSpeechLang(text, languageChoice.value === 'en' ? 'en' : 'es'),
      });
      if (outcome === 'failed') {
        showTtsError('Could not speak with a local Windows voice. Check Windows speech settings.');
        noteCapture('ERROR');
      }
    } finally {
      speakingItem?.classList.remove('is-speaking');
      if (speakingItem === item) {
        speakingItem = null;
      }
      refreshTtsUi();
    }
  }

  const maybeAutoRead = (added: readonly ChatLine[]): void => {
    if (ttsSettings.conversation) {
      return;
    }
    if (
      ttsSettings.autoRead &&
      ttsSettings.enabled &&
      added.length === 1 &&
      added[0]?.role !== 'user' &&
      speech.currentState === 'idle' &&
      tts.state() === 'idle'
    ) {
      const line = added[0];
      const item = history.lastElementChild;
      if (line && item instanceof HTMLLIElement) {
        void speakReply(line.text, item);
      }
    }
  };

  const showHistory = (lines: readonly ChatLine[]): void => {
    if (streamItem) {
      streamItem = null;
      history.replaceChildren();
      shown = [];
    }
    const extended =
      lines.length >= shown.length &&
      shown.every((line, index) => line.role === lines[index]?.role && line.text === lines[index]?.text);
    const added = extended ? lines.slice(shown.length) : lines;
    const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    if (thread.clientHeight > 0) {
      stickToBottom = shouldFollowTranscript(distanceFromBottom);
    }
    if (!extended) {
      tts.stop();
      speakingItem = null;
      history.replaceChildren();
    }
    for (const line of added) {
      append(line);
    }
    shown = lines.slice();
    empty.hidden = lines.length > 0;
    if (stickToBottom) {
      scrollToEnd();
      if (extended) {
        maybeAutoRead(added);
        maybeSpeakArmed();
      }
      return;
    }
    if (!extended) {
      thread.scrollTop = Math.max(0, thread.scrollHeight - thread.clientHeight - distanceFromBottom);
    }
    if (added.some((line) => line.role !== 'user')) {
      follow.hidden = false;
    }
    if (extended) {
      maybeAutoRead(added);
      maybeSpeakArmed();
    }
  };

  const showDelta = (text: string): void => {
    let body = streamItem?.querySelector('p');
    if (!streamItem || !body) {
      streamItem = renderLine({ role: 'assistant', text }, true);
      body = streamItem.querySelector('p');
      history.append(streamItem);
      empty.hidden = true;
    }
    if (body) {
      body.textContent = text;
    }
    announce.textContent = `Companion. ${text}`;
    if (stickToBottom) {
      scrollToEnd();
    } else {
      follow.hidden = false;
    }
  };

  thread.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.speak-reply, .save-note')) return;
    setSettingsOpen(false);
  });
  thread.addEventListener('scroll', () => {
    const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    stickToBottom = shouldFollowTranscript(distance);
    if (stickToBottom) {
      follow.hidden = true;
    }
  });

  follow.addEventListener('click', scrollToEnd);
  const beginRecording = (): void => {
    if (generating || speech.currentState !== 'idle' || tts.state() === 'speaking') return;
    if (pendingTranscript) {
      showSpeechError('Insert or discard the previous transcript first.');
      return;
    }
    clearResume();
    if (voice.phase() === 'SPEAKING') {
      voice.apply('cancel');
      voice.apply('released');
    }
    tts.stop();
    clearSpeechError();
    speech.setLanguage(speechLanguage(languageChoice.value));
    speech.setSilenceDetection(liveConversation);
    draftBeforeRecording = composer.value;
    void speech.start();
  };
  const endConversation = (): void => {
    dismissWindowsAction();
    dismissMemory();
    liveConversation = false;
    allowResume = false;
    awaitingConfirm = false;
    permissionBlocked = false;
    clearResume();
    ttsSettings = { ...ttsSettings, conversation: false };
    conversationMode.checked = false;
    speech.cancel();
    tts.stop();
    voice.apply('close');
    noteCapture('CLEAR');
    bridge.notifyConversation(false);
    renderVoice();
  };
  beforeHide = endConversation;
  const beginHold = (): void => {
    if (micMode !== 'hold' || pointerHeld || generating || speech.currentState !== 'idle' || tts.state() === 'speaking') return;
    if (pendingTranscript) {
      showSpeechError('Insert or discard the previous transcript first.');
      return;
    }
    pointerHeld = true;
    beginRecording();
  };
  const endHold = (): void => {
    if (micMode !== 'hold') return;
    if (!pointerHeld && speech.currentState !== 'recording') return;
    pointerHeld = false;
    if (speech.currentState === 'recording') {
      void speech.stop();
      return;
    }
    if (speech.currentState === 'requesting') {
      speech.cancel();
    }
  };
  const onTap = (): void => {
    if (micMode !== 'tap') return;
    if (speech.currentState === 'recording') {
      void speech.stop();
      return;
    }
    if (speech.currentState === 'requesting') {
      speech.cancel();
      return;
    }
    allowResume = true;
    permissionBlocked = false;
    beginRecording();
  };
  holdOption.addEventListener('change', () => {
    if (speech.currentState === 'recording' || speech.currentState === 'requesting') speech.cancel();
    micMode = holdOption.checked ? 'hold' : 'tap';
    pointerHeld = false;
    speech.setSilenceDetection(liveConversation && micMode !== 'hold');
    renderVoice();
  });
  const setSettingsOpen = (open: boolean): void => {
    settings.hidden = !open;
    settingsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  settingsButton.addEventListener('click', () => {
    setSettingsOpen(settings.hasAttribute('hidden'));
  });
  micButton.addEventListener('pointerdown', (event) => {
    if (micMode !== 'hold' || event.button !== 0) return;
    event.preventDefault();
    micButton.setPointerCapture(event.pointerId);
    beginHold();
  });
  micButton.addEventListener('pointerup', endHold);
  micButton.addEventListener('pointercancel', endHold);
  micButton.addEventListener('click', () => {
    onTap();
  });
  micButton.addEventListener('keydown', (event) => {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    if (micMode === 'tap') onTap();
    else beginHold();
  });
  micButton.addEventListener('keyup', (event) => {
    if (micMode !== 'hold' || (event.key !== ' ' && event.key !== 'Enter')) return;
    event.preventDefault();
    endHold();
  });
  voiceStop.addEventListener('click', () => { void speech.stop(); });
  voiceCancel.addEventListener('click', () => {
    if (ttsSettings.conversation) {
      voice.apply('cancel');
    }
    speech.cancel();
    renderVoice();
  });
  voiceInsert.addEventListener('click', () => {
    const separator = composer.value.trim() ? '\n' : '';
    if (composer.value.length + separator.length + pendingTranscript.length > MAX_CHAT_CHARS) {
      showSpeechError('The combined draft is too long. Edit the draft before inserting.');
      return;
    }
    composer.value += separator + pendingTranscript;
    pendingTranscript = '';
    voiceStaged.hidden = true;
    refreshSend();
    composer.focus();
  });
  voiceDiscard.addEventListener('click', () => {
    pendingTranscript = '';
    voiceText.textContent = '';
    voiceStaged.hidden = true;
    awaitingConfirm = false;
    if (liveConversation) {
      allowResume = true;
      resumeListening();
    }
  });
  bridge.onSpeechForceStop(() => {
    endConversation();
  });
  bridge.onTtsForceStop(() => {
    allowResume = false;
    clearResume();
    tts.stop();
    if (voice.phase() === 'SPEAKING') {
      voice.apply('cancel');
      voice.apply('released');
    }
    renderVoice();
  });
  window.addEventListener('pagehide', () => {
    endConversation();
    tts.dispose();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || speech.currentState === 'idle') return;
    allowResume = false;
    clearResume();
    speech.cancel();
  });
  window.addEventListener('blur', () => {
    if (speech.currentState !== 'recording') return;
    allowResume = false;
    clearResume();
    speech.cancel('Recording stopped when chat lost focus.');
  });
  stop.addEventListener('click', () => {
    allowResume = false;
    clearResume();
    if (speech.currentState !== 'idle') speech.cancel();
    if (liveConversation && (voice.phase() === 'WAITING_FOR_AI' || voice.phase() === 'AI_RESPONDING' || voice.phase() === 'SPEAKING')) {
      voice.apply('cancel');
      voice.apply('released');
      renderVoice();
    }
    bridge.stopGeneration();
  });
  stopConversationButton.addEventListener('click', () => {
    endConversation();
  });
  ttsStop.addEventListener('click', () => {
    allowResume = false;
    clearResume();
    tts.stop();
    renderVoice();
  });

  const attachButton = document.querySelector<HTMLButtonElement>('#attach');
  const attachMenu = document.querySelector<HTMLElement>('#attach-menu');
  const attachCopied = document.querySelector<HTMLButtonElement>('#attach-copied');
  const attachScreen = document.querySelector<HTMLButtonElement>('#attach-screen');
  const setAttachOpen = (open: boolean): void => {
    if (!attachMenu || !attachButton) {
      return;
    }
    attachMenu.hidden = !open;
    attachButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  attachButton?.addEventListener('click', () => {
    setAttachOpen(attachMenu?.hidden !== false);
  });
  attachCopied?.addEventListener('click', () => {
    setAttachOpen(false);
    bridge.requestCopiedText();
  });
  attachScreen?.addEventListener('click', () => {
    setAttachOpen(false);
    bridge.requestScreenSelection();
  });
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node) || attachButton?.contains(event.target) || attachMenu?.contains(event.target)) {
      return;
    }
    setAttachOpen(false);
  });

  const windowsAction = mountWindowsAction(document, bridge, {
    onShow() {
      awaitingConfirm = true;
      renderVoice();
    },
    onDismiss() {
      awaitingConfirm = false;
      renderVoice();
    },
  });
  dismissWindowsAction = () => windowsAction.dismiss();
  const memorySettings = mountMemorySettings(document, bridge);
  const memoryCard = mountMemoryCard(document, bridge, {
    onShow() {
      awaitingConfirm = true;
      renderVoice();
    },
    onDismiss() {
      awaitingConfirm = false;
      renderVoice();
    },
    onSaved() {
      void memorySettings.reload();
    },
  });
  const memoryFlag = document.querySelector<HTMLElement>('#memory-on');
  bridge.onMemoryState((state) => {
    if (memoryFlag) {
      memoryFlag.hidden = state.useInChat !== true;
    }
  });
  dismissMemory = () => {
    if (memoryCard.isPending()) {
      bridge.notifyActionPose('clear');
    }
    memoryCard.dismiss();
  };

  const refreshCopied = mountCopiedText(document, bridge, {
    busy: () => generating,
    onAuthorize() {
      awaitingConfirm = false;
      if (ttsSettings.enabled && liveConversation) {
        voice.arm();
        renderVoice();
      }
      noteCapture('CLEAR');
    },
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const validated = validateChatText(composer.value);
    if (generating || !validated.ok) {
      return;
    }
    const memoryRequest = recognizeMemoryRequest(validated.text);
    if (memoryRequest) {
      voiceReplyPending = false;
      noteCapture('CLEAR');
      composer.value = '';
      refreshSend();
      windowsAction.dismiss();
      memoryCard.propose(memoryRequest);
      composer.focus();
      return;
    }
    dismissMemory();
    const proposal = recognizeWindowsAction(validated.text);
    if (proposal) {
      voiceReplyPending = false;
      noteCapture('CLEAR');
      composer.value = '';
      refreshSend();
      windowsAction.propose(proposal);
      bridge.notifyActionPose('thinking');
      window.setTimeout(() => {
        if (windowsAction.isPending()) bridge.notifyActionPose('curious');
      }, 220);
      composer.focus();
      return;
    }
    dismissWindowsAction();
    awaitingConfirm = false;
    if (ttsSettings.enabled && (voiceReplyPending || liveConversation)) {
      voice.arm();
      renderVoice();
    }
    voiceReplyPending = false;
    noteCapture('CLEAR');
    bridge.sendMessage(validated.text);
    composer.value = '';
    refreshSend();
    composer.focus();
  });

  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && attachMenu && !attachMenu.hidden && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setAttachOpen(false);
      return;
    }
    if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || !generating) {
      return;
    }
    event.preventDefault();
    bridge.stopGeneration();
    composer.focus();
  });

  clearButton.addEventListener('click', () => {
    dismissWindowsAction();
    dismissMemory();
    tts.stop();
    speech.cancel();
    voice.apply('reset');
    noteCapture('CLEAR');
    renderVoice();
    bridge.resetConversation();
    composer.focus();
  });

  if (import.meta.env.DEV) {
    const preview = document.createElement('div');
    preview.className = 'preview';
    const caption = document.createElement('span');
    caption.className = 'hint';
    caption.textContent = 'Dev preview';
    preview.append(caption);
    const previewCues = [
      ['Listening', 'ATTENTIVE'],
      ['Curious', 'CURIOUS'],
      ['Thinking', 'THINKING'],
      ['Responding', 'RESPONDING'],
      ['Speaking', 'SPEAKING'],
      ['Happy', 'HAPPY'],
      ['Error', 'ERROR'],
      ['Sleeping', 'SLEEPING'],
      ['Waking', 'WAKING'],
      ['Blink', 'BLINK'],
      ['Idle', 'IDLE'],
    ] as const;
    let compareTimer = 0;
    const stopCompare = () => {
      if (compareTimer !== 0) {
        window.clearInterval(compareTimer);
        compareTimer = 0;
        caption.textContent = 'Dev preview';
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopCompare();
      }
    });
    for (const [label, name] of previewCues) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        stopCompare();
        bridge.previewPresence(name);
      });
      preview.append(button);
    }
    const pairs = [
      ['Idle', 'IDLE', 'Listening', 'ATTENTIVE'],
      ['Listening', 'ATTENTIVE', 'Responding', 'RESPONDING'],
      ['Thinking', 'THINKING', 'Sleeping', 'SLEEPING'],
      ['Happy', 'HAPPY', 'Idle', 'IDLE'],
      ['Curious', 'CURIOUS', 'Error', 'ERROR'],
    ] as const;
    const compare = document.createElement('button');
    compare.type = 'button';
    compare.textContent = 'Compare';
    let pairIndex = 0;
    let side = 0;
    compare.addEventListener('click', () => {
      if (compareTimer !== 0) {
        stopCompare();
        return;
      }
      const show = () => {
        const pair = pairs[pairIndex] ?? pairs[0];
        caption.textContent = side === 0 ? pair[0] : pair[2];
        bridge.previewPresence(side === 0 ? pair[1] : pair[3]);
        side += 1;
        if (side > 1) {
          side = 0;
          pairIndex = (pairIndex + 1) % pairs.length;
        }
      };
      show();
      compareTimer = window.setInterval(show, 1400);
    });
    preview.append(compare);
    const diagnostics = document.createElement('div');
    diagnostics.className = 'preview';
    const diagnosticCaption = document.createElement('span');
    diagnosticCaption.className = 'hint';
    diagnosticCaption.textContent = 'Rig diagnostics';
    diagnostics.append(diagnosticCaption);
    const probes = [
      ['Test left arm', 'PROBE_LEFT'],
      ['Test right arm', 'PROBE_RIGHT'],
      ['Test antenna', 'PROBE_ANTENNA'],
      ['Test body tilt', 'PROBE_BODY'],
      ['Reset rig', 'PROBE_RESET'],
    ] as const;
    for (const [label, name] of probes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        stopCompare();
        bridge.previewPresence(name);
        diagnosticCaption.textContent = label;
      });
      diagnostics.append(button);
    }
    const moveTest = document.createElement('button');
    moveTest.type = 'button';
    moveTest.textContent = 'Test window move';
    moveTest.addEventListener('click', () => {
      void bridge.testWindowMove().then((result) => {
        diagnosticCaption.textContent = result.message;
      });
    });
    diagnostics.append(moveTest);
    const tools = document.querySelector<HTMLDetailsElement>('#developer');
    const panel = document.querySelector<HTMLElement>('#dev-panel');
    if (tools && panel) {
      tools.hidden = false;
      panel.append(preview, diagnostics);
    }
  }

  composer.addEventListener('input', () => {
    refreshSend();
    bridge.notifyActivity();
  });

  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="provider"]')) {
    input.addEventListener('change', () => {
      if (input.checked) {
        dismissWindowsAction();
        dismissMemory();
        bridge.setProvider(input.value === 'qwen' ? 'qwen' : 'demo');
      }
    });
  }

  saveEndpoint.addEventListener('click', () => {
    bridge.setEndpoint(endpointInput.value);
  });
  saveKey.addEventListener('click', () => {
    bridge.saveKey(keyInput.value);
    keyInput.value = '';
  });
  removeKey.addEventListener('click', () => {
    bridge.removeKey();
    keyInput.value = '';
  });

  bridge.onHistory(showHistory);
  bridge.onDelta(showDelta);
  bridge.onStatus((next) => {
    generating = next.busy;
    refreshCopied();
    history.setAttribute('aria-busy', next.busy ? 'true' : 'false');
    if (ttsSettings.conversation) {
      if (next.presence === 'ERROR') {
        voice.apply('fail');
      } else if (next.busy && next.presence === 'RESPONDING') {
        voice.apply('responding');
      }
      renderVoice();
    }
    applyStatus(next, {
      statusLine,
      thinkingLine,
      preflightLine,
      noticeLine,
      usageLine,
      keyLine,
      endpointInput,
      stop,
      disclosureLine: disclosure,
    });
    refreshSend();
    maybeSpeakArmed();
  });
  bridge.onFocusComposer(() => {
    composer.focus();
  });
  history.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const saveNote = target.closest<HTMLButtonElement>('.save-note');
    if (saveNote) {
      if (windowsAction.isPending()) {
        return;
      }
      const reply = saveNote.closest<HTMLLIElement>('.message')?.querySelector('p')?.textContent ?? '';
      const proposal = noteProposalFromReply(reply);
      if (!proposal) {
        return;
      }
      windowsAction.propose(proposal);
      bridge.notifyActionPose(proposal.kind === 'note' ? 'attentive' : 'surprised');
      return;
    }
    const button = target.closest<HTMLButtonElement>('.speak-reply');
    if (!button || button.disabled) {
      return;
    }
    const item = button.closest<HTMLLIElement>('.message');
    const body = item?.querySelector('p');
    if (!item || !body) {
      return;
    }
    void speakReply(body.textContent ?? '', item);
  });

  const applyTtsSettings = (next: TtsSettingsMessage): void => {
    ttsSettings = { ...next, conversation: liveConversation };
    ttsEnabled.checked = next.enabled;
    ttsAutoRead.checked = next.autoRead;
    conversationMode.checked = liveConversation;
    ttsRate.value = String(next.rate);
    renderVoice();
    refreshTtsUi();
  };
  ttsEnabled.addEventListener('change', () => {
    bridge.setTtsSettings({ enabled: ttsEnabled.checked });
  });
  muteButton.addEventListener('click', () => {
    bridge.setTtsSettings({ enabled: !ttsSettings.enabled });
  });
  ttsAutoRead.addEventListener('change', () => {
    bridge.setTtsSettings({ autoRead: ttsAutoRead.checked });
  });
  conversationMode.addEventListener('change', () => {
    if (conversationMode.checked) {
      liveConversation = true;
      allowResume = true;
      permissionBlocked = false;
      awaitingConfirm = false;
      ttsSettings = { ...ttsSettings, conversation: true };
      bridge.notifyConversation(true);
      clearSpeechError();
      setSettingsOpen(false);
      beginRecording();
      renderVoice();
      return;
    }
    if (liveConversation) endConversation();
  });
  ttsRate.addEventListener('change', () => {
    bridge.setTtsSettings({ rate: Number(ttsRate.value) });
  });
  bridge.onTtsSettings(applyTtsSettings);
  void bridge.getTtsSettings().then(applyTtsSettings);
  try {
    tts.start();
    refreshSend();
  } finally {
    bridge.notifyReady();
  }
}

function renderLine(line: ChatLine, streaming = false): HTMLLIElement {
  const item = document.createElement('li');
  item.className = `message message-${line.role === 'user' ? 'user' : line.role === 'demo' ? 'demo' : 'assistant'}${streaming ? ' is-streaming' : ''}`;
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = label(line.role);
  const body = document.createElement('p');
  body.textContent = line.text;
  item.append(who, body);
  if (line.role === 'assistant' || line.role === 'demo') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    if (!streaming && line.text.trim().length > 0) {
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'save-note';
      save.textContent = 'Save as note';
      save.setAttribute('aria-label', 'Save this reply as a note');
      actions.append(save);
    }
    const speak = document.createElement('button');
    speak.type = 'button';
    speak.className = 'speak-reply';
    speak.textContent = 'Speak';
    speak.setAttribute('aria-label', 'Read this reply aloud with Microsoft Pablo');
    actions.append(speak);
    item.append(actions);
  }
  return item;
}

function label(role: ChatLine['role']): string {
  if (role === 'user') {
    return 'You';
  }
  if (role === 'demo') {
    return 'Demo';
  }
  return 'Companion';
}

function applyStatus(
  next: ChatStatusMessage,
  view: {
    statusLine: HTMLElement;
    thinkingLine: HTMLElement;
    preflightLine: HTMLElement;
    noticeLine: HTMLElement;
    usageLine: HTMLElement;
    keyLine: HTMLElement;
    endpointInput: HTMLInputElement;
    stop: HTMLButtonElement;
    disclosureLine: HTMLElement;
  },
): void {
  const qwen = next.provider === 'qwen';
  view.preflightLine.hidden = !qwen;
  view.disclosureLine.hidden = !qwen;
  view.stop.hidden = !next.busy;
  view.thinkingLine.hidden = !next.busy || (next.presence !== 'THINKING' && next.presence !== 'ATTENTIVE');
  view.statusLine.textContent = statusLabel(next);
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="provider"]')) {
    input.checked = input.value === next.provider;
  }
  if (document.activeElement !== view.endpointInput && next.endpointPreview) {
    view.endpointInput.value = next.endpointPreview;
  }
  view.keyLine.textContent =
    next.key === 'saved' ? 'Key saved on this PC.' : next.key === 'unavailable' ? 'Secure storage is unavailable.' : 'No key saved.';
  if (next.notice) {
    view.noticeLine.hidden = false;
    view.noticeLine.dataset.outcome = next.notice === 'Stopped.' ? 'cancelled' : 'failed';
    view.noticeLine.textContent = next.notice;
  } else {
    view.noticeLine.hidden = true;
    delete view.noticeLine.dataset.outcome;
    view.noticeLine.textContent = '';
  }
  const empty = document.querySelector<HTMLElement>('#empty');
  if (empty && empty.hidden === false) {
    empty.textContent =
      next.provider === 'qwen'
        ? 'Say hello. Save the Qwen endpoint and key in Settings.'
        : 'Say hello.';
  }
  if (next.usage) {
    view.usageLine.hidden = false;
    const reported = [
      `${next.usage.promptTokens} prompt tokens`,
      `${next.usage.completionTokens} completion tokens`,
    ];
    if (next.usage.reasoningTokens !== null) {
      reported.push(`${next.usage.reasoningTokens} reasoning tokens`);
    }
    if (next.usage.totalTokens !== null) {
      reported.push(`${next.usage.totalTokens} total tokens`);
    }
    view.usageLine.textContent = `Provider reported ${reported.join(', ')} for the latest reply. This is not a bill.`;
  } else {
    view.usageLine.hidden = true;
    view.usageLine.textContent = '';
  }
}
function statusLabel(next: ChatStatusMessage): string {
  if (next.provider === 'demo') {
    return 'Demo. No AI connected.';
  }
  if (next.presence === 'ATTENTIVE' || next.presence === 'THINKING') {
    return 'Qwen · thinking';
  }
  if (next.presence === 'RESPONDING') {
    return 'Qwen · replying';
  }
  if (next.presence === 'HAPPY') {
    return 'Qwen · reply complete';
  }
  if (next.presence === 'ERROR') {
    return 'Qwen · needs attention';
  }
  if (next.notice === 'Stopped.') {
    return 'Qwen · stopped';
  }
  return 'Qwen · qwen3.7-plus';
}
