# 05 — Security, Privacy, Licensing and Distribution

## 1. Electron hardening baseline (applies from M1)

| Control | Setting | Reason |
|---|---|---|
| Renderer isolation | `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true` | Defaults in modern Electron. Make them explicit (Violet and AVATAR set the first two, VERIFIED) |
| Content | Load only `file://` / custom `app://` from asar. Strict CSP `default-src 'self'`. No remote URLs in privileged windows. Block `will-navigate` and `setWindowOpenHandler` → deny | Prevents remote code from reaching IPC |
| IPC | A small, typed API in `preload` (`contextBridge`). Validate `event.senderFrame.url` and payload schemas (zod) in main | Renderer compromise must not equal system compromise |
| Fuses | Disable `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`. Enable `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar` (`@electron/fuses`) | Stops the app binary being reused as a generic Node runtime |
| Permissions | `setPermissionRequestHandler`: deny all except `media` (audio only) **after** user consent. Never auto-grant like Violet does | Privacy |
| Secrets | `safeStorage` (DPAPI on Windows). AVATAR's Linux `basic_text` guard is worth copying (VERIFIED) | No plaintext keys |
| Local servers | Prefer **named pipes**. If you must use TCP, bind `127.0.0.1` with a random per-install bearer token, compare it in constant time, and reject requests with a browser `Origin` (AVATAR `agent-bus.cjs` pattern, VERIFIED) | DNS-rebinding and CSRF from web pages |
| Updates | Keep within one or two Electron majors of the latest. Pin versions that have been out for at least 2 weeks | Chromium CVEs |

## 2. Computer-use: secure boundaries (M8+)

**Principle:** the LLM proposes actions and a trusted broker in the main process executes them. **Approval comes only from a user gesture in a trusted UI.** It can never come from tool arguments. Counter-example (VERIFIED): AILIS `approvalRequired()` accepts `args.approved === true` (`electron/ailis-computer-tool.cjs` L1507).

| Tier | Examples | Default | Confirmation |
|---|---|---|---|
| T0 Presence | Animations, speech, cursor tracking | On | None |
| T1 Context (read, low sensitivity) | Active app name and window title | Off → opt-in | One-time consent. Visible indicator |
| T2 Perception (sensitive read) | **One** screenshot on explicit request ("look at this"), clipboard read | Off → opt-in | Per use: a "📸 capturing" flash, never continuous (the Vovy policy, VERIFIED site FAQ). Redact password fields where detectable. Never written to disk unless the user asks |
| T3 Reversible actions | Open an allowlisted app or URL, copy text to the clipboard, start or stop media, show a notification | Off → opt-in per capability | Confirm the first time, then optional "always allow *this* action" |
| T4 Consequential actions | Type or click in other apps, run shell commands, edit or delete files, send messages or email, purchases, Cursor CLI runs | Off. Off by default even after setup | **Every time:** a modal that shows the exact action (command line, file path, recipient, text) with Approve / Deny. A timeout means deny |
| T5 Forbidden | Credential stores, password managers, banking or payment UIs, disabling security software, elevation (UAC), editing our own permission config | Never | Not implementable through tools |

Controls:
- Tools are declared with JSON schemas.
- Arguments are validated, and paths are canonicalised against an allowlisted workspace.
- There is no generic `exec`. Shell access, if ever offered, is limited to *specific named commands*.
- Rate limits per tool.
- An **append-only audit log** viewable in Settings.
- A global **kill-switch hotkey** that cancels all pending actions and the LLM stream.
- Screen and web content is treated as untrusted (prompt injection), so text read from the screen cannot raise privileges.
- UAC and secure-desktop prompts can't be automated by design. Don't try.

## 3. Privacy defaults

- No telemetry by default. Opt-in crash reports only, with no audio, screenshots or prompts.
- Mic off until the user enables it. Wake-phrase detection is local, and audio before the wake word is never stored.
- The cloud LLM is used only after the user enters a key. A clear "Local only" switch.
- Data lives in `%APPDATA%/<App>`, with a one-click "Delete all my data".

## 4. Supply-chain risk

| Risk | Mitigation |
|---|---|
| npm dependency sprawl | Keep runtime dependencies minimal (MVP: `three`, `@pixiv/three-vrm`). Commit `package-lock.json`. Use `npm ci`. Review install scripts (`npm ci --ignore-scripts` + allowlist) |
| Typosquats and impostor repos | Install from official orgs only. REA's own README warns about copies (VERIFIED) |
| Native addons (sherpa-onnx-node, later) | Prefer packages with npm **provenance attestations** (sherpa-onnx-node 1.13.8 has SLSA provenance, VERIFIED registry metadata). Pin exact versions |
| Model downloads | Pinned URLs + SHA-256. Show the size before downloading. Store under app data |
| Runtime toolchain installers | **Never** install `uv`, Python or Docker at runtime (warashi's `start-companion.bat` installs uv, VERIFIED) |
| Unsigned binaries | Code-sign (see §6) |
| GPL contamination | No GPL runtime dependencies (AILIS pulls `stockfish` GPL-3.0, VERIFIED npm). Avoid Piper's GPL successor |
| Generate an SBOM | `npm sbom` or CycloneDX per release. Licence scan in CI |

## 5. Licensing for commercial distribution

| Component | Licence | Commercial OK? |
|---|---|---|
| Electron, three.js, three-vrm(-animation), Vite, electron-builder, electron-updater, MCP SDK | MIT (VERIFIED npm) | ✅ Include notices |
| sherpa-onnx runtime | Apache-2.0 | ✅ Notices + NOTICE file |
| KWS/ASR/TTS **models** | Per model | ⚠ Check each. Kokoro-82M Apache-2.0 ✅. openWakeWord pre-trained models ❌ (NC) |
| Tauri (if chosen) | Apache-2.0 OR MIT | ✅ |
| Live2D Cubism Core | Proprietary | ⚠ Needs a publication licence above thresholds |
| Hunyuan3D outputs/models | Tencent community licence, **not licensed in the EU/UK/KR** | ❌ for an EU-based team |
| TRELLIS | MIT (code + HF weights tag) | ✅ (verify training-data caveats) |
| Mixamo animations | Adobe terms: no raw-file redistribution | ⚠ Avoid |
| pixiv VRMA MotionPack | pixiv terms: no extractable redistribution | ❌ Don't bundle |
| VRoid Studio exports | Creator-set permissions | ✅ when **you** are the creator. Verify VRoid's base terms |
| Open-LLM-VTuber web frontend | OLV Licence 1.0 (non-commercial) | ❌ |
| Violet code | No licence file | ❌ Don't copy |
| AVATAR, AILIS code | MIT | ✅ With attribution (avoid AILIS's GPL dependencies) |

## 6. Distribution on Windows

- **Packaging:** electron-builder **NSIS, per-user install** (`perMachine:false`, no admin rights needed). Start-menu shortcut, optional "start with Windows" (`app.setLoginItemSettings`), clean uninstaller with an "also delete my data?" checkbox. Violet and AVATAR both use NSIS (VERIFIED).
- **Code signing:** without it, SmartScreen shows "Windows protected your PC" (every reference ships unsigned, VERIFIED READMEs/configs).
  - **Azure Artifact Signing** (formerly Trusted Signing) is GA. Individuals are eligible **only in the US/Canada**. Organisations are eligible in the US, Canada, EU and UK. About $9.99/month ([Microsoft Learn quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart), [DevClass](https://devclass.com/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/)).
  - Otherwise, use an OV certificate on a hardware token or cloud HSM from a public CA.
  - SmartScreen reputation still builds over time (UNKNOWN how fast).
- **Auto-update:** `electron-updater` against signed GitHub Releases (or a static bucket), with differential updates. Signature verification is required.
- **Microsoft Store (later):** MSIX via electron-builder `appx` gives Store-managed trust and updates (INFERRED to be viable once the app is stable).
- **Size budget:** installer ≤ 120 MB without speech models. Models are downloaded on demand.

## 7. Docker and Python assessment

| Dependency | Appropriate for consumer Windows? | Reason |
|---|---|---|
| Docker Desktop (Violet) | **No** | Needs WSL2/Hyper-V, admin rights, multi-GB disk and RAM, and a commercial-use licence for larger companies (Docker subscription terms, INFERRED). Not something a non-technical user can manage |
| Python runtime + uv (warashi, AILIS packs) | **No for the core app.** Maybe as a separately downloaded "pro pack" for advanced users | Antivirus false positives, path issues, a large footprint, and dependency resolution at runtime (warashi troubleshooting documents these, VERIFIED README L204–213) |
| Ollama (separate app, user-installed) | **Yes, optional** | Signed installer, user-managed. We only connect to localhost |
| Native Node addons (sherpa-onnx-node) | **Yes** | Ships inside our installer. No toolchain on the user's machine |
