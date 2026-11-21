import { MAX_RECORDING_SECONDS, SPEECH_RATE, noteSpeechEndpoint, pcmWav, speechRms } from '../shared/speechAudio.ts';
import type { ChatBridge } from '../shared/ipc.ts';

type CaptureLanguage = 'es' | 'en' | 'auto';

export type SpeechState = 'idle' | 'requesting' | 'recording' | 'transcribing';

type SpeechBridge = Pick<ChatBridge,
  'armMicrophone' | 'disarmMicrophone' | 'transcribeAudio' | 'cancelTranscription'>;

export class SpeechCapture {
  private readonly bridge: SpeechBridge;
  private readonly onState: (state: SpeechState, seconds: number) => void;
  private readonly onTranscript: (text: string) => void;
  private readonly onError: (message: string) => void;
  private readonly media: Pick<MediaDevices, 'getUserMedia'>;
  private readonly makeContext: () => AudioContext;
  private state: SpeechState = 'idle';
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private chunks: Float32Array[] = [];
  private samples = 0;
  private startedAt = 0;
  private language: CaptureLanguage = 'auto';
  private endpoint = false;
  private heardMs = 0;
  private silenceMs = 0;

  constructor(
    bridge: SpeechBridge,
    onState: (state: SpeechState, seconds: number) => void,
    onTranscript: (text: string) => void,
    onError: (message: string) => void,
    media: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices,
    makeContext: () => AudioContext = () => new AudioContext({ sampleRate: SPEECH_RATE }),
  ) {
    this.bridge = bridge;
    this.onState = onState;
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.media = media;
    this.makeContext = makeContext;
  }

  get currentState(): SpeechState { return this.state; }

  setLanguage(language: CaptureLanguage): void {
    this.language = language === 'en' || language === 'auto' ? language : 'es';
  }

  /** Conversation mode ends an utterance on quiet. Tap and hold stay manual. */
  setSilenceDetection(enabled: boolean): void {
    this.endpoint = enabled;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    const token = ++this.generation;
    this.setState('requesting');
    try {
      if (!await this.bridge.armMicrophone()) throw new Error('Microphone permission denied.');
      if (!this.media || typeof this.media.getUserMedia !== 'function') {
        throw new Error('No microphone is available.');
      }
      const stream = await this.media.getUserMedia({ audio: true, video: false });
      if (token !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      const context = this.makeContext();
      this.context = context;
      if (context.sampleRate !== SPEECH_RATE) throw new Error('Unsupported audio sample rate.');
      this.source = context.createMediaStreamSource(stream);
      this.processor = context.createScriptProcessor(2048, 1, 1);
      this.chunks = [];
      this.samples = 0;
      this.heardMs = 0;
      this.silenceMs = 0;
      this.processor.onaudioprocess = (event): void => {
        if (this.state !== 'recording') return;
        const input = event.inputBuffer.getChannelData(0);
        event.outputBuffer.getChannelData(0).fill(0);
        if (this.samples + input.length > SPEECH_RATE * MAX_RECORDING_SECONDS) {
          this.cancel('Recording reached the 20-second limit.');
          return;
        }
        this.chunks.push(new Float32Array(input));
        this.samples += input.length;
        if (!this.endpoint) return;
        const frameMs = (input.length / SPEECH_RATE) * 1000;
        const next = noteSpeechEndpoint(
          { heardMs: this.heardMs, silenceMs: this.silenceMs },
          speechRms(input),
          frameMs,
        );
        this.heardMs = next.heardMs;
        this.silenceMs = next.silenceMs;
        if (next.ended) void this.stop();
      };
      this.source.connect(this.processor);
      this.processor.connect(context.destination);
      await context.resume();
      if (token !== this.generation) return;
      if (typeof document !== 'undefined' && !document.hasFocus()) {
        this.cancel('Recording stopped because chat is not focused.');
        return;
      }
      this.startedAt = performance.now();
      this.setState('recording');
      this.timer = setInterval(() => this.onState('recording',
        Math.min(MAX_RECORDING_SECONDS, (performance.now() - this.startedAt) / 1000)), 100);
      this.deadline = setTimeout(() => this.cancel('Recording reached the 20-second limit.'),
        MAX_RECORDING_SECONDS * 1000);
      stream.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (this.state === 'recording') this.cancel('Microphone disconnected.');
        };
      });
    } catch (error) {
      if (token !== this.generation) return;
      const name = error instanceof DOMException ? error.name : '';
      const message = name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Microphone permission denied.'
        : name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? 'No microphone was found.'
          : error instanceof Error ? error.message : 'Microphone could not start.';
      this.cancel(message);
    }
  }

  async stop(): Promise<void> {
    if (this.state !== 'recording') return;
    const token = this.generation;
    this.setState('transcribing');
    this.releaseMicrophone();
    let wav: Uint8Array;
    try {
      wav = pcmWav(this.chunks, this.samples);
    } catch {
      this.cancel('No usable audio was recorded.');
      return;
    }
    this.chunks = [];
    this.samples = 0;
    try {
      const result = await this.bridge.transcribeAudio(wav, this.language);
      wav.fill(0);
      if (token !== this.generation) return;
      if (result.error) throw new Error(result.error);
      if (!result.text?.trim()) throw new Error('No speech was recognized.');
      this.onTranscript(result.text.trim());
      this.setState('idle');
    } catch (error) {
      wav.fill(0);
      if (token === this.generation) this.cancel(
        error instanceof Error ? error.message : 'Local transcription failed.');
    }
  }

  cancel(message?: string): void {
    ++this.generation;
    this.releaseMicrophone();
    this.bridge.cancelTranscription();
    this.chunks = [];
    this.samples = 0;
    this.setState('idle');
    if (message) this.onError(message);
  }

  private releaseMicrophone(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.deadline) clearTimeout(this.deadline);
    this.timer = null;
    this.deadline = null;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (this.context) void this.context.close().catch(() => {});
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.bridge.disarmMicrophone();
  }

  private setState(state: SpeechState): void {
    this.state = state;
    this.onState(state, state === 'recording' ? (performance.now() - this.startedAt) / 1000 : 0);
  }
}
