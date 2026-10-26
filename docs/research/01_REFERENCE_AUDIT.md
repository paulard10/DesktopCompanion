# 01 — Reference Audit

Research date: **2026-10-22**. Method: read-only inspection of public source through the GitHub REST API (`/repos`, `/git/trees`, `/commits`, `/releases`) and `raw.githubusercontent.com`, plus fetches of public web pages. **Nothing was cloned, installed, built or executed.** Downloaded text went to a temporary scratch folder only. One Violet FBX file was downloaded and checked with `grep` to read its bone names. It was never opened or run.

Evidence labels used throughout these documents:

- **VERIFIED**: seen directly in source code, a manifest, an API response or an official document. A link or path is given.
- **INFERRED**: a reasonable conclusion from verified evidence that was not tested directly.
- **UNKNOWN**: could not be determined without running code, logging in or getting more information.

Repository links use `https://github.com/<owner>/<repo>/blob/HEAD/<path>`.

---

## Summary matrix

| Reference | What it really is | Language / stack (VERIFIED) | Licence (VERIFIED) | Last push | Works on Windows today? | Overall usefulness to us |
|---|---|---|---|---|---|---|
| vovy.ai | Closed-source, paid **macOS** computer-use agent | Unknown (closed). Website is a Vite/React bundle that uses Supabase | Proprietary | n/a | **No.** The site FAQ says *"Not yet. Vovy runs on macOS today"* (VERIFIED, site bundle `/assets/index-Cb0NgOYi.js`) | Product/UX reference only |
| Instagram reel DevBejVAROV | Marketing reel by `jacksaltel`, caption *"this is Vovy"*, 2026-10-20 | n/a | n/a | n/a | n/a | Confirms the reel shows Vovy. The video content itself is UNKNOWN (login wall) |
| Hamza-Bilal-2002/Violet---Persona | Electron overlay + Three.js/VRM + **Docker Compose** Python backend | JS 396 KB, Python 209 KB | **No LICENSE file**. The README *claims* MIT | 2026-06-29 | Electron client yes. The backend needs Docker Desktop | High for overlay/lookAt *patterns*. Code reuse is legally blocked |
| ARPAHLS/avatar | Electron + React-Three-Fiber VRM "presenter" with an NSIS installer, an MCP server and a local agent bus | JS 483 KB | **MIT** | 2026-09-06 (v0.8.0) | Yes. Unsigned NSIS `AVATAR-Setup-0.8.0.exe` (674 downloads) | High for installer, agent-bus/MCP and asset-licence hygiene |
| haowenGuo/AILIS | Very large Electron "embodied agent" platform with a VRM pet, voice, memory, computer use and benchmarks | JS 9.4 MB, Python 818 KB, 1,186 files | **MIT** (but GPL-3 dependency, see below) | 2026-10-21 | Probably. Windows tarballs exist, but no installer is published | Medium. A good source of ideas (sherpa-onnx in Node, cursor polling). Too big to fork |
| morluto/rea | MCP server/CLI for **reverse engineering** binaries, Electron apps and websites | TypeScript 35.9 MB, many bridges | MIT | 2026-10-22 | Has Windows instructions | **Not needed** (see §6) |
| inni918/warashi | Repackaged **Open-LLM-VTuber** fork. Python server + **Live2D** UI in the browser | Python 964 KB | MIT core, plus a **non-commercial** frontend licence and the **proprietary** Live2D Cubism Core | 2026-08-18 | Yes, through `start-companion.bat` → `uv sync` → browser at `localhost:12393` | Medium for UX ideas (setup wizard, sleep/quiet mode). Wrong rendering tech and licence for us |

---

## 1. vovy.ai

- **VERIFIED** (site bundle FAQ strings): *"a computer use agent that works like a technical co-founder"*. It is activated by *"Hold the Fn and Control keys together, or click Vovy in your Mac's notch"*. It works with *"Cursor, Claude, ChatGPT, Replit, … Terminal"* by **seeing the screen and clicking/typing**, not through private integrations.
- **VERIFIED** privacy claims: *"only takes a screen snapshot in the moment you ask, never records continuously, and never saves screenshots to disk."* Safety claim: *"asks before any step it can't undo, like deleting files, spending money, or publishing your app."*
- **VERIFIED** pricing: Free (100 credits/month), Pro $30/month (500 credits), Max $100/month (2,000 credits). There is a Windows waitlist.
- **VERIFIED**: there is no wake word. It uses a hotkey or a click.
- **UNKNOWN**: the native tech stack, the LLM provider and whether a 3D avatar exists at all (the site only mentions a cursor-following presence).
- **Takeaway:** Vovy shows the product we are going after: a presence that is always available, screenshots taken only on demand, and confirmation before irreversible actions. That is the same safety model proposed in `05_SECURITY_AND_DISTRIBUTION.md`. Its Cursor support is **screen-based**, which confirms that no private Cursor API is needed.

## 2. Instagram reel

- **VERIFIED** (OpenGraph tags fetched with a crawler user agent): author `jacksaltel`, posted 2026-10-20, caption *"this is Vovy"*, 16 likes.
- **UNKNOWN**: what the video shows. Instagram needs a login to play it, and logging in would mean accessing private data, which the brief prohibits. **Needs user input:** describe which visual behaviours in the reel matter to you.

## 3. Violet — Persona (`Hamza-Bilal-2002/Violet---Persona`)

**Stack (VERIFIED):**
- Electron shell: `client/electron/package.json` lists `electron ^42.2.0` and `electron-builder ^25.1.8`, with runtime dependencies `whatsapp-web.js` (Puppeteer-driven WhatsApp automation) and `qrcode`.
- Renderer: `client/frontend/package.json` lists `three ^0.179.1`, `@pixiv/three-vrm ^3.4.2`, `three-stdlib` and `vite ^7`. It uses plain JS modules, not React.
- Backend: `server/docker-compose.yml` defines five FastAPI containers: `api` (OpenAI SDK), `speech` (faster-whisper 1.0.3, Whisper "tiny" int8 on CPU), `wake` (openwakeword 0.6.0 + onnxruntime), `tts` (piper-tts 1.2.0) and `embed` (fastembed bge-small). An optional `ollama` profile is included.

**Overlay implementation (VERIFIED, `client/electron/window.js`):**
- A full **work-area** window (`screen.getPrimaryDisplay().workArea`) with `frame:false, transparent:true, alwaysOnTop:true, skipTaskbar:true, resizable:false`.
- `setAlwaysOnTop(true, 'screen-saver')`.
- Click-through is the default, via `setIgnoreMouseEvents(true, { forward: true })`. The renderer hit-tests the avatar every frame and sends `persona:set-ignore-mouse` (`client/electron/ipc.js` ~L91).
- `setPermissionRequestHandler` **automatically grants** `media`/`microphone`/`audioCapture` and denies everything else.
- Hardening: `contextIsolation:true, nodeIntegration:false`, and navigation is blocked with `will-navigate`.
- **INFERRED limitation:** it covers only the *primary* display. Multi-monitor is not handled. A full-screen transparent window also costs more GPU compositing than a small window.

**Avatar behaviour (VERIFIED):**
- `client/frontend/js/managers/lookAtManager.js` drives the **head bone directly**, after `vrm.update`. VRM 1.0 `lookAt` with an `expression` applier only moves the eyes. Clamps: yaw 0.45 rad and pitch 0.30 rad. There is a "face proximity" fade to stop cross-eyed gazing when the cursor is over the face. **This is the most reusable idea in the reference set.**
- `avatarStateManager.js`: a simple switch over idle/talking/thinking/… that plays FBX clips. There is **no sleep state**.
- Present: `expressionManager.js`, `lipSyncManager.js` (audio analyser) and `performanceManager.js`.
- Animations are `public/animations/*.fbx`. **VERIFIED:** `idle.fbx` contains `mixamorig:Hips` / `mixamorig:Spine` bones, so these are **Mixamo** exports. Redistributing raw Mixamo files in a public repo is outside the commonly quoted Mixamo terms (see `05`).

**AI and voice (VERIFIED):**
- Wake word: `server/wake/app/main.py` uses openWakeWord with the bundled `hey_jarvis` model at threshold 0.35. The code comment notes that Porcupine personal access was removed in late 2024. The renderer streams 16 kHz Int16 PCM over a WebSocket (`client/frontend/js/voice/WakeWordClient.js`, `wakeProcessor.js`).
- STT is faster-whisper and TTS is Piper (`server/speech`, `server/tts`).
- LLM: `server/api/app/llm.py` has providers `auto | local | nvidia | openai`, all through the OpenAI-compatible SDK. `auto` prefers local Ollama and falls back to the cloud. It uses inline `<emotion/>`/`<animation>` tags in replies to drive the avatar.
- Tools: `client/electron/tools/*` (open app, volume, brightness, lock or sleep the PC, Spotify, WhatsApp). `openApp.js` runs `cmd start "" "<name>"` behind a regex allowlist `^[a-zA-Z0-9 ._-]+$`. That is good input hygiene, but there is **no user confirmation**.

**Windows readiness:** the client packages as NSIS plus a portable exe, **unsigned** (VERIFIED, README L264). The backend **requires Docker Desktop**, which the Electron shell starts with `spawn docker compose up -d` (`client/electron/dockerCompose.js`). That is **not acceptable for non-technical users** (INFERRED: it needs WSL2, virtualisation, admin rights and gigabytes of disk).

**Licence:** **VERIFIED** that the GitHub API reports no licence and the tree has no `LICENSE` file, although the README shows an MIT badge (L14, L287). Without a licence file or a header in each file, the grant is ambiguous. **Do not copy code.** Re-implement the ideas instead, or ask the author to add a LICENSE.

**Maintenance:** 5 stars, last push 2026-06-29. Probably a one-person portfolio project (INFERRED).

## 4. AVATAR (`ARPAHLS/avatar`)

**Stack (VERIFIED, `avatar/package.json`):** `electron ^34.5.8`, React 19, `@react-three/fiber` / `drei`, `three ^0.178`, `@pixiv/three-vrm` + `@pixiv/three-vrm-animation ^3.4.2`, `@modelcontextprotocol/sdk 1.30.0`, `ws`, `zod`, and electron-builder NSIS.

**Overlay (VERIFIED, `avatar/electron/main.cjs`):**
- A small resizable window (`transparent:true, frame:false`) with an "overlay mode" toggle that calls `setAlwaysOnTop(true,'screen-saver')` (~L465). Window bounds and scale are persisted.
- `snapToCorner()` uses `screen.getDisplayMatching(win).workArea`, so it is **multi-monitor aware** for positioning (~L593).
- **Not present** (grep): no `setIgnoreMouseEvents`, which means **no click-through**, and no `getCursorScreenPoint`, which means **no cursor tracking**.

**Agent integration (VERIFIED):**
- `avatar/electron/agent-bus.cjs` binds an HTTP/WS bus to `127.0.0.1` (`LOOPBACK_HOSTS` L34). It has an optional bearer token compared in **constant time** (L79) and rejects browser `Origin` headers (~L245). This is a good loopback-server pattern to copy.
- `avatar/electron/mcp-server.cjs` registers MCP tools `list_stage`, `get_status`, `play_animation`, `stop_animation`, `set_avatar` and `set_environment`. **This is direct evidence that an "agent drives the avatar through MCP" design works.**
- Credentials are stored with Electron `safeStorage` (DPAPI on Windows), including a Linux `basic_text` guard (L193–201).

**Voice:** amplitude-based lip sync from system or mic audio (`hooks/useAmplitudeLipSync.js`) and blinking (`hooks/useBlink.js`). It has **no** STT, wake word, TTS or LLM. The roadmap lists an *"Ollama adapter"* and *"VRM facial expressions"* as **not done** (`docs/development/roadmap.md`).

**Assets and licences:**
- **VERIFIED:** the code is MIT. A machine-readable `docs/assets-manifest.yml` records each bundled asset's rights holder and commercial-use status. That is exemplary and worth copying.
- **VERIFIED risk:** it bundles the pixiv **VRMA_MotionPack** (`src/assets/avatars/VRMA/VRMA_0x.vrma`). That pack's terms say *"the copyright belongs to pixiv Inc."* and **prohibit** *"Distributing these motions or their alterations without permission in a way that can be rigged or extracted."* Shipping the files in an asar archive is probably "extractable" (INFERRED). Avoid this in our product.
- The sample VRMs are VRoid Studio exports with `commercial_use: user_responsibility`.

**Windows evidence:** **VERIFIED** GitHub release `v0.8.0` with `AVATAR-Setup-0.8.0.exe`. The build disables signing (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `signAndEditExecutable:false`). CI runs on `ubuntu-latest` only (`.github/workflows/ci.yml` L18), so **there is no automated Windows test**. Whether it runs on Windows has to be tested by hand (UNKNOWN).

**Maintenance:** 28 stars, 20 open issues, regular releases from 2026-07 to 2026-09. Small but disciplined (tests, changelog, SECURITY.md).

## 5. AILIS (`haowenGuo/AILIS`)

**Stack (VERIFIED, `package.json`):** Electron `^41.2.0`, electron-builder `^26`, three `^0.183` with `@pixiv/three-vrm` / `-animation ^3.5.1`, **`sherpa-onnx-node 1.13.8`** (local ASR/TTS/VAD/KWS in Node, without Python), `@xenova/transformers`, `node-pty`, `imapflow`/`nodemailer` (email), `exceljs`, `pdfjs-dist`, `typescript-language-server`, **`stockfish`** (VERIFIED on npm: **GPL-3.0**), plus Python backend services and vLLM/WSL/Docker benchmark scripts.

**Pet window (VERIFIED, `electron/main.cjs`, 6,064 lines):**
- A small transparent pet window (~L4741) with `alwaysOnTop` at level `screen-saver`, `visibleOnFullScreen`, and `setPetMousePassthrough(true)`.
- **Cursor tracking by polling `screen.getCursorScreenPoint()` from the main process with `setInterval`** (`startPetCursorTracking` ~L2087). This tracks the cursor **anywhere on the desktop**, even while click-through is active. It is the right approach for a small window.
- A tray icon (`new Tray` ~L5012).

**Computer use (VERIFIED, `electron/ailis-computer-tool.cjs`):**
- It has a write-action approval guard, but `approvalRequired()` (L1500–1515) returns "no approval needed" when **`args.approved === true`**. `args` comes from the model's tool call, so **the model can approve its own actions** (INFERRED from the code path. An exploit was not attempted).
- `isFullControlContext()` accepts `'danger-full-access'`.
- **Lesson for us:** approvals must come from a UI event in a trusted process, never from tool arguments.

**Distribution:** release v1.4.9 ships "acceptance" tarballs for win32-x64/darwin/linux, but **no installer** is published (VERIFIED, releases API). The build has many steps, including runtime packs for Python/CosyVoice/ASR.

**Assessment:** the **reverse of "simple"**. It has 1,186 files, benchmark harnesses (SWE-bench, GAIA, OSWorld), payment/account docs and a GPL dependency. **Forking is not advisable.** Its use of `sherpa-onnx-node` inside Electron is the most valuable finding, because it shows that local speech can work without Python or Docker.

## 6. REA (`morluto/rea`)

- **VERIFIED** (README): *"One MCP for reverse engineering across binaries, applications, and runtime behavior."* Setup is `npx rea-agents setup`, which **registers an MCP server and installs workflow instructions into Claude Code/Codex/Cursor configs**. Native analysis drives Hopper, Ghidra or IDA.
- **Usefulness per investigation:**

| Investigation | Is REA useful? | Reason |
|---|---|---|
| Violet, AVATAR, AILIS, warashi | **No** | The full source is public. Direct reading is cheaper and more reliable |
| Electron/Tauri platform behaviour | No | Official docs and open-source runtimes exist |
| Vovy (closed macOS binary) | **Technically yes, but not recommended** | Our needs are product-level and covered by public claims. Reverse engineering a commercial binary may breach its EULA and has no clear benefit |
| Cursor integration | **No, and prohibited** | The brief forbids relying on private or undocumented Cursor state. REA would surface exactly that |

- **Supply-chain note (VERIFIED):** the API reports **362,912 stars and 91,030 forks** for a repo created on 2026-04-14. That is anomalous (INFERRED: popularity is not evidence of quality or safety). The README itself warns about impostor repos. Installing it would change global agent settings, which the brief prohibits. **REA was not installed or run.**

## 7. Warashi (`inni918/warashi`)

- **VERIFIED:** a *"friendly re-packaging"* of **Open-LLM-VTuber** (README L17). The Python FastAPI server (`src/open_llm_vtuber/…`, `run_server.py`) is managed with `uv`. The UI is a **precompiled** web bundle (`frontend/assets/main-*.js`) shown **in the user's browser** at `http://localhost:12393`, not as a desktop overlay.
- Avatar: **Live2D** using `frontend/libs/live2dcubismcore.min.js` (proprietary, *"Redistributable Code"* under the Live2D Proprietary Software License, per `NOTICE`), with sample models `haru`, `hiyori` and `mao_pro`.
- Voice: Silero VAD in the browser (`frontend/libs/silero_vad_v5.onnx`, `ort-wasm*.wasm`), ASR through sherpa-onnx or faster-whisper (`doc/sample_conf/*`), and TTS defaulting to **edge-tts** (an unofficial client for Microsoft's online voice). There is **no wake word**. It uses VAD with barge-in instead. A "sleep/quiet mode" is a conversational mode, not an animation.
- LLM: a setup wizard for an OpenAI, Claude or Gemini key or local Ollama (default `qwen2.5:3b`).
- **Licensing (VERIFIED, README L238 / `NOTICE`):** the frontend bundle uses the **Open-LLM-VTuber License 1.0** (Apache-2.0 + conditions). *"commercial rebranding, paid hosting/SaaS, or embedding in a paid product needs a separate commercial license."* **This makes it incompatible with eventual commercial distribution.**
- **Windows evidence (VERIFIED):** `start-companion.bat` installs `uv`, runs `uv sync` and opens the browser. Release `Warashi-v0.1.10.zip` has 1,055 downloads. The README documents a ~1 GB ASR model download on first run and SmartScreen warnings. Installing a toolchain at runtime is a supply-chain and UX risk (INFERRED).

---

## 8. Additional repositories examined (targeted)

| Repo | Why it matters | Licence / activity (VERIFIED via API) |
|---|---|---|
| `pixiv/three-vrm` | The standard VRM loader for Three.js: expressions, lookAt, spring bones, MToon, and **VRMA** via `@pixiv/three-vrm-animation`. v3 supports WebGPU (`MToonNodeMaterial`, three r167+) | MIT. Pushed 2026-10-22. npm 3.5.5 (2026-07-09) |
| `k2-fsa/sherpa-onnx` | One Apache-2.0 runtime covering **open-vocabulary keyword spotting**, VAD, streaming ASR and TTS. Ships an npm `sherpa-onnx-node` with a prebuilt `sherpa-onnx-win-x64` (npm `os:["win32"], cpu:["x64"]`, with SLSA provenance) | Apache-2.0. 15.4k stars. Pushed 2026-10-22 |
| `dscripka/openWakeWord` | Used by Violet | Code Apache-2.0, but **pre-trained models are CC BY-NC-SA 4.0** (HF model card). Last push 2025-12-30 |
| `Picovoice/porcupine` | Commercial-grade wake word | SDK Apache-2.0. Custom keywords fall under Picovoice Console terms, and published sources **conflict** on free commercial use |
| `rhasspy/piper` → `OHF-Voice/piper1-gpl` | Local TTS | The original is **archived**. The successor is **GPL-3.0** |
| `moeru-ai/airi` | The largest open-source "AI waifu/companion" (50k stars). Desktop app `apps/stage-tamagotchi` uses **Electron + three + electron-builder** (VERIFIED from package.json) | MIT. Very active. Not inspected deeply; a candidate for future review |
| `Open-LLM-VTuber/Open-LLM-VTuber` | Upstream of warashi | Licence reported as NOASSERTION (mixed) |
| `saturday06/VRM-Addon-for-Blender`, `vrm-c/UniVRM` | Authoring and validating VRM, and exporting VRMA | MIT, active |
| `microsoft/TRELLIS`, `VAST-AI-Research/UniRig`, `Tencent-Hunyuan/Hunyuan3D-2` | Image-to-3D and auto-rigging research (see `03`) | MIT / MIT / Tencent community licence (excludes EU/UK/KR) |

---

## 9. Feature-presence matrix (code evidence)

| Capability | Violet | AVATAR | AILIS | Warashi |
|---|---|---|---|---|
| Transparent always-on-top overlay | ✅ `window.js` | ✅ overlay mode | ✅ pet window | ❌ browser tab |
| Click-through transparent regions | ✅ renderer hit-test + `setIgnoreMouseEvents` | ❌ | ✅ `setPetMousePassthrough` | ❌ |
| Desktop-wide cursor tracking | ✅ (`forward:true`, primary display only) | ❌ | ✅ main-process polling | ❌ (Live2D mouse-follow in the page only, INFERRED) |
| VRM expressions blending | ✅ graded 0..1 `expressionManager.js` | ⚠ blink + lip sync only | ✅ (INFERRED from VRM + emotes resources) | n/a (Live2D) |
| VRM animations | FBX (Mixamo) retargeted | ✅ VRMA | ✅ VRMA (includes `Sleepy.vrma`) | Live2D motions |
| Sleep / wake animation state | ❌ | ❌ | partial (`Sleepy.vrma` asset) | "quiet mode" (conversational) |
| Wake word | ✅ openWakeWord "hey_jarvis" (Docker) | ❌ | UNKNOWN (sherpa-onnx KWS is available in its dependency) | ❌ VAD only |
| STT | ✅ faster-whisper (Docker) | ❌ | ✅ sherpa-onnx / bundled ASR | ✅ sherpa-onnx / faster-whisper |
| TTS | ✅ Piper (Docker) | ❌ | ✅ (CosyVoice runtime pack) | ✅ edge-tts default |
| Lip sync | ✅ analyser | ✅ amplitude | ✅ (INFERRED) | ✅ Live2D |
| AI provider abstraction | ✅ OpenAI-compatible + Ollama | ❌ (agent bus only) | ✅ many providers | ✅ wizard: OpenAI/Claude/Gemini/Ollama |
| MCP | ❌ | ✅ server | ✅ client adapter | ✅ (`mcpp` module, INFERRED) |
| Computer-use tools | ✅ fixed tools, no confirmation | ❌ | ✅ broad, flawed approval | ❌ |
| Installer | NSIS unsigned + Docker | NSIS unsigned | tarballs | zip + .bat + uv |

## 10. Reuse verdict

| Item | Decision | Reason |
|---|---|---|
| Violet `lookAtManager` head-bone technique | **Re-implement the idea** | Best technique, but no licence grant |
| Violet hit-test-driven click-through | **Re-implement** | Standard Electron pattern |
| AILIS main-process `getCursorScreenPoint` polling | **Re-implement** (MIT allows adapting it) | Works with a small window and across monitors |
| AVATAR agent-bus loopback and token design, `assets-manifest.yml` | **Adapt** (MIT, keep attribution) | Good security and licence hygiene |
| AVATAR MCP tool surface | **Adapt the shape** | Matches what we need for Cursor |
| three-vrm / three-vrm-animation | **Depend on** | Official, MIT, maintained |
| sherpa-onnx-node | **Depend on later** (M4) | Local KWS/ASR/TTS without Python |
| Any bundled VRM/VRMA/FBX/Live2D asset from references | **Do not reuse** | Licence restrictions or ambiguity |
| Docker/Python backends (Violet, warashi, AILIS) | **Do not reuse** | Wrong for consumer distribution |
| AILIS computer-use tool | **Do not reuse** | Self-approval flaw. Far too broad |
