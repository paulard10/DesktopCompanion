# M1.8B.0 — Windows local TTS feasibility pilot

**Date:** 2026-10-24  
**Status:** research and isolated pilots only. **No TTS is integrated into production chat, Qwen, ASR, credentials, click-through, or sleep/wake.**  
**Machine:** Windows 11 (agent environment), DesktopCompanion Electron 44.9.3, 8 GB class laptop (same product target as prior voice research).

## 1. Executive summary

**Recommendation: GO for M1.8B.1 using an installed Windows Spanish voice through a main-process native synthesizer bridge**, with **automatic reading OFF by default**, explicit Play/Stop, and a **mandatory user-performed offline (airplane-mode) check** before calling the feature “local.”

**Do not ship Chromium `speechSynthesis` in the production chat as the primary path** without passing that offline gate: it exposes playback inside the sandboxed renderer, conflates `localService` with privacy, and showed **~1.6 s** from user action to first audible boundary in the pilot. **`System.Speech.Synthesis.SpeechSynthesizer`** on this PC already exposes **Microsoft Helena Desktop (es-ES)** and completed the same test sentence in **~4.7 s** total with no extra download.

**NO-GO (for now)** on bundling **Piper** or **sherpa-onnx TTS** as the first implementation: better expected quality, but **GPL / phonemizer / per-voice rights** and **tens of megabytes** of packaged weight remain unresolved ([architecture research](12_LOCAL_VOICE_ARCHITECTURE.md)). Revisit only if installed Windows voices fail the offline or quality gate.

---

## 2. Phase 1 — Application inspection (no behavior changes)

### Chat renderer

- Push-to-talk ASR lives in `src/renderer/chat.ts` + `speechCapture.ts`: mic button, staged transcript, insert-to-draft, **no auto-send to Qwen**.
- Send remains disabled while `speech.currentState !== 'idle'` or while Qwen is busy.
- Chat hides/minimizes and `pagehide` / visibility / blur cancel recording; main process disarms the microphone gate on close.

### Electron security (relevant to future TTS)

- Production CSP: **`connect-src 'none'`** (`src/shared/csp.ts`). TTS must not rely on renderer network access.
- Microphone: **narrow gate** — only the trusted chat frame, only while armed for ~10 s after user action (`src/main/security.ts`). TTS must **not** open the microphone.
- Trusted renderers: robot `index.html` and `chat.html` only (`src/shared/trustedUrl.ts`).
- ASR memory guard unchanged: **1,024 MiB** available physical memory preflight (`src/main/localSpeech.ts`, [17_ASR_MEMORY_DIAGNOSTICS.md](17_ASR_MEMORY_DIAGNOSTICS.md)).

### Pilot isolation

Dev-only artifacts (not in Vite build inputs, not imported by the app):

| Artifact | Role |
|---|---|
| `scripts/tts-voice-inventory.ps1` | SAPI + registry enumeration |
| `scripts/tts-sapi-measure.ps1` | SAPI timing sample |
| `scripts/tts-pilot.html` | Manual Chromium voice UI |
| `scripts/tts-pilot-electron.mjs` | Isolated Electron window |
| `scripts/tts-pilot.mjs` | `inventory` / `measure` / `verify-files` CLI |
| `scripts/tts-pilot.test.mjs` | Regression guards |

Launch manual UI:  
`node node_modules/electron/cli.js scripts/tts-pilot-electron.mjs`  
(Windows only; **sound plays only after you click Play**.)

---

## 3. Phase 2 — Voice inventory (this PC, 2026-10-24)

### 3.1 `System.Speech.Synthesis` (SAPI desktop voices)

| Name | Culture | Gender | Notes |
|---|---|---|---|
| **Microsoft Helena Desktop** | **es-ES** | Female | Primary Spanish (Spain) desktop voice |
| Microsoft Zira Desktop | en-US | Female | English fallback |

**Count:** 2 installed voices visible to `SpeechSynthesizer.GetInstalledVoices()`.

### 3.2 Registry tokens (OneCore vs legacy)

**OneCore (`HKLM\...\Speech_OneCore\Voices\Tokens`):**

- `MSTTS_V110_esES_HelenaM`
- `MSTTS_V110_esES_LauraM`
- `MSTTS_V110_esES_PabloM`

**Legacy (`HKLM\...\Speech\Voices\Tokens`):**

- `TTS_MS_ES-ES_HELENA_11.0`
- `TTS_MS_EN-US_ZIRA_11.0`

Laura and Pablo appear in OneCore but **not** in the legacy SAPI desktop list above; Chromium exposes all three (see below).

### 3.3 Chromium `speechSynthesis.getVoices()` (Electron 44 pilot)

After `voiceschanged`, **3 voices** (headless pilot):

| name (voiceURI) | lang | localService | default |
|---|---|---:|---|
| Microsoft Helena - Spanish (Spain) | es-ES | **true** | (varies) |
| Microsoft Laura - Spanish (Spain) | es-ES | **true** | |
| Microsoft Pablo - Spanish (Spain) | es-ES | **true** | |

**Not observed on this machine in the pilot:** es-MX / es-419 Latin American Spanish, **Catalan (ca-*)**, or separate en-US entry in Chromium (English still available via SAPI Zira).

### 3.4 Limitations

- **`localService === true` is not proof of offline processing.** Chromium may still use OS components that behave differently offline; Microsoft also ships **online** neural voices in other contexts. Treat offline as **verified only after a user disconnects the network** (see §4).
- **Voice catalogs differ by API:** SAPI desktop list ⊂ OneCore registry ⊂ Chromium list on this PC.
- **No language packs were installed** during this milestone.

---

## 4. Phase 3 — Offline verification

### 4.1 What was tested automatically

| Test | Network state | Result |
|---|---|---|
| SAPI speak (Helena, es-ES) | Online (default) | Success, 38-char sentence |
| Chromium autoplay (Helena, localService) | Online (default) | Success |
| Chromium cancel @ 120 ms | Online | `cancel()` ~124 ms, `error: interrupted` |

### 4.2 What was **not** tested by the agent

**Airplane-mode / disconnected playback was not executed in this session** (per task: do not change network settings automatically).

### 4.3 Manual offline procedure (required before M1.8B.1 sign-off)

1. Quit other bandwidth-heavy apps. Note Task Manager **Performance → Wi‑Fi/Ethernet** disconnected or airplane mode on.
2. Open the pilot: `node node_modules/electron/cli.js scripts/tts-pilot-electron.mjs`.
3. Click **Refresh voices**, select **Helena** (or Laura/Pablo), click **Play** once.
4. Confirm audible Spanish without delay or error toast.
5. Repeat with **Settings → Network** still off using SAPI (optional):  
   `powershell -ExecutionPolicy Bypass -File scripts/tts-sapi-measure.ps1`
6. If playback fails offline, **stop**: do not label the feature local; do not ship Chromium-only TTS without a native fallback.

Record pass/fail and date in the M1.8B.1 validation notes.

---

## 5. Phase 3 — Measurements (online pilot, approximate)

Test sentence (non-sensitive): **`Hola. Soy tu compañero de escritorio.`** (38 characters)

| Metric | Chromium `speechSynthesis` (Helena, localService) | `System.Speech` (Helena Desktop) |
|---|---|---|
| Time to **`onstart`** | **~1647 ms** after Play | (not split; synchronous API) |
| Time to **first `boundary`** (audible proxy) | **~1661 ms** | n/a |
| **Total utterance duration** | **~5275 ms** (`onend`) | **~4656 ms** (Stopwatch) |
| **Cancel responsiveness** | **~124 ms** to `cancel()` (120 ms scheduled interrupt) | not measured here |
| **Available RAM delta** (single sample) | freemem **426 → 1039 MiB** during run* | not measured |
| **CPU** | not instrumented (subjective: low in pilot) | not instrumented |

\*Large freemem swing reflects **OS reclaim**, not TTS allocation; do not treat as TTS memory cost. No isolated working-set measurement was taken for TTS alone.

### Subjective listening instructions (human)

Use the manual pilot UI; compare **Helena vs Laura vs Pablo** at rate 1.0:

1. Short greeting: test sentence above.
2. Longer line (~120 chars): *“Gracias por probar la voz. El robot no puede ver tu pantalla, pero puede hablar contigo en español.”*
3. Score 1–5: **clarity**, **naturalness**, **robotic tone**, **acceptable for a desktop companion**.
4. Repeat once with **Windows speaker volume** at 30% and 70%.
5. If any voice is unintelligible or uncomfortably metallic, record which name failed.

Expected outcome on Helena-class voices: **clear but noticeably synthetic** (consistent with [04_VOICE_AND_AI_STACK.md](04_VOICE_AND_AI_STACK.md) SAPI note).

---

## 6. Phase 4 — Proposed `TextToSpeechProvider` architecture

Leaf module (zero renderer imports), implemented in main or a disposable utility process in M1.8B.1:

```typescript
export type TtsVoice = {
  id: string;           // stable key, e.g. "es-ES:Helena"
  label: string;        // display only
  locale: string;       // BCP-47
  source: 'windows-sapi' | 'windows-winrt' | 'chromium';
};

export type TtsPlaybackState = 'idle' | 'speaking' | 'paused';

export interface TextToSpeechProvider {
  /** Installed/offline-capable voices; empty if none. */
  listVoices(): Promise<readonly TtsVoice[]>;

  /** Speak bounded plain text. Throws if text empty or over limit. */
  speak(text: string, options: {
    voiceId?: string;
    signal: AbortSignal;
  }): Promise<{ elapsedMs: number }>;

  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;

  /** For UI only; no text content. */
  state(): TtsPlaybackState;
}
```

**Policy layer (not inside the provider):**

| Requirement | Handling |
|---|---|
| Explicit play / stop | UI buttons; `stop()` on new play, chat close, app quit |
| Auto-read replies | **Default OFF**; optional setting, local only |
| Mute | Persisted preference; when muted, `speak` is not called |
| New message while speaking | `stop()` then optional queue (default: **no queue**, stop only) |
| Text limits | Cap e.g. **500 chars** (match user chat) or **1600** for assistant bubble; strip/control chars |
| No logging | Log `tts-play result=ok\|cancelled\|error` only |
| No cloud / paid API | Provider allowlist: Windows local only until user opts into something else |
| No extra Qwen call | TTS consumes existing assistant text only |
| ASR exclusion | `AudioSessionController` (future) or chat rule: **if `speechCapture` not idle, refuse TTS** |
| Reduced motion | Optional: skip “speaking” animation amplitude; do not skip accessibility of controls |
| Mic gate | Never arm microphone for TTS |

**Suggested implementation order:** `WindowsSapiTtsProvider` in main via `powershell`/COM edge is heavy; prefer **.NET `System.Speech` in a tiny helper** or **WinRT `SpeechSynthesizer`** with IPC parallel to ASR (spawn/in-process per security review). Keep **Chromium `speechSynthesis` as dev pilot only** until offline gate passes.

---

## 7. Phase 5 — Comparison (built-in vs Piper vs sherpa-onnx)

No Piper/sherpa binaries were downloaded. Values below cite [12_LOCAL_VOICE_ARCHITECTURE.md](12_LOCAL_VOICE_ARCHITECTURE.md) and primary sources.

| Criterion | Installed Windows voice (tested) | Piper (OHF, es_ES davefx medium) | sherpa-onnx TTS + Piper voice |
|---|---|---|---|
| Spanish quality | Understandable, **legacy/neural mix depending on voice**; Laura/Pablo untested by ear here | Expected **more natural**; not auditioned | Same acoustic model as Piper if same voice |
| RAM | **Low incremental** in pilot; no sustained model resident | ONNX + runtime; **unmeasured**, likely **≫** SAPI | Similar + Node/native DLLs |
| Latency | **~1.6 s** to first boundary (Chromium); SAPI **~4.7 s** total for short line | Synthesis + load; cold start unmeasured | Similar |
| Offline privacy | **Good if offline test passes**; no third-party cloud in SAPI path | Fully offline synthesis | Fully offline |
| Install size | **0 MiB** bundled (uses OS) | **~60 MiB** voice + engine/runtime | Voice + ONNX + **GPL phonemizer chain** |
| Electron packaging | Native bridge + IPC | C++/CLI or sidecar; ONNX Runtime | `sherpa-onnx-node` + unpack rules |
| Commercial redistribution | **OS/API terms**; no voice binary shipped | **GPL-3.0 engine**; **voice rights unresolved** | Apache engine but **GPL eSpeak/piper-phonemize** |

---

## 8. Phase 6 — Validation performed

| Check | Result |
|---|---|
| `npm run typecheck` | Pass (this milestone) |
| Automated tests | **94/94 pass** including `scripts/tts-pilot.test.mjs` (production chat still has **no** `speechSynthesis`) |
| Qwen / ASR / credentials | Unchanged (`enable_thinking: false`, ASR 1024 MiB guard) |
| Production chat modified | **No** |
| Live Model Studio call | **No** |
| `npm run smoke` | **Not re-run here** — if DesktopCompanion is already running (`npm run start`), smoke will exit as second instance; quit the app and run `npm run check` for a clean smoke pass |

---

## 9. GO / NO-GO

| Decision | Rationale |
|---|---|
| **GO — M1.8B.1** | Installed **es-ES** voices exist; pilots speak the test sentence; cancel is fast; zero bundle size; aligns with [12_LOCAL_VOICE_ARCHITECTURE.md](12_LOCAL_VOICE_ARCHITECTURE.md) first experiment. |
| **NO-GO — ship Chromium-only TTS now** | Offline not verified by agent; ~1.6 s pre-audible latency; renderer placement weaker than main-process native API. |
| **NO-GO — bundle Piper/sherpa now** | Licence/weight/complexity; ASR already consumes memory budget on 8 GB machines. |

---

## 10. Next implementation milestone — **M1.8B.1**

1. Implement **`TextToSpeechProvider`** (Windows native first) in **main process**, IPC `chat:tts-play` / `chat:tts-stop` with preload allowlist (mirror ASR pattern).
2. Chat UI: **Speak** on assistant/demo bubbles only; **mute** toggle default **on** (muted = no speech); **stop** on second click or new speak.
3. Block TTS while **`SpeechCapture` ≠ idle**; block ASR start while TTS speaking.
4. User **offline validation** checklist (§4.3) on target hardware.
5. Optional: lip-sync / `RESPONDING` presence driven by **playback state events**, not text analysis.
6. Do **not** auto-read Qwen streams; do **not** send text to cloud TTS.

**Stop line:** M1.8B.0 ends at research + pilots. **No production integration** until M1.8B.1 is approved after your offline listening test.
