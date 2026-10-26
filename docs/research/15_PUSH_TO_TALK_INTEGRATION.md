# M1.8A.2 push-to-talk implementation report

**Status, 2026-10-23:** Implemented for local development. Manual microphone validation is pending. The user reports six natural Spanish Tiny runs at roughly 1.4–1.6 seconds, one aggregate error in 39 words (about 2.56% WER), and approximately 680 MiB peak private memory. These figures were supplied in the task; the six original run records and subjective laptop-responsiveness result were not independently reviewed here. The earlier [validation protocol](14_NATURAL_SPANISH_ASR_VALIDATION.md) remains a historical snapshot from before those tests. These results justify a guarded prototype, not a production quality claim.

## Architecture and changes

- Chat renderer: [chat.ts](../../src/renderer/chat.ts), [chat.html](../../src/renderer/chat.html), [chat.css](../../src/renderer/chat.css) add a manual microphone button, a visible recording timer, Stop and Cancel, Transcribing state, error messages, and an editable transcript. A transcript is automatically put in the composer only when it was empty and stayed unchanged. Otherwise it is staged for an explicit Append or Discard action. The Send button remains the sole path to Qwen.
- Capture: [speechCapture.ts](../../src/renderer/speechCapture.ts) uses a Web Audio context requested at 16 kHz, one mono channel, and a muted ScriptProcessor node. The deprecated ScriptProcessor API is a deliberate small pilot choice; an AudioWorklet may replace it after actual Windows device validation. It keeps at most 20 seconds of float samples, encodes PCM WAV in memory, and stops all media tracks on Stop/Cancel/close/minimize or when the chat loses focus.
- Audio boundary: [speechAudio.ts](../../src/shared/speechAudio.ts) encodes and independently validates the fixed 16 kHz mono, 16-bit RIFF/WAV shape and 20-second/640,044-byte cap. No ffmpeg executable or codec package is required at runtime.
- Trusted bridge: [ipc.ts](../../src/shared/ipc.ts) and [chatPreload.ts](../../src/preload/chatPreload.ts) expose only fixed arm/disarm/transcribe/cancel/force-stop channels. The renderer cannot pass paths, model names, commands or CLI flags.
- Main process: [security.ts](../../src/main/security.ts) continues denying all permissions except an audio-only media request from the trusted top-level chat page during a 10-second arm window following the microphone action. Camera and display capture remain denied. Windows microphone privacy denial is checked before arming. [chatWindow.ts](../../src/main/chatWindow.ts) authenticates speech IPC against its own visible chat WebContents, cancels on hide/minimize/destroy, and does not route audio into the conversation session or provider. Tray Quit waits for the speech job's normal cleanup before ending Electron.
- Inference: [localSpeech.ts](../../src/main/localSpeech.ts) verifies the pinned v1.9.2 executable, DLLs and multilingual Tiny SHA-256 values. It accepts one fixed-format WAV at a time, rejects a launch with less than 1 GiB available RAM, writes one private application-created temporary WAV, starts one short-lived CPU-only process with fixed `-l es -t 2 -ng -nt` arguments and `shell:false`, enforces a 30-second timeout, and removes the temporary directory in `finally`. Cancellation kills the process. No Whisper server remains loaded.

The recording and transcription state stays in the chat UI. It does not modify the robot's sleep/wake, expression reducer, cursor gaze, overlay hit proxy, tray or Qwen request logic. The chat window remains sandboxed with context isolation and the existing CSP and app protocol. The UI and IPC do not log audio or recognized text; any text the user explicitly sends follows the existing chat provider rules.

## Validation completed without microphone audio

- `npm run typecheck` passed.
- `npm run build` passed. Vite reports the pre-existing large robot scene chunk warning.
- 88 automated tests passed, including mocked microphone start, denial, Stop, Cancel, pending permission on close, 20-second cap, unsupported rate, draft preservation, mocked Whisper fixed arguments, single-process and low-memory guards, failure, timeout and temporary-file cleanup. Existing Qwen, robot behavior, sleep/wake and click-through tests passed.
- The Electron smoke test passed when launched outside the restricted command sandbox: process startup, preload, first frame, disposable credential check and clean exit. The same smoke invocation in the restricted sandbox exited before app startup with Windows status `0x80000003`; it did not exercise speech.
- No automated test opened the microphone or made a Model Studio call. No real recording or end-to-end Web Audio/Whisper UI run occurred.

## Windows packaging and licensing

Development looks for the already ignored `.local-asr/` assets relative to the project build. A future packaged app must place only the pinned `whisper-cli.exe`, required CPU DLLs and `ggml-tiny.bin` under `resources/speech/`, outside ASAR; the path is derived from Electron's `process.resourcesPath`, with no user-specific absolute path. This milestone does not package or download them. A release needs clean Windows x64 testing for VC runtime DLLs, PE imports, antivirus behavior, model availability, disk footprint, and the first permission request. Preserve whisper.cpp and model/weight MIT notices and recheck their redistribution provenance. No test audio, including the CC BY-NC synthetic pilot sample or the user's natural recordings, belongs in the package. Web Audio performs conversion, so ffmpeg is not a runtime dependency.

Expected additional runtime pressure remains about 680 MiB private for the short-lived helper based on the user's pilot report, plus Electron/Web Audio buffers. The 1 GiB available-RAM guard is provisional. It does not guarantee the laptop will remain responsive while Cursor and DesktopCompanion are open.

## Manual validation for the user — not performed here

1. Start with `npm run dev` or `npm run start`, open the chat, leave the provider in Demo, and verify the robot still sleeps/wakes and the transparent overlay still passes corner clicks to another app.
2. Press the microphone button once. Confirm Windows consent appears as appropriate, the red Recording state and elapsed timer are visible, and no audio capture occurs before the press.
3. Say a short Spanish sentence. Press Stop. Confirm the indicator disappears, Transcribing appears briefly, and editable text appears in an empty composer. Confirm no chat message is sent until **Send** is pressed.
4. Repeat with an existing draft and while editing the draft during transcription. Confirm the draft remains intact and the new transcript is staged for Append/Discard.
5. Test Cancel while requesting, recording and transcribing. Test close, minimize and tray Quit during recording/transcribing. Confirm Windows microphone activity ends, no `whisper-cli.exe` remains, and no `desktop-companion-speech-*` temporary directory remains.
6. Test Windows microphone denial, no selected microphone, a silent/empty clip, and the 20-second limit. Confirm each gives a clear UI state or message. With Cursor and DesktopCompanion open normally, observe typing, animation, cursor movement and available RAM during one short transcription.
7. Recheck existing Qwen behavior **only if you deliberately choose to send a typed or corrected draft**. Do not use a paid or real provider for this microphone validation unless you explicitly intend to.

## Remaining issues

Real Windows permission sequencing, device sample-rate support, microphone indicator, Stop-to-draft latency and subjective responsiveness remain unverified. The ScriptProcessor path is deprecated and may need an AudioWorklet if actual device tests show gaps. Force-killing the whole app or power loss can leave an application-created temporary WAV; normal success, failure, timeout and cancellation clean it. A packaged installer and clean-machine licence/runtime audit have not been performed. No TTS or wake word was added.
