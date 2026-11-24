# Desktop Companion

A small 3D robot that lives on the Windows desktop. It sleeps, wakes, watches the cursor, and can talk with Qwen when you ask it to.

Desktop Companion is an Electron overlay: a transparent window, a procedural robot, and a chat window that stays out of the way until you open it. Clicks pass through the empty parts of the overlay to the application underneath.

## What it does

- **A procedural robot.** White shell, black face, and matching neon-green eyes, drawn with Three.js. It blinks, changes expression, and adds small gestures while it is awake.
- **Wake and sleep.** It starts awake. Sleep is something you choose: double-click Home, or choose Sleep in the tray. It also falls asleep on its own after one minute sitting awake at Home. That sleep is remembered, so a restart stays asleep until you wake it. Moving the cursor does not wake it.
- **Follow Cursor.** This is on unless you turn it off in the tray. The robot glides after the pointer, with a lean, a small bank, and a lagging antenna. It resumes after you wake it. It stays put while the robot is asleep.
- **Home.** The platform has three modes. While roaming, one click returns home awake and a double click sleeps. Awake at home, one click goes back out and a double click sleeps. Asleep, one click wakes it and it leaves; a double click leaves it asleep. The platform tooltip names the click for the current mode.
- **Neon trail.** While it travels, it leaves a short neon trail. The trail stops when the robot is asleep.
- **Chat.** Open it from the badge, a second click on an awake robot, or the tray. The window is a short conversation: messages, one text box, an attachment button, a microphone, and Send. Connection details and extra voice options stay in Settings. Demo mode answers locally and sends nothing over the network.
- **Ask about copied text.** Copy text in another app, then choose the command from the tray or the chat attachment menu. The chat shows that text. Choose Explain, Summarize, Translate, or Ask anything, review it, and press Send. Copying alone does not open the feature or send anything.
- **Windows actions.** Ask in chat, or by voice, to open Calculator, Notepad, or File Explorer, or to save a plain-text note. The robot shows the action and waits. Confirm is the only step that runs it.
- **Save a reply as a note.** A finished chat reply has **Save as note**. Review and edit the text, choose a `.txt` file in the Windows save dialog, then confirm. An existing file needs a separate overwrite confirmation. A Screen Vision answer is not saved from the selection window.
- **Personal memory.** Ask the robot to remember a fact, in Spanish or English. It shows the text and waits. **Save memory** is the only step that stores it. Saved memories stay on this PC. Sharing them with Qwen stays off until you turn it on in Settings.
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

This is an active personal project. The robot, Home, trail, follow behavior, chat, local voice, copied-text questions, consented screen vision, confirmed Windows actions, saving a finished reply as a note, and encrypted personal memory are implemented in the source. They are exercised with local tests and a Windows smoke launch. An installer script exists for later packaging, but no official build is offered for download.

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

A finished summary, explanation, translation, or other reply can be saved afterward with **Save as note**. That step is separate from sending the question.

## Windows actions

Four actions are available. Type the request and press Send, or speak it and then Send. In Conversation mode, the request is recognized only when that turn is sent.

- `Open Calculator` or `Abre la calculadora`
- `Open Notepad` or `Abre el Bloc de notas`
- `Open File Explorer` or `Abre el explorador de archivos`
- `Create a note that says...` or `Crea una nota que diga...`

Spanish and English both work when the whole message is the request. A longer question, a quoted sentence, or copied text stays a normal chat message. A reply from Qwen never starts an action.

The chat shows a card before anything happens. **Confirm** opens the named Windows app, or saves the note. **Cancel** does nothing. Closing the chat, Tray Sleep, or stopping the conversation drops a card that is still waiting. A second click does not run the action again.

A note shows the text so you can edit it, up to 4,000 characters. **Choose destination** opens the Windows save dialog. The card then shows the file name and folder. Saving writes a `.txt` file only after Confirm. If that file already exists, a separate **Overwrite** button is required. The app opens only Calculator, Notepad, and File Explorer. It does not run a shell command or accept a path from the chat page.

## Save a reply as a note

Each completed Qwen or demo reply shows **Save as note** beside Speak. The button is not shown while a reply is still arriving, and it is not on your own messages.

The same card used for a typed note opens with the exact reply. You can edit it, press **Choose destination**, and pick a `.txt` file in the Windows save dialog. The card then names the file and folder. **Confirm** writes it. If that file already exists, **Overwrite** is a separate button. **Cancel**, closing chat, or Tray Sleep drops the note before anything is written. A second click does not save twice.

To summarize something you copied and keep the result: choose **Ask about copied text**, then **Summarize**, review the prepared question, and press Send. When the reply finishes, use **Save as note**. The reply is saved as text. It is never read as a command to open an app or run anything. A reply that cannot be stored as plain text, or that is longer than 4,000 characters, is refused whole and is not shortened.

Screen Vision answers stay in the selection window. **Save as note** is not available there yet.

## Personal memory

Memory is saved only when you ask for it. Type the request and press Send, or speak it and then Send. In Conversation mode, the request is recognized only when that turn is sent.

- `Remember that I prefer short answers.`
- `Recuerda que estoy desarrollando Bubearn.`

The chat shows the exact text. You can edit it. **Save memory** stores it. **Cancel**, closing chat, or Tray Sleep drops it, and nothing is written. A quoted sentence, copied text, or a longer message stays ordinary chat. A saved fact is never treated as a command to open an app, capture the screen, or start the microphone.

Ask `What do you remember about me?` or `¿Qué recuerdas de mis proyectos?` The answer is read on this PC. If nothing is saved, the robot says so. It does not invent memories, and that question does not call Qwen.

Settings → **Memory** lists what is saved. You can add a memory, edit one, delete one, or clear all of them. Delete and Clear all each ask you to confirm. The same section has **Use saved memories in chat**. It starts off. When you turn it on, the newest 8 memories are included with the next Qwen message and sent to the provider. The header shows **Memory on**. Demo mode does not send them. The notes are background data. They are separate from your message and from the companion's rules.

Each memory can be 240 characters. The list holds 20. A longer memory, or a 21st one, is refused whole and is not shortened. Text that looks like a password, an API key, or an access token is refused. Memories are encrypted with Windows protected storage in the app's user data. The file is not part of this repository, and the text is not written to the log. If protected storage is unavailable, nothing is saved.

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

Transcription runs for one utterance at a time, on two CPU threads, for at most 20 seconds of audio. It needs at least 1,024 MB of free memory before it starts. That floor was not lowered. On the development laptop, a short clip takes a few seconds. Tiny can miss words, especially in noise. Auto, ES, and EN select the language passed to Whisper.

## Performance

While the robot is asleep it draws a breathing frame about every 80 ms, instead of on every display refresh. The cursor is also sampled more slowly when the pointer is far from the window. Waking, docking, gestures, and an awake robot still use the display rate. When the pointer comes near the robot, cursor sampling returns to the fast interval so click-through stays responsive.

The numbers below are from `npm run dev`, not a packaged build, on one Windows 11 laptop: Intel Core i5-1235U, 8 GB of RAM, and Intel Iris Xe. Follow Cursor and voice were not part of these samples, and this was not a long-running leak test.

- Asleep at Home, after the session had settled: about 1.0–1.3% of total CPU, and about 229–230 MB of Electron working set. Private memory stayed near 252 MB across the two sleep samples and did not climb.
- The same kind of sleep measurement before this change was about 2.99% of total CPU and about 220 MB working set.
- A fresh launch can report a larger working set until Windows trims it. One fresh sample was about 445 MB and later settled to the sleeping figure above.
- Awake and idle, in short samples, was about 3.8–4.0% of total CPU. Chat open was higher.

During that session, free memory stayed under 1,024 MB, so Whisper would have refused to start. Chrome, Cursor, and other open programs accounted for most of that use. The companion asleep was about 230 MB of the 8 GB.

## Known limitations

- Windows only. There is no macOS or Linux build.
- No signed installer is published.
- Follow Cursor is on unless you turn it off. It does not run while the robot is asleep, and cursor movement does not wake it.
- Free roam does not fall asleep from inactivity. The one-minute sleep happens only after the robot has finished docking and is still awake at Home.
- Click-through can fail against an elevated window. The tray has a temporary whole-window recovery switch for that case.
- Voice needs the local Whisper files described above and a Windows voice for Spanish or English. Recordings are not stored. Transcription refuses to start when free memory is below 1,024 MB. On an 8 GB PC that is already busy, that free memory may not be available even though the companion itself is not leaking.
- Sleeping uses less CPU than a full-speed frame loop, and the robot still draws a slow breathing frame. Awake animation stays at the display rate. The performance figures above are one development PC. They do not include Follow Cursor, a voice session, or a long-running leak test.
- Copied text is plain text only, up to 4,000 characters, and only after you choose the command. There is no clipboard watcher, no image or file reading, and no automatic send.
- Windows actions are Calculator, Notepad, File Explorer, and one plain-text note. The request has to be the whole message, in Spanish or English. A note is a `.txt` file you choose in the save dialog, up to 4,000 characters, and an existing file is replaced only after a separate overwrite confirmation. **Save as note** uses that same save step on a finished chat reply. Screen Vision responses are not yet supported.
- Qwen calls depend on your key, quota, and the provider being reachable. The app does not switch models or retry a failed call.
- Personal memory stores up to 20 facts, each up to 240 characters, and only after Save memory. Sharing them with Qwen is off until you enable it, and then only the newest 8 are included. Demo mode does not send them. A memory cannot be read back if Windows protected storage is unavailable or the saved file cannot be decrypted. Closing chat discards a proposal that was not saved.

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
