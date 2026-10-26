# Desktop Companion

M1.5 is a Windows overlay with a procedural 3D robot and a separate demo chat window. The robot sleeps until a body click or the tray Wake command, looks toward the desktop cursor while awake, and goes back to sleep after a quiet minute. The chat window is a local demonstration. No AI is connected.

## Prerequisites

- Windows 10 or 11, x64
- Node.js 24 LTS (this project was checked on Node 24.21.0)
- npm 11

Confirm the toolchain:

```powershell
node -v
npm -v
```

Node must be at least 22.12.0. Electron 44 and Vite 8 both require that. If Node is missing, install Node.js 24 LTS from https://nodejs.org/ and open a new terminal. Do not install it from inside the app.

## Setup

From this directory:

```powershell
npm install
npm run dev
```

`npm install` installs the pinned packages locally and downloads the Electron binary into `node_modules`. It does not install anything globally. `npm run icons` regenerates the first-party tray artwork in `assets/`. Those PNG files are already in the repository.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Compiles the main and preload processes, starts Vite on `127.0.0.1:5173`, and launches Electron |
| `npm run typecheck` | Type-checks main, preload, and renderer |
| `npm run test` | Runs local logic tests. No window is opened |
| `npm run build` | Compiles a production bundle into `dist/` |
| `npm start` | Launches the production bundle with the `app://` protocol |
| `npm run smoke` | Builds nothing by itself. Launches the production bundle, waits for the first frame, quits, and checks that the process exited |
| `npm run check` | Runs typecheck, unit tests, production build, and the smoke launch |

Stop `npm run dev` with the tray **Quit** command. Closing the terminal also stops it.

## What you should see

A frameless window about 300 by 400 DIP sits at the lower right of the primary work area, above the taskbar. The page background is transparent. The only painted shape is a small hovering robot: an off-white sphere, a glossy black face, neon-green eyes, cheek lights, a short antenna, and two arms. It starts asleep: the eyes are shut, the green lights are dim, and the body is tilted into a resting pose. The window does not take a taskbar button and does not take focus when it appears. A green circle tray icon offers **Show**, **Hide**, **Wake**, **Sleep**, **Open Chat**, and **Quit**. Windows 11 often hides a new tray icon. Open the arrow beside the clock if you do not see it.

The window is kept above ordinary windows with Electron's `floating` always-on-top level. It is not set to the `screen-saver` level, so it is not trying to cover the taskbar, browser notification popups, or the secure desktop. On Windows 11 the window turns off the system Mica backdrop. Without that, the transparent window draws as a pale rounded panel.

## Selective click-through

The main process polls the desktop cursor about 60 times a second and compares it, in DIP, with a 160 DIP circle centered in the 300×400 window. The renderer frames the robot's body sphere to that same circle. The renderer cannot turn mouse capture on for the rest of the window. The antenna and arms can draw outside the circle; those pixels are not clickable yet.

- Pointer over the body: the window accepts the click. The robot gives a short scale pulse, and the terminal logs `desktop-companion: body-click`. There is no on-screen counter.
- Pointer over a transparent part of the window, including the four corners and the area beside the body: the click is sent to the application underneath. There is no extra invisible band.
- Leaving the body while the pointer is still inside the 300×400 rectangle returns to click-through on the next cursor sample. The poll is about 16 ms. The terminal logs `desktop-companion: pointer local=X,Y` with window-relative DIP only, plus `inside`, `onTarget`, `mode`, `ignore`, and `reason`.
- If the cursor sample is missing or older than 250 ms, the window goes click-through.
- Polling does not use `forward: true` and does not install a global mouse hook.

If the body stops accepting clicks, open the tray and enable **Recovery: capture whole window**. The whole 300×400 rectangle then captures clicks, including the transparent corners, until you turn recovery off. **Show**, **Hide**, **Wake**, **Sleep**, and **Quit** stay available.

## Character behavior

The robot starts in **SLEEPING**. A click on the body, or tray **Wake**, plays a wake of about 700 ms and then leaves it idle. While it is awake, the eyes and a small turn of the body follow the desktop cursor, including when the pointer is outside the overlay. The window itself stays where it is. Moving the cursor does not wake the robot and does not postpone sleep. After 60 seconds without a body click or tray **Wake**, it closes its eyes and returns to the resting pose. Tray **Sleep** starts that return immediately. Tray **Wake** also shows the window if it was hidden. **Sleep** does not hide it.

While the robot is fully asleep, most frames are not drawn. Hiding the window stops the animation loop. A long pause, such as the computer sleeping, does not fast-forward the wake or the return to sleep.

## Demo chat

The chat is a second window, not part of the robot overlay. It stays off until you open it. While the robot is awake, a small round button appears at the lower right of the overlay, outside the body click circle. That button, a second click on the body, or tray **Open Chat** opens the conversation. The first click on a sleeping robot only wakes it.

The header says **Demo. No AI connected.** Replies are fixed local text. Hello gets a greeting. A message about Cursor gets a short note that Cursor is not connected. Anything else gets the same demonstration reply. Nothing is sent over the network, and the reply never claims to have read the screen or run a task.

Enter sends. Shift+Enter adds a line. Empty messages are ignored. A message stops at 500 characters. Closing the chat hides that window and leaves the robot running. Typing, sending, and opening the chat count as activity, so the robot stays awake. A reply can play a small nod, greeting, or tilt.

The chat window is placed to the left of the robot when there is room, and is always kept inside the monitor work area. It is not pinned above other applications. The robot window is unchanged: 300 by 400, with the same 160 DIP body target. The four corners still pass clicks through.

## Manual Windows check

1. Start `npm run dev` and watch startup. There should be no white rectangular flash.
2. Confirm the robot has no visible window border, shadow, or filled rectangle behind it. Check this over both a light and a dark background. The green eyes, cheeks, and antenna tip should stay visible on both.
3. Focus Notepad, Explorer, or a browser. The robot should stay above those ordinary windows. It is not expected to stay above the UAC secure desktop.
4. Click the robot's body. It should pulse slightly, the terminal should log `body-click`, and the previous application should keep focus.
5. Move onto the body quickly and click on the first entry. Repeat several times and note any missed clicks.
6. Click each transparent corner of the overlay. The click should land in the application underneath. A click on the antenna or an arm may also pass through; that is the current proxy limit.
7. Leave the body, then come back and click it again. It should still respond.
8. Use the tray **Hide** and **Show** commands. Show should not steal focus. After Show, the body should still be clickable and the hover animation should be moving.
9. Enable **Recovery: capture whole window**. A corner click should then hit the overlay. Turn recovery off. The corner should pass through again, and the body should still click.
10. Use tray **Quit**. In Task Manager, the Electron process started by this app should be gone. Do not assume every `electron.exe` on the machine belongs to this app.
11. With the robot asleep, move the cursor around the desktop, including across the robot, without clicking. It should stay asleep.
12. Click the body. The eyes should open, the green lights should brighten, and the body should straighten over roughly a second. The terminal should log `body-click`, then `behavior WAKING`, then `behavior IDLE` or `behavior TRACKING`.
13. Move the cursor around the screen, including far from the overlay. The eyes and a slight body turn should follow. The window should not move.
14. Leave it alone for 60 seconds without clicking the body or choosing tray **Wake**. It should close its eyes and dim again. Moving the cursor during that minute should not delay sleep.
15. Use tray **Sleep** while it is awake, then tray **Wake**. Sleep should start the resting pose without hiding the window. Wake should show it if it was hidden and play the wake again.
16. Repeat the corner click-through check after a wake. Corners should still reach the application underneath. The body should still receive the click.

An elevated window, such as Task Manager started as administrator, can still break click delivery. Leave recovery off in that case and use the tray. Mixed-DPI monitors were not part of the automated test. Unit tests do not prove that Windows delivered a click or that the live cursor moved the eyes. Those two checks are manual.

## Layout

```text
src/main/       Window, tray, protocol, and security policy
src/preload/    Typed bridge: frame ready, body click, cursor samples, wake and sleep
src/renderer/   Transparent page, procedural robot, and character behavior
src/shared/     Placement, CSP, IPC, and the behavior reducer
assets/         First-party tray icon
docs/research/  Unchanged research notes
references/     Unchanged reference images
```

The renderer is sandboxed, with context isolation on and Node integration off. Production pages load from `app://companion/` and cannot navigate away. Chromium permission requests are denied.

## Later

**Neon Trail.** A later milestone may let the robot float around the desktop and leave a trail of small neon-green luminous particles that fade away. This milestone does not move the window and does not draw particles.
