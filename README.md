# Desktop Companion

A small 3D robot that lives on the Windows desktop. It sleeps, wakes, watches the cursor, and can talk with Qwen when you ask it to.

Desktop Companion is an Electron overlay: a transparent window, a procedural robot, and a chat window that stays out of the way until you open it. Clicks pass through the empty parts of the overlay to the application underneath.

## What it does

- **A procedural robot.** White shell, black face, and matching neon-green eyes, drawn with Three.js. It blinks, changes expression, and adds small gestures while it is awake.
- **Wake and sleep.** It starts asleep. Click the body, or choose Wake in the tray. After a quiet minute it returns to sleep. Moving the cursor does not wake it and does not postpone sleep.
- **Follow Cursor.** Turn this on from the tray and the robot glides after the pointer, with a lean, a small bank, and a lagging antenna.
- **Home.** A dock is visible by default. The robot can return there and sleep.
- **Neon trail.** While it travels, it leaves a short neon trail. The trail stops when the robot is asleep.
- **Chat.** Open it from the badge, a second click on an awake robot, or the tray. Demo mode answers locally and sends nothing over the network.
- **Qwen.** Switch the chat provider to Qwen to use your own Alibaba Cloud Model Studio key. Chat uses `qwen3.7-plus` through the Singapore endpoint. The conversation stays in memory on this PC.
- **Screen vision, only with consent.** Choose a rectangle, confirm the crop, read what will be sent, and click **Ask Qwen**. One click sends that crop and your question once. There is no automatic retry, and nothing is captured before you confirm.
- **Click-through.** The body, chat badge, and screen button accept clicks. The transparent desktop around them does not.

## Status

| | |
| --- | --- |
| Source | Available in this repository. Version 0.1.2. |
| Development build | `npm run dev` on Windows. |
| Installer | Not published. There is no downloadable release yet. |

This is an active personal project. The robot, Home, trail, follow behavior, chat, and consented screen vision are implemented in the source. They are exercised with local tests and a Windows smoke launch. An installer script exists for later packaging, but no official build is offered for download.

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

1. Open chat and expand **Connection**.
2. Choose **Qwen**.
3. Keep the Singapore Model Studio endpoint, or save the endpoint from your own workspace.
4. Paste your API key and choose **Save key**.
5. Remove it later with **Remove API key** if you want it gone from this PC.

The key is stored in the app's local credential vault and protected with the operating system's secure storage. It is not written into this repository, and the chat page never stores the conversation on disk. Model Studio usage can cost money and is covered by Alibaba's data policies. The same saved key is used when you explicitly ask Qwen about a screen crop.

Screen sharing has its own confirmation. Drag a region, capture only that crop, and send it only with **Ask Qwen**. The privacy note names the provider, region, and model before the request.

## Known limitations

- Windows only. There is no macOS or Linux build.
- No signed installer is published.
- Follow Cursor stays off until you enable it.
- The robot sleeps after about 60 seconds without a wake action.
- Click-through can fail against an elevated window. The tray has a temporary whole-window recovery switch for that case.
- Speech input and spoken replies use this PC. They are optional and are not a cloud voice service.
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
