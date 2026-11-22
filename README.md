# Desktop Companion

A small 3D robot that lives on the Windows desktop. It sleeps, wakes, watches the cursor, and can talk with Qwen when you ask it to.

Desktop Companion is an Electron overlay: a transparent window, a procedural robot, and a chat window that stays out of the way until you open it. Clicks pass through the empty parts of the overlay to the application underneath.

## What it does

- **A procedural robot.** White shell, black face, and matching neon-green eyes, drawn with Three.js. It blinks, changes expression, and adds small gestures while it is awake.
- **Wake and sleep.** It starts asleep. Click the body, or choose Wake in the tray. After about two minutes without a real interaction it looks sleepy, glides back to Home, docks, and sleeps. Follow Cursor keeps it awake while the pointer is actually moving. Chat, a screen selection, and a Qwen request do too. Moving the cursor does not wake it once it is asleep. Tray Sleep still sleeps immediately.
- **Follow Cursor.** Turn this on from the tray and the robot glides after the pointer, with a lean, a small bank, and a lagging antenna.
- **Home.** A dock is visible by default. The robot can return there and sleep.
- **Neon trail.** While it travels, it leaves a short neon trail. The trail stops when the robot is asleep.
- **Chat.** Open it from the badge, a second click on an awake robot, or the tray. The window is a short conversation: messages, one text box, an attachment button, a microphone, and Send. Connection details and extra voice options stay in Settings. Demo mode answers locally and sends nothing over the network.
- **Ask about copied text.** Copy text in another app, then choose the command from the tray or the chat attachment menu. The chat shows that text. Choose Explain, Summarize, Translate, or Ask anything, review it, and press Send. Copying alone does not open the feature or send anything.
- **Voice.** Click the microphone to record and click it again to transcribe. The text stays in the box until you press Send. Hold to talk is in Settings. Conversation mode is also in Settings and stays off until you turn it on. Replies can be spoken with a Windows voice already installed on this PC.
- **Qwen.** Switch the chat provider to Qwen to use your own Alibaba Cloud Model Studio key. Chat uses `qwen3.7-plus` through the Singapore endpoint. The conversation stays in memory on this PC.
- **Screen vision, only with consent.** Choose a rectangle, confirm the crop, read what will be sent, and click **Ask Qwen**. One click sends that crop and your question once. There is no automatic retry, and nothing is captured before you confirm.
- **Click-through.** The body, chat badge, and screen button accept clicks. The transparent desktop around them does not.

## Status

| | |
| --- | --- |
| Source | Available in this repository. Version 0.1.2. |
| Development build | `npm run dev` on Windows. |
| Installer | Not published. There is no downloadable release yet. |

This is an active personal project. The robot, Home, trail, follow behavior, chat, local voice, copied-text questions, and consented screen vision are implemented in the source. They are exercised with local tests and a Windows smoke launch. An installer script exists for later packaging, but no official build is offered for download.

## Stack

Electron, TypeScript, Vite, and Three.js. The overlay, chat, and screen-selection pages are separate renderer surfaces. The main process owns the windows, the tray, cursor sampling, and the credential vault.

## Develop on Windows

You need Windows 10 or 11 on x64, and Node.js 22.12.0 or newer. This project was checked with Node.js 24 LTS. Electron 44 and Vite 8 both require that baseline.

```powershell
node -v
npm -v
npm install
npm run dev
```

`npm install` stays inside the project. It does not install anything globally. Stop the app with **Quit** in the tray. Closing the terminal also stops it.

| Command | What it does |
| --- | --- |
| `npm run dev` | Compiles the main and preload processes, starts Vite on `127.0.0.1:5173`, and opens Electron |
| `npm run typecheck` | Type-checks main, preload, and renderer |
| `npm run build` | Writes a production bundle to `dist/` |
| `npm start` | Launches that local bundle |
| `npm test` | Builds, then runs the local test suite |
| `npm run smoke` | Opens the production bundle, waits for the first frame, and quits |

`dist/` is generated and is not part of the repository. The tray icon can hide in the Windows 11 overflow arrow beside the clock.

## Use your own Qwen key

Demo mode is the default and does not call Alibaba. To use Qwen:

1. Open chat and choose **Settings**.
2. Expand **Connection**, then choose **Qwen**.
3. Keep the Singapore Model Studio endpoint, or save the endpoint from your own workspace.
4. Paste your API key and choose **Save key**.
5. Remove it later with **Remove API key** if you want it gone from this PC.

The key is stored in the app's local credential vault and protected with the operating system's secure storage. It is not written into this repository, and the chat page never stores the conversation on disk. Model Studio usage can cost money and is covered by Alibaba's data policies. The same saved key is used when you explicitly ask Qwen about a screen crop.

Screen sharing has its own confirmation. Drag a region, capture only that crop, and send it only with **Ask Qwen**. The privacy note names the provider, region, and model before the request.

## Ask about copied text

Copy text with Ctrl+C in another app. Then open it in one of two ways:

- Tray → **Ask about copied text**
- The **+** button in the chat composer → **Ask about copied text**

The same menu also starts **Select screen area**. The tray command for screen selection still works.

The chat shows the exact copied text. Choose **Explain**, **Summarize**, **Translate**, or **Ask anything**. Translate switches between Spanish and English. Ask anything uses a question you type, up to 500 characters. Read the prepared question and press the panel **Send**. That is the only step that delivers it to the existing chat. Demo mode answers locally. Qwen is used only when that provider is selected.

The copied text is treated as untrusted content, not as instructions. It is read once, when you choose the command. The app does not watch the clipboard, read clipboard history, write or clear the clipboard, log the text, or save it. Closing the panel, pressing Escape, or closing chat discards it, and it is not attached to later questions. An empty clipboard says to copy text and try again. A selection longer than 4,000 characters is refused and is not shortened or sent. The ordinary message box stays limited to 500 characters.

## Voice

The chat composer has one microphone. Click it to start, then click it again. Local transcription fills the message box. Edit it if needed, then use Send. Nothing is sent until you press Send.

**Hold to talk** is in Settings. Press the microphone and release it to transcribe.

**Conversation mode** is in Settings and is off until you check it. It listens, stops on a short silence, and transcribes locally. The recognized text stays in the box for Send unless you also check **Send turns automatically** for this chat. That option starts off and is not remembered. After a spoken reply, it listens again. It does not listen while the robot is speaking. While it is on, the window says **Conversation active** and shows **Stop**. Closing chat or Tray Sleep stops the microphone and does not turn it back on.

The status line shows Listening, Transcribing, Thinking, Speaking, or Paused. Listening looks attentive. Transcription and the wait for Qwen use the thinking expression. Speaking moves the eyes, antenna, and both arms together. A finished reply settles through the existing happy, then relaxed, pose. **Stop speech** ends playback. **Mute** turns spoken replies off.

Spoken replies use a voice installed in Windows. Spanish prefers Microsoft Pablo when it is present, and otherwise a local Spanish voice such as Microsoft Helena. English uses a local voice such as Microsoft Zira. Online voices are ignored. If neither language has a local voice, typing and sending still work.

### Whisper on this PC

`npm install` does not download a speech engine or a model. Another PC will not transcribe until those files are supplied.

Development looks in `.local-asr` at the project root. That directory is gitignored. A packaged build looks in `resources/speech`, which this repository does not ship. To use a different folder, set `DESKTOP_COMPANION_SPEECH_ROOT` to its absolute path before starting the app.

The folder must contain this layout:

```text
bin/whisper-cli.exe
bin/whisper.dll
bin/ggml.dll
bin/ggml-base.dll
bin/ggml-cpu-alderlake.dll
bin/ggml-cpu-x64.dll
ggml-tiny.bin
```

These are the pinned whisper.cpp 1.9.2 Windows x64 CPU binaries and the multilingual Tiny model, `ggml-tiny.bin`, not the English-only file. The app checks each file's SHA-256 and refuses to start if one is missing or different. The expected hashes are in `src/main/localSpeech.ts`.

Transcription runs for one utterance at a time, on two CPU threads, for at most 20 seconds of audio. It needs at least 1,024 MB of free memory. On the development laptop, a short clip takes a few seconds. Tiny can miss words, especially in noise. Auto, ES, and EN select the language passed to Whisper.

## Known limitations

- Windows only. There is no macOS or Linux build.
- No signed installer is published.
- Follow Cursor stays off until you enable it.
- The robot sleeps after about two minutes of quiet. Meaningful follow, chat, screen selection, and an in-progress Qwen request postpone that. Cursor movement does not wake a sleeping robot. If Home is hidden, it sleeps in place.
- Click-through can fail against an elevated window. The tray has a temporary whole-window recovery switch for that case.
- Voice needs the local Whisper files described above and a Windows voice for Spanish or English. Recordings are not stored. Transcription can refuse to start when free memory is below 1,024 MB.
- Copied text is plain text only, up to 4,000 characters, and only after you choose the command. There is no clipboard watcher, no image or file reading, and no automatic send.
- Qwen calls depend on your key, quota, and the provider being reachable. The app does not switch models or retry a failed call.

## Roadmap

- A signed Windows installer, published as a real release.
- A clearer first-run path for the Qwen key.
- More character moments that stay lightweight on integrated graphics.
- A license, once one is chosen.

## License

No license file is included yet. Until one is added, the author reserves all rights. Do not treat the source as free to copy, modify, or redistribute.

## Layout

```text
src/main/       Windows, tray, capture, and the credential boundary
src/preload/    The typed bridge to the renderer
src/renderer/   Robot, chat, Home, trail, and screen selection
src/shared/     Behavior, motion, and safety checks
assets/         Tray icon
```
