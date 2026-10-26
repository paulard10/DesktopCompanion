# 06 — Recommended Architecture and MVP Roadmap

## 1. Executive recommendation

Build a **new Electron + TypeScript + Vite + Three.js + `@pixiv/three-vrm`** desktop app (**Option B**, score 47/55 in `02`).

- **Don't fork.** Every reference has a blocker: no licence (Violet), restrictive assets or no click-through (AVATAR), excessive scope plus GPL and a security flaw (AILIS), or non-commercial UI plus Live2D (warashi).
- **Re-implement** the proven techniques:
  - Violet's head-bone look-at.
  - AILIS's main-process cursor polling.
  - Hit-test-driven click-through.
  - AVATAR's loopback agent bus, MCP surface and asset manifest (MIT, with attribution).
- **No Python, no Docker, no bundled Ollama.**
- Voice later through `sherpa-onnx-node` (open-vocabulary wake phrase, local ASR and TTS).
- AI through a BYOK provider interface (OpenAI-compatible + Anthropic) with optional local Ollama.
- Cursor through **MCP and hooks only**.

## 2. Architecture diagram

See `02_ARCHITECTURE_COMPARISON.md §6`. Condensed version:

```
 Tray ─┐
       ▼
 ┌─ Main process (trusted) ─────────────────────────────┐
 │ WindowMgr · CursorService(poll) · DisplayService     │
 │ Settings(safeStorage) · PermissionBroker · ToolBroker│
 └───────┬───────────────────────────────┬──────────────┘
   typed IPC (validated)            utility processes (later)
         ▼                               ▼
 ┌─ Overlay renderer (sandboxed) ─┐  ┌─ voice: sherpa-onnx VAD/KWS/ASR/TTS ─┐
 │ Three.js + three-vrm           │  ├─ brain: LLMProvider (OpenAI-compat,  │
 │ StateMachine · LookAt · Blink  │  │         Anthropic, Ollama)           │
 │ Breathing · Expressions · Hit  │  └─ bridge: MCP shim + Cursor hooks     │
 └────────────────────────────────┘
```

## 3. Milestones

| # | Milestone | Outcome | Rough effort (INFERRED, one dev with AI assistants) |
|---|---|---|---|
| **M1** | **Overlay MVP** (below) | Placeholder VRM sleeps, wakes on click and tracks the cursor in a transparent always-on-top window | 3–5 days |
| M2 | Animation system | State machine: sleep / waking / idle / happy / curious / thinking / speaking. Expression blending, VRMA loader, idle sway, random blinks, saccades | 1–2 weeks |
| M3 | Product shell | Settings window, drag to move and per-monitor position memory, scale, start-with-Windows, signed NSIS installer, auto-update, asset manifest, licence notices | 1–2 weeks |
| M4 | Voice in | Mic consent flow, VAD + sherpa-onnx KWS wake phrase (configurable), push-to-talk hotkey, local ASR | 2 weeks |
| M5 | Brain + voice out | LLMProvider (BYOK), structured `{say, emotion, gesture}`, local TTS + lip sync, optional Ollama | 2 weeks |
| M6 | Cursor integration | `companion-mcp` stdio shim (`say`, `set_state`, `notify`), opt-in per-project `hooks.json` installer for `stop` / `beforeShellExecution` notifications | 1 week |
| M7 | Custom character | Character from the user's illustration (VRoid or artist), custom expressions, 4–6 gestures, validation checklist | Art-dependent |
| M8 | Context + safe actions | T1–T3 permission tiers, on-demand screenshot Q&A, audit log, kill switch | 2–3 weeks |
| M9 | Cross-platform | macOS build (notarisation, TCC), Linux X11 build | 2 weeks |

## 4. M1: exact first milestone

**Goal:** prove the hardest platform risk (overlay, click-through, cursor tracking, DPI and resource use) with the smallest possible code.

**Scope (in):**
1. One small frameless **transparent, always-on-top (`screen-saver` level), `skipTaskbar`** window (about 300×400 DIP), placed at the bottom-right of the primary work area.
2. Three.js `WebGLRenderer({ alpha:true, antialias:true })`, `setClearColor(0x000000, 0)`, DPR capped at `min(devicePixelRatio, 2)`.
3. Load a local placeholder `assets/placeholder.vrm` with `GLTFLoader` + `VRMLoaderPlugin`. VRM 1.0, created by the user in VRoid Studio.
4. **Sleep state** (the default at startup and after 60 s without interaction):
   - `blink` expression = 1.
   - Breathing: chest/spine pitch sine at 0.25 Hz, ±1.5°.
   - Head droop: neck pitch +12°, slow roll drift.
   - The renderer drops to about 20 fps.
5. **Wake on click:**
   - Clicking the character's pixels triggers a wake transition of ≤ 800 ms: eyes open, a short `surprised` 0.4 pulse, head lifts with critical damping, then **idle** at 60 fps.
6. **Cursor tracking (idle only):**
   - Main process polls `screen.getCursorScreenPoint()` at 30 Hz and sends `{x, y}` in DIP to the renderer.
   - The renderer computes the vector from the character's head screen position (window bounds + projected head bone) to the cursor.
   - Applies smoothed **head yaw/pitch** (clamped ±35° / ±20°, with a smoothing time constant around 120 ms) plus `vrm.lookAt.target` for the eyes, after `vrm.update()`.
   - Tracking stops while sleeping.
7. **Click-through:**
   - Default is `setIgnoreMouseEvents(true, {forward:true})`.
   - The renderer raycasts the VRM meshes at the cursor position, using the polled cursor when forwarded events stop.
   - It sends `setInteractive(true|false)` with hysteresis (enter immediately, leave after 100 ms).
8. **Tray icon:** Wake, Sleep, Show/Hide, Quit.
9. **Hardening baseline** from `05 §1`: contextIsolation, sandbox, CSP, typed preload API, navigation blocked.
10. A `npm run dev` command and an **unsigned local NSIS build** (`npm run dist`) for testing only.

**Out of scope:** voice, LLM, settings UI, signing, auto-update, multiple characters, VRMA clips, dragging (optional stretch goal: Alt+drag to move).

**Proposed file layout:**
```
src/main/        main.ts, overlayWindow.ts, cursorService.ts, tray.ts, ipc.ts
src/preload/     preload.ts           (exposes: onCursor, setInteractive, onCommand)
src/renderer/    index.html, main.ts, scene.ts, avatar.ts, stateMachine.ts,
                 lookAt.ts, breathing.ts, hitTest.ts, frameGovernor.ts
assets/          placeholder.vrm (user-created), tray.ico
docs/research/   (these files)
```

### Acceptance criteria (all must pass on Windows 11 x64)

| # | Criterion | How to verify |
|---|---|---|
| AC1 | Only the character is visible. No border, shadow, white flash or background, on startup and during use | Visual check over a white and a black wallpaper. Screenshot |
| AC2 | The character stays above Notepad, Explorer, Chrome and Cursor when they are focused or maximised | Manual |
| AC3 | Clicks on transparent pixels inside the window reach the app behind it (for example, a text selection in Notepad under the window's empty corner) | Manual |
| AC4 | Clicking the character wakes it within ≤ 800 ms. A click while awake doesn't steal focus permanently (the previous app regains focus after the click) | Manual + timing log |
| AC5 | While sleeping: eyes closed, visible breathing loop, no cursor tracking. Sleep starts automatically 60 s after the last interaction | Manual (timer configurable via env for testing) |
| AC6 | While awake: head and eyes follow the cursor smoothly **anywhere on the desktop, including a second monitor**, with no jitter at rest, clamped so the neck never tears | Manual with 2 monitors |
| AC7 | Correct at 100%, 125% and 150% scaling, including **mixed-DPI dual monitor** (character not blurry, tracking direction correct) | Manual per configuration. Note issues |
| AC8 | Tracking keeps working when an elevated window (Task Manager as admin) is focused. Polling is not affected by the documented `forward` limitation | Manual |
| AC9 | Resources on a mid-range laptop (record CPU/GPU model): **sleeping** CPU ≤ 2% total, **awake idle** CPU ≤ 6%, GPU ≤ 10%, total app working set ≤ 300 MB (all Electron processes) | Task Manager / `Get-Process` sampled 60 s. Results logged in `docs/research/M1_MEASUREMENTS.md` |
| AC10 | Tray Quit exits all processes. No orphan processes after 5 launch/quit cycles | `Get-Process` |
| AC11 | No network requests at runtime | DevTools network panel in dev, or a firewall log |
| AC12 | Security baseline settings present (`contextIsolation`, `sandbox`, `nodeIntegration:false`, CSP, navigation blocked) | Code review checklist |

If AC7, AC8 or AC9 fail and can't be fixed with reasonable effort, the decision rule in `02 §5` applies (re-evaluate Tauri for the shell).

## 5. Dependencies to install later (project-local, nothing global)

| Phase | Package | Version policy | Justification |
|---|---|---|---|
| Prerequisite | **Node.js LTS** (user-level install, needed for development only, not for end users) | Current LTS | Build toolchain. **Needs your approval**, because it is a system install |
| M1 | `electron` (dev) | Latest **44.x** patch that is at least 2 weeks old at install time (45.0.0 shipped 2026-10-21, too new) | Shell |
| M1 | `three` | 0.186.x (0.186.1 published 2026-09-24) | Renderer |
| M1 | `@pixiv/three-vrm` | 3.5.x (3.5.5, 2026-07-09) | VRM loading, expressions, lookAt, spring bones |
| M1 | `vite`, `typescript` (dev) | Latest stable that is at least 2 weeks old (vite 8.3.5 is 1 day old → use the prior patch) | Build |
| M1 | `electron-builder` (dev) | 26.x (26.15.3, 2026-06-09) | NSIS packaging |
| M1 (optional) | `vite-plugin-electron` **or** a plain `tsc` + `electron .` script | — | Prefer plain scripts for fewer dependencies |
| M2 | `@pixiv/three-vrm-animation` | 3.5.x | VRMA clips |
| M3 | `electron-updater`, `@electron/fuses` | 6.x / latest | Updates, hardening |
| M4 | `sherpa-onnx-node` (+ `sherpa-onnx-win-x64`) | 1.13.x pinned | KWS, VAD, ASR, TTS without Python |
| M5 | `openai` and `@anthropic-ai/sdk` (or `fetch` directly) | Pinned | Providers. `fetch` alone may be enough |
| M5 | `zod` | 4.x | IPC/tool/LLM output validation |
| M6 | `@modelcontextprotocol/sdk` | 1.3x pinned | MCP shim for Cursor |
| Never | Docker, Python, React (until needed), whatsapp-web.js, GPL packages | — | See `05` |

## 6. Remaining uncertainties that need your input

See `07_OPEN_QUESTIONS_AND_RISKS.md §1`. The top five are:
1. Commercial plans and country of the publishing entity (affects code signing, Hunyuan3D, Picovoice).
2. Whether the character illustration is your own IP, and whether you want Path 1 (VRoid, do it yourself) or Path 2 (commission).
3. Approval to install Node.js LTS and project-local npm packages for M1.
4. The placeholder VRM: will you make one in VRoid Studio, or should we pick a sample whose licence permits use?
5. Target minimum hardware (does it need integrated-GPU laptops?) and acceptable RAM budget.
