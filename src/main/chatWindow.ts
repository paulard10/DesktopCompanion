import path from 'node:path';
import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { createConversationSession } from '../shared/conversationSession.js';
import { modelMessages, MAX_OUTPUT_TOKENS } from '../shared/conversationPolicy.js';
import { demoReply, type ChatLine } from '../shared/demoConversation.js';
import { createDemoProvider } from '../shared/demoProvider.js';
import { finishPresenceTransition, presenceLogReason, resolveCharacterPresence, type LivePresence, type PresenceReason } from '../shared/characterPresence.js';
import { isEyePreviewCue, type EyePreviewCue } from '../shared/faceExpression.js';
import { isPresenceName } from '../shared/presence.js';
import { IpcChannels } from '../shared/ipc.js';
import { validateApiKey } from '../shared/keyVault.js';
import { classifyProviderHttp, providerFailureMessage } from '../shared/providerErrors.js';
import { chatCompletionsUrl, parseSingaporeEndpoint, QWEN_MODEL_ID } from '../shared/qwenEndpoint.js';
import { createQwenProvider } from '../shared/qwenProvider.js';
import { createSseParser } from '../shared/qwenSse.js';
import { createChatChrome, createChatWebPreferences } from '../shared/chatChrome.js';
import { CHAT_MIN_HEIGHT_DIP, CHAT_MIN_WIDTH_DIP, clampChat, placeChat, type ChatRect } from '../shared/chatPlacement.js';
import { readGesture, type RobotGesture } from '../shared/gesturePose.js';
import { isChatRendererUrl, isRobotRendererUrl } from '../shared/trustedUrl.js';
import { createProviderSettings } from './providerSettings.js';
import { createSafeCredentialStore } from './safeCredentialStore.js';
import { createLocalSpeechJob } from './localSpeech.js';
import { createTtsSettings } from './ttsSettings.js';
import { clampSpeechRate } from '../shared/textToSpeech.js';
import { resolveTrayIcon } from '../shared/packagedLayout.js';
import type { MicrophoneGate } from './security.js';

const ACTIVITY_GAP_MS = 2_000;

export interface ChatController {
  open: () => void;
  hide: () => void;
  reposition: () => void;
  activity: () => { open: boolean; busy: boolean; speaking: boolean; listening: boolean };
  destroy: () => Promise<void>;
}

export async function createChatController(options: {
  dev: boolean;
  preloadPath: string;
  getAnchor: () => ChatRect;
  getWorkArea: (anchor: ChatRect) => ChatRect;
  onActivity: () => void;
  onGesture: (gesture: RobotGesture) => void;
  onPresence: (presence: 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'SPEAKING' | 'HAPPY' | 'ERROR' | 'IDLE' | 'CLEAR') => void;
  onEyePreview: (cue: EyePreviewCue) => void;
  onMoveTest: () => { received: boolean; block: 'chat' | 'voice' | 'busy' | 'none'; message: string };
  isQuitting: () => boolean;
  microphoneGate: MicrophoneGate;
}): Promise<ChatController> {
  let win: BrowserWindow | null = null;
  let pageReady = false;
  let userSized = false;
  let lastActivityAt = 0;
  const speech = createLocalSpeechJob({
    assetRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'speech')
      : path.resolve(__dirname, '../../.local-asr'),
  });
  const storageDir = path.join(app.getPath('userData'), 'companion');
  const vault = createSafeCredentialStore(path.join(storageDir, 'qwen-key.bin'));
  await vault.prepare();
  const ttsSettings = createTtsSettings(path.join(storageDir, 'tts-settings.json'));
  let ttsSpeaking = false;
  let voicePose: 'ATTENTIVE' | 'THINKING' | 'IDLE' | 'ERROR' | null = null;
  let previewPose: LivePresence | null = null;
  let shownPresence = '';
  let shownReason: PresenceReason | '' = '';
  let captureBusy = false;
  const liveCapture = (): boolean => ttsSpeaking || voicePose === 'ATTENTIVE' || voicePose === 'THINKING';
  const publishOverlayPresence = (): void => {
    const current = session.status();
    const choice = finishPresenceTransition(shownReason, resolveCharacterPresence({
      speaking: ttsSpeaking,
      voice: voicePose,
      session: current.presence,
      busy: current.busy,
      preview: previewPose,
    }));
    if (choice.reason !== 'preview') {
      previewPose = null;
    }
    if (choice.presence === shownPresence && choice.reason === shownReason) {
      return;
    }
    const from = shownPresence || 'none';
    const reason = presenceLogReason(from, choice);
    shownPresence = choice.presence;
    shownReason = choice.reason;
    if (options.dev) {
      console.log(`desktop-companion: presence ${from} -> ${choice.presence} reason=${reason}`);
    }
    options.onPresence(choice.presence);
  };
  const session = createConversationSession({
    vault,
    settings: createProviderSettings(path.join(storageDir, 'provider-settings.json')),
    hooks: {
      history(lines) {
        publishHistory(lines);
      },
      delta(text) {
        sendToChat(IpcChannels.chatDelta, text);
      },
      status(status) {
        sendToChat(IpcChannels.chatStatus, status);
      },
      gesture(gesture) {
        const allowed = readGesture(gesture);
        if (!allowed) {
          return;
        }
        options.onGesture(allowed);
        console.log(`desktop-companion: chat-demo gesture=${allowed}`);
      },
      presence() {
        publishOverlayPresence();
      },
    },
    createDemo: (text) => createDemoProvider(demoReply, text),
    modelMessages,
    validateEndpoint: parseSingaporeEndpoint,
    validateKey: validateApiKey,
    failureMessage: providerFailureMessage,
    createQwen: ({ endpoint, apiKey }) =>
      createQwenProvider({
        fetchImpl: globalThis.fetch.bind(globalThis),
        endpoint,
        apiKey,
        model: QWEN_MODEL_ID,
        maxTokens: MAX_OUTPUT_TOKENS,
        completionsUrl: chatCompletionsUrl,
        classifyHttp: classifyProviderHttp,
        createParser: createSseParser,
      }),
  });

  const onOpen = (event: IpcMainEvent): void => {
    if (!isRobotFrame(event, options.dev)) {
      return;
    }
    open();
  };

  const onReady = (event: IpcMainEvent): void => {
    if (!isChatFrame(event, options.dev)) {
      return;
    }
    pageReady = true;
    publishHistory(session.history());
    sendToChat(IpcChannels.chatStatus, session.status());
    sendToChat(IpcChannels.ttsSettings, ttsSettings.current());
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.webContents.send(IpcChannels.chatFocus);
    }
  };

  const onSend = (event: IpcMainEvent, payload: unknown): void => {
    if (!isChatFrame(event, options.dev) || typeof payload !== 'string') {
      return;
    }
    markIntentional();
    void session.send(payload);
  };

  const onStop = (event: IpcMainEvent): void => {
    if (!isChatFrame(event, options.dev)) {
      return;
    }
    session.stop();
  };

  const onSaveKey = (event: IpcMainEvent, payload: unknown): void => {
    if (!isChatFrame(event, options.dev) || typeof payload !== 'string' || payload.length > 300) {
      return;
    }
    void session.saveKey(payload).then((saved) => {
      console.log(`desktop-companion: key-save result=${saved}`);
    });
  };

  const onRemoveKey = (event: IpcMainEvent): void => {
    if (!isChatFrame(event, options.dev)) {
      return;
    }
    session.removeKey();
    console.log('desktop-companion: key-removed');
  };

  const onSetProvider = (event: IpcMainEvent, payload: unknown): void => {
    if (!isChatFrame(event, options.dev) || typeof payload !== 'string') {
      return;
    }
    const saved = session.setProvider(payload);
    console.log(`desktop-companion: provider-set result=${saved}`);
  };

  const onSetEndpoint = (event: IpcMainEvent, payload: unknown): void => {
    if (!isChatFrame(event, options.dev) || typeof payload !== 'string' || payload.length > 300) {
      return;
    }
    const saved = session.setEndpoint(payload);
    console.log(`desktop-companion: endpoint-set result=${saved}`);
  };

  const onClose = (event: IpcMainEvent): void => {
    if (!isChatFrame(event, options.dev)) {
      return;
    }
    hide();
  };

  const onMinimize = (event: IpcMainEvent): void => {
    if (!isChatFrame(event, options.dev) || !win || win.isDestroyed()) {
      return;
    }
    win.minimize();
  };

  const onMoveTest = (event: IpcMainInvokeEvent): { received: boolean; block: 'chat' | 'voice' | 'busy' | 'none'; message: string } => {
    if (!options.dev || !speechFrame(event)) {
      return { received: false, block: 'none', message: 'Move test was not received.' };
    }
    return options.onMoveTest();
  };

  const onPreview = (event: IpcMainEvent, payload: unknown): void => {
    if (!options.dev || !isChatFrame(event, options.dev) || typeof payload !== 'string') {
      return;
    }
    if (session.status().busy) {
      return;
    }
    if (isEyePreviewCue(payload)) {
      options.onEyePreview(payload);
      return;
    }
    if (!isPresenceName(payload)) {
      return;
    }
    if (session.status().busy || liveCapture()) {
      return;
    }
    previewPose = payload;
    publishOverlayPresence();
  };

  const onReset = (event: IpcMainEvent): void => {
    if (!isChatFrame(event, options.dev)) {
      return;
    }
    session.reset();
    console.log('desktop-companion: conversation-reset');
  };

  const onTyping = (event: IpcMainEvent): void => {
    if (!isChatFrame(event, options.dev)) {
      return;
    }
    if (Date.now() - lastActivityAt < ACTIVITY_GAP_MS) {
      return;
    }
    markIntentional();
  };

  const speechFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    Boolean(win && !win.isDestroyed() && win.isVisible() &&
      event.sender === win.webContents && isChatFrame(event, options.dev));
  const onSpeechArm = (event: IpcMainInvokeEvent): boolean => {
    if (!speechFrame(event)) {
      return false;
    }
    const armed = options.microphoneGate.arm(event.sender);
    captureBusy = armed;
    return armed;
  };
  const onSpeechDisarm = (event: IpcMainEvent): void => {
    if (speechFrame(event)) options.microphoneGate.disarm(event.sender);
  };
  const onSpeechTranscribe = async (
    event: IpcMainInvokeEvent, payload: unknown,
  ): Promise<{ text?: string; error?: string }> => {
    if (!speechFrame(event)) return { error: 'Chat is closed.' };
    try {
      const text = await speech.transcribe(payload as Uint8Array);
      return speechFrame(event) ? { text } : { error: 'Chat is closed.' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Local transcription failed.' };
    } finally {
      captureBusy = false;
    }
  };
  const onSpeechCancel = (event: IpcMainEvent): void => {
    if (speechFrame(event)) speech.cancel();
    captureBusy = false;
  };
  const onTtsSpeaking = (event: IpcMainEvent, payload: unknown): void => {
    if (!speechFrame(event) || typeof payload !== 'boolean') {
      return;
    }
    ttsSpeaking = payload;
    publishOverlayPresence();
    console.log(`desktop-companion: tts-speaking=${payload}`);
  };
  const onTtsGetSettings = (event: IpcMainInvokeEvent) => {
    if (!speechFrame(event)) {
      return { enabled: false, autoRead: false, conversation: false, rate: 1 };
    }
    return ttsSettings.current();
  };
  const onTtsSetSettings = (event: IpcMainEvent, payload: unknown): void => {
    if (!speechFrame(event) || !payload || typeof payload !== 'object') {
      return;
    }
    const record = payload as Record<string, unknown>;
    const next = ttsSettings.update({
      enabled: record.enabled === true ? true : record.enabled === false ? false : undefined,
      autoRead: record.autoRead === true ? true : record.autoRead === false ? false : undefined,
      conversation: record.conversation === true ? true : record.conversation === false ? false : undefined,
      rate: typeof record.rate === 'number' ? clampSpeechRate(record.rate) : undefined,
    });
    sendToChat(IpcChannels.ttsSettings, next);
    console.log('desktop-companion: tts-settings-updated');
  };
  const onTtsDiag = (event: IpcMainEvent, payload: unknown): void => {
    if (!speechFrame(event) || !payload || typeof payload !== 'object') {
      return;
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.count !== 'number' || typeof record.pablo !== 'boolean') {
      return;
    }
    if (record.phase !== 'pending' && record.phase !== 'settled') {
      return;
    }
    const voices = Array.isArray(record.voices) ? record.voices : [];
    const summary = voices.slice(0, 24).map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const voice = item as Record<string, unknown>;
      const name = typeof voice.name === 'string' ? voice.name.slice(0, 120) : '';
      const lang = typeof voice.lang === 'string' ? voice.lang.slice(0, 32) : '';
      const voiceURI = typeof voice.voiceURI === 'string' ? voice.voiceURI.slice(0, 160) : '';
      const local = voice.localService === true;
      return `${name}|${lang}|${voiceURI}|local=${local}`;
    }).filter((line) => line.length > 0).join(' || ');
    console.log(`desktop-companion: tts-voices count=${record.count} pablo=${record.pablo} phase=${record.phase} ${summary}`);
  };
  const onSendGate = (event: IpcMainEvent, payload: unknown): void => {
    if (!speechFrame(event)) {
      return;
    }
    if (payload !== 'generating' && payload !== 'microphone' && payload !== 'tts' && payload !== 'draft' && payload !== 'ready') {
      return;
    }
    console.log(`desktop-companion: send-disabled=${payload}`);
  };
  const onVoicePresence = (event: IpcMainEvent, payload: unknown): void => {
    if (!speechFrame(event)) {
      return;
    }
    voicePose = payload === 'ATTENTIVE' || payload === 'THINKING' || payload === 'IDLE' || payload === 'ERROR' ? payload : null;
    publishOverlayPresence();
    console.log(`desktop-companion: voice-overlay=${voicePose ?? 'clear'}`);
  };

  ipcMain.on(IpcChannels.openChat, onOpen);
  ipcMain.on(IpcChannels.chatReady, onReady);
  ipcMain.on(IpcChannels.chatSend, onSend);
  ipcMain.on(IpcChannels.chatStop, onStop);
  ipcMain.on(IpcChannels.chatSaveKey, onSaveKey);
  ipcMain.on(IpcChannels.chatRemoveKey, onRemoveKey);
  ipcMain.on(IpcChannels.chatSetProvider, onSetProvider);
  ipcMain.on(IpcChannels.chatSetEndpoint, onSetEndpoint);
  ipcMain.on(IpcChannels.chatReset, onReset);
  ipcMain.on(IpcChannels.chatPreviewPresence, onPreview);
  ipcMain.on(IpcChannels.chatClose, onClose);
  ipcMain.on(IpcChannels.chatMinimize, onMinimize);
  ipcMain.on(IpcChannels.chatActivity, onTyping);
  ipcMain.handle(IpcChannels.speechArm, onSpeechArm);
  ipcMain.on(IpcChannels.speechDisarm, onSpeechDisarm);
  ipcMain.handle(IpcChannels.speechTranscribe, onSpeechTranscribe);
  ipcMain.on(IpcChannels.speechCancel, onSpeechCancel);
  ipcMain.on(IpcChannels.ttsPresence, onTtsSpeaking);
  ipcMain.on(IpcChannels.voicePresence, onVoicePresence);
  ipcMain.handle(IpcChannels.ttsGetSettings, onTtsGetSettings);
  ipcMain.handle(IpcChannels.moveTest, onMoveTest);
  ipcMain.on(IpcChannels.ttsSetSettings, onTtsSetSettings);
  ipcMain.on(IpcChannels.ttsDiag, onTtsDiag);
  ipcMain.on(IpcChannels.sendGate, onSendGate);

  return {
    open,
    hide,
    reposition,
    activity(): { open: boolean; busy: boolean; speaking: boolean; listening: boolean } {
      return {
        open: Boolean(win && !win.isDestroyed() && win.isVisible()),
        busy: session.status().busy,
        speaking: ttsSpeaking,
        listening: captureBusy,
      };
    },
    async destroy() {
      session.stop();
      speech.cancel();
      if (win && !win.isDestroyed()) {
        options.microphoneGate.disarm(win.webContents);
        win.webContents.send(IpcChannels.speechForceStop);
        win.webContents.send(IpcChannels.ttsForceStop);
        win.hide();
      }
      ttsSpeaking = false;
      voicePose = null;
      previewPose = null;
      captureBusy = false;
      publishOverlayPresence();
      await speech.waitForIdle();
      session.stop();
      ipcMain.removeListener(IpcChannels.openChat, onOpen);
      ipcMain.removeListener(IpcChannels.chatReady, onReady);
      ipcMain.removeListener(IpcChannels.chatSend, onSend);
      ipcMain.removeListener(IpcChannels.chatStop, onStop);
      ipcMain.removeListener(IpcChannels.chatSaveKey, onSaveKey);
      ipcMain.removeListener(IpcChannels.chatRemoveKey, onRemoveKey);
      ipcMain.removeListener(IpcChannels.chatSetProvider, onSetProvider);
      ipcMain.removeListener(IpcChannels.chatSetEndpoint, onSetEndpoint);
      ipcMain.removeListener(IpcChannels.chatReset, onReset);
      ipcMain.removeListener(IpcChannels.chatPreviewPresence, onPreview);
      ipcMain.removeListener(IpcChannels.chatClose, onClose);
      ipcMain.removeListener(IpcChannels.chatMinimize, onMinimize);
      ipcMain.removeListener(IpcChannels.chatActivity, onTyping);
      ipcMain.removeHandler(IpcChannels.speechArm);
      ipcMain.removeListener(IpcChannels.speechDisarm, onSpeechDisarm);
      ipcMain.removeHandler(IpcChannels.speechTranscribe);
      ipcMain.removeListener(IpcChannels.speechCancel, onSpeechCancel);
      ipcMain.removeListener(IpcChannels.ttsPresence, onTtsSpeaking);
      ipcMain.removeListener(IpcChannels.voicePresence, onVoicePresence);
      ipcMain.removeHandler(IpcChannels.ttsGetSettings);
      ipcMain.removeHandler(IpcChannels.moveTest);
      ipcMain.removeListener(IpcChannels.ttsSetSettings, onTtsSetSettings);
      ipcMain.removeListener(IpcChannels.ttsDiag, onTtsDiag);
      ipcMain.removeListener(IpcChannels.sendGate, onSendGate);
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
      win = null;
    },
  };

  function open(): void {
    const window = ensureWindow();
    reposition();
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    if (pageReady) {
      window.webContents.send(IpcChannels.chatFocus);
      publishHistory(session.history());
      sendToChat(IpcChannels.chatStatus, session.status());
      sendToChat(IpcChannels.ttsSettings, ttsSettings.current());
    }
    markIntentional();
    console.log('desktop-companion: chat-open');
  }

  function hide(): void {
    session.stop();
    speech.cancel();
    if (!win || win.isDestroyed()) {
      return;
    }
    options.microphoneGate.disarm(win.webContents);
    win.webContents.send(IpcChannels.speechForceStop);
    win.webContents.send(IpcChannels.ttsForceStop);
    ttsSpeaking = false;
    voicePose = null;
    previewPose = null;
    captureBusy = false;
    options.onEyePreview('CLEAR');
    publishOverlayPresence();
    win.hide();
    console.log('desktop-companion: chat-hide');
  }

  function reposition(): void {
    if (!win || win.isDestroyed()) {
      return;
    }
    const anchor = options.getAnchor();
    const work = options.getWorkArea(anchor);
    win.setBounds(userSized ? clampChat(win.getBounds(), work) : placeChat(anchor, work));
  }

  function ensureWindow(): BrowserWindow {
    if (win && !win.isDestroyed()) {
      return win;
    }
    pageReady = false;
    const created = new BrowserWindow({
      ...createChatChrome(),
      icon: resolveTrayIcon(__dirname),
      webPreferences: createChatWebPreferences(options.preloadPath, options.dev),
    });
    created.setBackgroundMaterial('none');
    created.setAlwaysOnTop(false);
    created.setMinimumSize(CHAT_MIN_WIDTH_DIP, CHAT_MIN_HEIGHT_DIP);
    created.on('will-resize', (event, newBounds) => {
      userSized = true;
      const next = clampChat(newBounds, options.getWorkArea(options.getAnchor()));
      const unchanged =
        next.x === newBounds.x && next.y === newBounds.y && next.width === newBounds.width && next.height === newBounds.height;
      if (unchanged) {
        return;
      }
      event.preventDefault();
      created.setBounds(next);
    });
    created.on('close', (event) => {
      if (options.isQuitting()) {
        return;
      }
      event.preventDefault();
      hide();
    });
    created.on('closed', () => {
      speech.cancel();
      options.microphoneGate.disarm(created.webContents);
      win = null;
    });
    created.on('minimize', () => {
      speech.cancel();
      options.microphoneGate.disarm(created.webContents);
      created.webContents.send(IpcChannels.speechForceStop);
      created.webContents.send(IpcChannels.ttsForceStop);
    });
    const pageUrl = options.dev ? 'http://127.0.0.1:5173/chat.html' : 'app://companion/chat.html';
    void created.loadURL(pageUrl);
    win = created;
    return created;
  }

  function publishHistory(lines: readonly ChatLine[]): void {
    sendToChat(IpcChannels.chatHistory, lines);
  }

  function sendToChat(channel: string, payload: unknown): void {
    if (!win || win.isDestroyed() || !pageReady) {
      return;
    }
    win.webContents.send(channel, payload);
  }

  function markIntentional(): void {
    lastActivityAt = Date.now();
    options.onActivity();
  }
}

function isRobotFrame(event: IpcMainEvent, dev: boolean): boolean {
  return frameUrl(event, dev, isRobotRendererUrl);
}

function isChatFrame(event: Pick<IpcMainEvent, 'senderFrame'>, dev: boolean): boolean {
  return frameUrl(event, dev, isChatRendererUrl);
}

function frameUrl(
  event: Pick<IpcMainEvent, 'senderFrame'>,
  dev: boolean,
  accept: (url: string, dev: boolean) => boolean,
): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) {
    return false;
  }
  return accept(frame.url, dev);
}
