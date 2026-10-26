# 02 — Architecture Comparison

## 1. Desktop overlay requirements and platform facts

| Requirement | Electron (Chromium, bundled) | Tauri v2 (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux) | Native/engine (Unity, Godot) |
|---|---|---|---|
| Transparent frameless window | **VERIFIED** `transparent:true`. Documented limits: not transparent while DevTools is open, can't maximise from the system menu, transparent windows are "not resizable" on some platforms, and transparency fails if DWM is disabled ([custom-window-styles](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)) | Supported. Third-party Tauri 2 reports describe WebView2 composition quirks (stale frames when you hide/show, drag-and-drop failing until the window is composited) ([dev.to report](https://dev.to/devrayat000/building-a-transparent-drag-and-drop-shelf-for-windows-with-tauri-the-engineering-war-stories-3c8c)) — **INFERRED** to be fragile | Unity needs custom Win32 interop (DWM + layered window) for each platform. Godot 4 has `transparent_bg` + per-pixel transparency (INFERRED from docs knowledge, not checked here) |
| Click-through | **VERIFIED** `setIgnoreMouseEvents(ignore,{forward})`. `forward` is macOS/Windows only. *"On Windows, forward: true stops working temporarily when the active window is running at a higher integrity level"* ([BrowserWindow docs](https://www.electronjs.org/docs/latest/api/browser-window)). It toggles `WS_EX_LAYERED`/`WS_EX_TRANSPARENT`. `setShape` is an alternative | `set_ignore_cursor_events`. Issue reports of click-through failing on child webviews ([tauri#11461](https://github.com/tauri-apps/tauri/issues/11461)). Hover detection while passthrough is on is an open request ([tauri#9250](https://github.com/tauri-apps/tauri/issues/9250)) | Hand-written per OS |
| Always-on-top level | **VERIFIED** `setAlwaysOnTop(true,'screen-saver')` on macOS/Windows. Not supported on Wayland. `setVisibleOnAllWorkspaces` *"does nothing on Windows"* | `set_always_on_top` (no level control on Windows, INFERRED) | Hand-written |
| Cursor position anywhere | **VERIFIED** in AILIS: `screen.getCursorScreenPoint()` polled in the main process | `cursor_position()` exists in Tauri v2 (INFERRED from API knowledge, not checked) | Win32 `GetCursorPos` |
| High-DPI / multi-monitor | DIP coordinate space. `screen.getDisplayMatching`, `display-metrics-changed`. Known HiDPI-switch bug [electron#42383](https://github.com/electron/electron/issues/42383) | Physical vs logical positions exposed. WebView2 DPI handled by the OS | Manual |
| Tray icon | `Tray` (used by Violet and AILIS) | `tray-icon` plugin | Manual or plugin |
| WebGL/WebGPU quality | Same Chromium on every OS → **identical rendering everywhere** | Windows: Chromium (Edge). macOS: WebKit. Linux: WebKitGTK (weakest WebGL; INFERRED from community reports) → **three different GPU paths** | Best rendering ceiling |
| Node ecosystem in-process (MCP SDK, sherpa-onnx-node, onnxruntime-node) | ✅ native in main/utility process | ❌ needs a Node sidecar or Rust rewrites | ❌ C#/GDScript ports |

**Note on resource use (INFERRED, from mixed-quality sources):** benchmarks commonly report Electron idle at ~100–300 MB against Tauri at ~20–100 MB, with installers of ~80–150 MB against single-digit MB ([Tauri methodology discussion, tauri#5889](https://github.com/tauri-apps/tauri/issues/5889)). Those figures come from mostly blank apps. **On Windows, WebView2 is itself Chromium.** Once you run a WebGL scene with a VRM model, both shells host a GPU process and a renderer process, so most of the RAM gap is in the *shell*, not the scene. The GPU and CPU cost comes mainly from the render loop, which both shells can throttle the same way. Nobody has published a PSS-correct Windows benchmark for this workload (UNKNOWN). **Measure it in M1.**

## 2. Avatar technology comparison

| Approach | Quality / customisation | Runtime cost | Toolchain for a custom character | Licensing | Fit |
|---|---|---|---|---|---|
| **Three.js + VRM (`@pixiv/three-vrm`)** | Humanoid rig standard, 18+ preset expressions, lookAt, spring-bone hair/cloth, MToon toon shading, VRMA animation clips | Low to medium (one skinned mesh, ~10–70k triangles typical, INFERRED) | VRoid Studio (free) or Blender + VRM Add-on (MIT) | MIT runtime. The model's licence is embedded in VRM metadata | **Best fit** |
| Blender + plain glTF in Three.js | Full freedom, but you rebuild expressions, lookAt and spring bones yourself | Same | Blender only | Free | Good fallback. VRM is glTF plus standard extensions, so VRM includes this path |
| Unity (UniVRM) | Highest rendering ceiling and mature animation tools | Higher baseline (engine runtime ~150 MB+ RAM, INFERRED) | Unity editor | Unity runtime fees/terms vary by revenue. UniVRM is MIT | Overkill. Transparency and click-through need per-OS native plugins |
| Godot 4 (+ godot-vrm) | Good, open source | Moderate | Godot | MIT | Viable but less mature VRM support and a smaller ecosystem for AI tooling |
| Live2D Cubism | Excellent 2.5D anime look, cheap to render | Very low | Cubism Editor (paid Pro for commercial work) plus a skilled rigger | **Proprietary Cubism Core**. Publication licence needed above revenue thresholds (warashi `NOTICE`, VERIFIED) | It is 2D, so it fails the "3D character" requirement |
| Sprite/PNG frame animation | Low | Minimal | An illustrator | Free | Not 3D. Only as an emergency fallback |
| Gaussian splat / NeRF avatars | Photoreal | High, and riggability is immature | Research tools | Mixed | Not production-ready (INFERRED) |

**Decision:** Three.js + VRM 1.0, using `three-vrm` for expressions, lookAt and spring bones, `three-vrm-animation` for clips, and **procedural** layers (breathing, cursor head-tracking, blinking) on top of the clips.

## 3. The three options

### Option A — fork or adapt an existing companion

| Candidate | Blocking issues (VERIFIED in `01`) |
|---|---|
| Violet | No LICENSE file. Docker backend. Mixamo raw FBX in the repo. WhatsApp automation dependency |
| AVATAR (MIT) | Best candidate. But it is React-Three-Fiber, has **no click-through or cursor tracking**, no voice and no LLM, ships pixiv VRMA with restrictive terms, and Windows is not tested in CI. You would remove more than you keep |
| AILIS (MIT) | 1,186 files, GPL-3 `stockfish` dependency, a self-approval flaw, benchmark sprawl |
| Warashi | Python + Live2D + **non-commercial** frontend licence |

### Option B — new Electron + Three.js/VRM shell with selective reuse

One TypeScript codebase. Electron main process for windows, tray, cursor polling, permissions and the tool broker. Renderer runs Three.js + three-vrm. Later, a Node **utility process** for voice (sherpa-onnx-node) and an MCP bridge. Ideas from Violet, AILIS and AVATAR are re-implemented.

### Option C — new Tauri or native shell with a modular renderer

Rust core plus web renderer (Three.js) in WebView2/WKWebView/WebKitGTK. Voice and MCP run in Rust crates or a Node/Python sidecar.

## 4. Scoring (1 = poor, 5 = excellent)

| Criterion | A: Fork (AVATAR as the best case) | **B: Electron + Three/VRM** | C: Tauri + web renderer | Notes |
|---|---|---|---|---|
| Windows reliability | 3 | **4** | 3 | B: Chromium transparency and click-through are proven in Violet and AILIS. C: WebView2 transparency quirks reported |
| 3D animation quality / customisability | 4 | **4** | 4 (Win) / 3 (Linux) | Same renderer. C changes engine per OS |
| Resource consumption | 3 | 3 | **4** | C's gain is smaller on Windows (WebView2 = Chromium). B mitigates with frame throttling |
| Development complexity (lower is better → higher score) | 2 (untangling) | **5** | 3 | C adds Rust plus a sidecar for Node-only libraries |
| Distribution / install simplicity | 3 | **4** | 5 | B ~100 MB NSIS per-user installer. C much smaller |
| Long-term maintenance | 2 | **4** | 3 | B: one language and Electron's 8-week cadence. C: three webview engines |
| Ease of connecting AI tools (MCP, SDKs, sherpa-onnx) | 4 | **5** | 3 | `@modelcontextprotocol/sdk`, `sherpa-onnx-node` and provider SDKs are first-class in Node |
| Cross-platform viability | 3 | **4** | 3 | B renders the same everywhere. C has a WebKitGTK risk on Linux |
| Security / privacy | 2 | **4** | **5** | C has a smaller attack surface and a capability system by default. B is good when hardened (fuses, sandbox, IPC validation) |
| Licensing | 2 (inherited asset/dependency issues) | **5** | 5 | Both new codebases are MIT/Apache-clean |
| Total cost (time to MVP plus upkeep) | 3 | **5** | 3 | |
| **Total (/55)** | **31** | **47** | **41** | |

## 5. Recommendation

**Option B: a new Electron + TypeScript + Vite + Three.js + `@pixiv/three-vrm` shell.**

Why this one, and why it is the *simplest* option that meets the requirements:

1. **Proven on Windows for this exact use case.** Two of the inspected references (Violet and AILIS) already ship transparent, always-on-top, click-through VRM overlays in Electron, and AILIS demonstrates main-process cursor polling (VERIFIED code).
2. **One language end to end.** TypeScript for shell, renderer, voice worker and MCP bridge. Cursor, Claude Code and Codex all work best on a single-language repo (INFERRED).
3. **Identical rendering on every OS.** This matters more for a WebGL-heavy product than the shell's RAM baseline.
4. **The AI ecosystem is Node-native.** MCP SDK (MIT), sherpa-onnx-node (Apache-2.0, prebuilt win-x64) and provider SDKs.
5. **No Python and no Docker** anywhere in the consumer install.

**What would change this decision:** if M1 measurements show Electron above the resource budget (for example a total working set over 350 MB or a sleeping CPU over 2%) *and* frame throttling can't fix it, revisit Tauri for the shell while keeping the renderer code unchanged. The renderer is plain TS/Three.js, so it can move between shells.

**Deliberately excluded for simplicity:** React or R3F (plain TS modules are enough for one canvas plus a small settings window), state-management libraries, Python, Docker, a local web server, and a bundled Ollama.

## 6. Proposed architecture diagram

```
┌───────────────────────────── Electron app (single installer, per-user) ─────────────────────────────┐
│                                                                                                     │
│  MAIN PROCESS (trusted, Node)                                                                       │
│  ├─ WindowManager    small transparent always-on-top overlay window, settings window, tray          │
│  ├─ CursorService    polls screen.getCursorScreenPoint() @30–60 Hz → IPC to renderer (DIP coords)   │
│  ├─ DisplayService   multi-monitor bounds, DPI changes, clamp overlay on screen                     │
│  ├─ SettingsStore    JSON in %APPDATA%; secrets via safeStorage (DPAPI)                             │
│  ├─ PermissionBroker mic/screen/tool permissions, confirmation prompts, audit log   (M4+)           │
│  ├─ ToolBroker       allowlisted, schema-validated actions; approval only from UI   (M8)            │
│  └─ LocalBridge      named pipe / 127.0.0.1 + token for MCP shim & Cursor hooks     (M6)            │
│         ▲  typed IPC (contextBridge, validated sender)                                              │
│         ▼                                                                                           │
│  OVERLAY RENDERER (sandboxed, no Node)                                                              │
│  ├─ Three.js scene + @pixiv/three-vrm (VRM 1.0)                                                     │
│  ├─ AvatarStateMachine  sleep ⇄ waking ⇄ idle ⇄ curious/happy/thinking/speaking                     │
│  ├─ Layers: VRMA clip mixer → procedural breathing → head/eye look-at → expressions → spring bones  │
│  ├─ HitTester   (raycast/alpha) → toggles click-through                                             │
│  └─ FrameGovernor  60 fps active / ~20 fps sleeping / 0 when hidden                                 │
│                                                                                                     │
│  UTILITY PROCESS "voice" (M4)          UTILITY PROCESS "brain" (M5)                                 │
│  ├─ mic capture (renderer→worklet)     ├─ LLMProvider interface                                     │
│  ├─ sherpa-onnx: VAD + KWS (wake)      │    ├─ OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio)
│  ├─ sherpa-onnx ASR (local)            │    └─ Anthropic                                            │
│  └─ TTS (local voice or cloud)         └─ emits {text, emotion, animation} events                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ stdio                                                     ▲ HTTPS (BYOK, opt-in)
 ┌──────┴──────────────┐   hooks.json "stop"/"beforeShellExecution"   ┌──────────────┐
 │ companion-mcp (shim)│◄──── Cursor IDE / Cursor CLI ───────────────►│ Cloud LLM API │
 └─────────────────────┘                                              └──────────────┘
                                  Ollama (optional, user-installed, localhost:11434)
```
