# 04 — Voice and AI Stack

## 1. Voice pipeline overview

```
mic (Web Audio, 16 kHz mono) ─► VAD (Silero via sherpa-onnx) ─► KWS wake phrase ─► ASR ─► LLM ─► TTS ─► audio out + lip sync
                                      ▲                                   ▲
                                      └── push-to-talk hotkey / click bypasses KWS
```

Everything before "LLM" runs **locally**. Audio is never sent to the cloud before the wake phrase is detected, and even after detection only if the user chose a cloud ASR.

## 2. Wake-word engines

| Engine | Licence (VERIFIED) | Configurable phrase? | Runs in Node/Electron without Python? | Notes |
|---|---|---|---|---|
| **sherpa-onnx KWS** | Apache-2.0 runtime. Models from k2-fsa | **Yes, open vocabulary.** *"you can specify any keywords without re-training the model"* using a `keywords.txt` with a boosting score `:` and threshold `#` ([sherpa KWS docs](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)) | **Yes.** `sherpa-onnx-node` 1.13.8 with prebuilt `sherpa-onnx-win-x64` (npm metadata, SLSA provenance). Already used by AILIS | Models are ~3.3M parameters (gigaspeech English, wenetspeech Chinese, zh-en 2025-12-20). False-accept figures are **UNKNOWN** and must be measured |
| openWakeWord | Code Apache-2.0. **Pre-trained models CC BY-NC-SA 4.0** ([HF model card](https://huggingface.co/davidscripka/openwakeword/raw/main/README.md)) | Needs training a model per phrase (synthetic TTS data) | Python library. ONNX models could run under onnxruntime-node, but feature extraction would need porting (INFERRED) | **Non-commercial models.** Used by Violet |
| Picovoice Porcupine | SDK Apache-2.0. Console-trained keywords use Picovoice terms | Yes (Console, seconds) | Yes (Node SDK) | Sources **conflict** on free commercial use ([pricing](https://picovoice.ai/pricing) vs [blog](https://picovoice.ai/blog/introducing-picovoices-free-tier)). Needs an AccessKey (online activation, INFERRED). A good paid fallback if KWS accuracy is poor |
| Windows Speech (SAPI / WinRT) | OS | Grammar-based | Needs a native addon | Lower quality and Windows-only. Not recommended |

**Recommendation:** sherpa-onnx KWS (English model first) as the default, with user-editable phrases, sensitivity presets (Low/Medium/High mapped to threshold and boost), **click and a global push-to-talk hotkey as always-available fallbacks**, and a "wake phrase OFF" default until the user enables the microphone.

**Reliability (INFERRED):**
- Short phrases (2 syllables) cause many false accepts. Recommend 3–4 syllable phrases ("Hey Luma", "Okay Nova").
- Gate KWS behind VAD to save CPU and false accepts.
- Add a 1.5 s **verification window**: after a KWS hit, run streaming ASR on the buffered audio and confirm that the transcript contains the phrase. This roughly halves false accepts at the cost of about 300 ms (INFERRED from common practice).
- Measure on a 1-hour "TV/podcast in background" test: target **≤ 1 false accept per 8 hours** and **≥ 90% true accepts** at 1 m in a quiet room.

**CPU cost (INFERRED):** VAD on 30 ms frames plus KWS at about 3M parameters costs low single-digit % of one core on a modern laptop CPU. Benchmark it in M4. Whisper-class ASR costs far more and should run **only after** wake.

## 3. Speech-to-text

| Option | Licence | Offline | Cost | Fit |
|---|---|---|---|---|
| sherpa-onnx streaming Zipformer / Paraformer / SenseVoice / Whisper ONNX | Apache-2.0 runtime. Model licences vary (check each) | ✅ | CPU only, real-time on modern CPUs (INFERRED) | **Default local** |
| whisper.cpp (`ggml-org/whisper.cpp`, MIT) | MIT, Whisper weights MIT | ✅ | Base/small models fine on CPU, slower than streaming models | Alternative (needs a native addon or a spawned binary) |
| faster-whisper (MIT) | — | ✅ | **Python + CTranslate2** | Rejected (Python) |
| Cloud STT (OpenAI, Deepgram, Azure) | Proprietary | ❌ | Per minute | Optional BYOK |

**Model download policy:** don't bundle a 1 GB model in the installer (warashi's first run downloads about 1 GB, VERIFIED README). Ship a small default (≤ 100 MB) or download on demand with **pinned URLs + SHA-256 verification**.

## 4. Text-to-speech

| Option | Licence | Offline | Notes |
|---|---|---|---|
| sherpa-onnx TTS (VITS/Piper-format voices, Kokoro, Matcha) | Runtime Apache-2.0. **Each voice model has its own licence** | ✅ | One runtime for KWS, ASR and TTS. Kokoro-82M is Apache-2.0 (HF tag, VERIFIED) |
| `kokoro-js` (Apache-2.0, VERIFIED npm) | Apache-2.0 | ✅ | Pure JS/ONNX alternative |
| Piper | Original `rhasspy/piper` is **archived**. The successor `OHF-Voice/piper1-gpl` is **GPL-3.0** (VERIFIED) | ✅ | Avoid linking the GPL engine. Piper-format *voices* can run in sherpa-onnx (licences vary per voice) |
| Chromium `speechSynthesis` (Windows OneCore/SAPI voices) | OS | ✅ | Zero-dependency fallback. Robotic voice. Hard to drive lip sync from (INFERRED) |
| edge-tts (used by warashi) | Unofficial client for a Microsoft online service | ❌ | **ToS risk.** Not for a commercial product (INFERRED) |
| Cloud TTS (ElevenLabs, OpenAI, Azure) | Proprietary | ❌ | BYOK premium option |

## 5. Windows microphone permissions

- **VERIFIED:** Windows 11 has a global *Settings › Privacy & security › Microphone* toggle plus **"Let desktop apps access your microphone"**. Win32/Electron apps historically share one switch, and per-app desktop controls plus a first-use system prompt are in **Insider testing (Aug 2026)** ([Windows Latest](https://windowslatest.com/2026/08/19/windows-11-is-getting-a-major-privacy-upgrade-blocks-apps-spying-on-your-camera-and-mic-with-new-controls)).
- Electron: `session.setPermissionRequestHandler` decides Chromium-level access. Violet auto-grants it (VERIFIED). **We should grant only after an in-app consent screen**, and check `systemPreferences.getMediaAccessStatus('microphone')` (available on Windows/macOS, INFERRED from API knowledge) to deep-link the user to `ms-settings:privacy-microphone` when it is blocked.
- The taskbar mic indicator shows whenever we capture. We should also show an **in-avatar listening indicator** (ear icon or glow), and offer "mic off" in the tray.
- macOS later: needs `NSMicrophoneUsageDescription` and the TCC prompt (INFERRED).

## 6. LLM layer: API vs local vs hybrid

| | Cloud API (OpenAI, Anthropic, Google, OpenRouter) | Local Ollama | Hybrid / BYOK (recommended) |
|---|---|---|---|
| Quality for tool use / coding help | High | Lower for 3–8B models. Tool-call reliability varies (INFERRED) | Route by task |
| Latency | Network-bound, streaming | Hardware-bound | — |
| Cost | Per token (check live pricing; not quoted here) | Free after hardware | User controls it |
| Privacy | Data leaves the device | Stays local | Explicit per-feature choice |
| Install burden | API key only | Separate Ollama install (MIT) + 2–5 GB model + 8–16 GB RAM (warashi recommends `qwen2.5:3b`, about 1.9 GB, "fine on a normal 8–16 GB laptop", VERIFIED README) | Optional |
| Offline | ❌ | ✅ | Partial |

**Design:**
- One `LLMProvider` interface (`chat(messages, tools, signal) → AsyncIterable<Delta>`) with two adapters:
  1. **OpenAI-compatible** (covers OpenAI, OpenRouter, Ollama `/v1`, LM Studio, vLLM).
  2. **Anthropic Messages**.
  
  Violet shows that the OpenAI-compatible approach covers several "brains" by changing `base_url` (VERIFIED `server/api/app/llm.py`).
- The **companion protocol** is a structured output: `{ say: string, emotion: {name, intensity}, gesture?: string }` via tool or JSON-schema calls, instead of Violet's fragile inline tags (Violet's prompt has a long list of "WRONG" examples, which shows how fragile the tag approach is, VERIFIED).
- **BYOK:** keys are stored with `safeStorage` (DPAPI) in the main process. The renderer never sees them.
- **Routing:** "private mode" forces local. "Coding help" defaults to the cloud model the user chose. Chit-chat uses whatever is cheapest.
- Do **not** bundle Ollama. Detect `http://127.0.0.1:11434` and offer a guided install link.

## 7. Cursor integration (official surfaces only)

| Surface | What it gives us | Evidence |
|---|---|---|
| **MCP servers** (stdio, SSE, Streamable HTTP). Config in project `.cursor/mcp.json` or global `~/.cursor/mcp.json`. Tools need approval by default | The Cursor agent can call `companion.say`, `companion.set_state("thinking")`, `companion.notify`, `companion.ask_user` | VERIFIED, [cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp) |
| **Hooks** (`hooks.json`, version `1`): events include `stop` (`completed`/`aborted`/`error`), `afterAgentResponse`, `beforeShellExecution` / `beforeMCPExecution` (can return `ask`), `afterFileEdit`, `sessionStart/End`. Locations: `<project>/.cursor/hooks.json`, `~/.cursor/hooks.json`, `C:\ProgramData\Cursor\hooks.json`. Exit code 2 blocks the action; other failures **fail open** | The companion reacts when the agent finishes ("done!") or needs approval ("Cursor is waiting for you") | VERIFIED, [cursor.com/docs/agent/hooks](https://cursor.com/docs/agent/hooks) |
| **Cursor CLI** (`agent -p "…"` print mode; Windows install via PowerShell) | The companion can start headless agent tasks *on the user's request* | VERIFIED, [cursor.com/docs/cli/overview](https://cursor.com/docs/cli/overview). Output-format details UNKNOWN |
| **Cloud Agents API** (REST, public beta, API key from the dashboard) | Remote agent runs, status, follow-ups | VERIFIED as public beta through a docs mirror. Endpoints UNKNOWN. Out of scope for the MVP |
| **VS Code extension API** (Cursor is a VS Code fork) | Editor context (active file, diagnostics) through a small extension | INFERRED to work. Cursor-specific compatibility is UNKNOWN |
| Screen understanding (Vovy-style) | Generic, works with any app | Our own feature (M8) |

**Rules:**
- Never read Cursor's internal databases, chat state or undocumented APIs.
- Install hooks or MCP config **only with explicit user consent**, preferably **per project** (`.cursor/…`), never by silently editing global files.
- Hook scripts must always print valid JSON (`{"permission":"allow"}` for permission events) so that a companion crash never blocks Cursor.
