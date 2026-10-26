# 07 — Open Questions and Risks

## 1. Questions that need user input

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| Q1 | Will the app be sold or monetised? Which country or legal entity publishes it? | Code signing eligibility (Azure Artifact Signing: individuals US/CA only), Hunyuan3D (not licensed in EU/UK/KR), Picovoice terms, Live2D thresholds | Assume commercial, EU-based → avoid all three |
| Q2 | Do you own the rights to the illustration that the character is based on? Exclusive use? | Character licensing and commissioning contracts | Assume you own it |
| Q3 | Character path: VRoid yourself (Path 1) or commission an artist (Path 2)? Style: anime humanoid, chibi or mascot/animal? | VRoid suits anime humanoids. Mascots need Blender or an artist | Path 1 |
| Q4 | Placeholder VRM for M1: create it in VRoid Studio (recommended), or use a permissively licensed sample? | Avoids third-party terms in the repo | You create it |
| Q5 | Approval to install Node.js LTS (user scope) and project-local npm packages | Required to start M1. Your restrictions require approval | Wait |
| Q6 | Minimum hardware target (iGPU laptops? 8 GB RAM?) | Sets frame rate, model triangle budget and the local-LLM recommendation | 8 GB RAM, Intel/AMD iGPU from 2020+ |
| Q7 | Default LLM provider and whether a free/no-key experience is needed out of the box | Without a key, "chat" needs Ollama or a hosted proxy (which has cost and privacy implications) | BYOK + optional Ollama |
| Q8 | Wake phrase language(s) and the companion's name | sherpa-onnx KWS has English and Chinese models. **Spanish KWS model availability is UNKNOWN** | English first |
| Q9 | What exactly did the Instagram reel show that you want (pointing at UI, a cursor-follower, voice)? | We couldn't view it (login wall) | Follow Vovy's site claims |
| Q10 | Should the companion hide automatically over full-screen apps and games? | UX and performance | Yes, auto-hide over full-screen |
| Q11 | Telemetry or crash reporting? | Privacy posture | None |

## 2. Technical risks

| Risk | Likelihood | Impact | Evidence | Mitigation |
|---|---|---|---|---|
| Click-through flicker or unreliability on Windows (layered window + GPU) | Medium | High | Electron's `setShape` commit notes `WS_EX_LAYERED` quirks. The `forward` option fails while elevated windows are focused (VERIFIED docs) | Main-process cursor polling. Hysteresis. Test `setShape` as an alternative. AC3/AC8 in M1 |
| Mixed-DPI multi-monitor coordinate errors | Medium | Medium | electron#42383 (HiDPI switch) | Keep the window on one display. Recompute on `display-metrics-changed`. AC7 |
| Electron resource baseline above budget | Low–Medium | Medium | Mixed benchmark quality (INFERRED) | Frame governor, DPR cap, `powerPreference:'low-power'`, pause when hidden. Measure in AC9. Tauri fallback |
| Transparent window over exclusive-fullscreen games / UAC | High (by design) | Low | OS behaviour (INFERRED) | Detect full-screen. Hide |
| Wake-word false accepts | Medium | High (privacy, annoyance) | No published FAR for sherpa KWS (UNKNOWN) | VAD gate, ASR verification, sensitivity presets, push-to-talk fallback, measurement protocol in `04 §2` |
| No good KWS model for non-English phrases | Medium | Medium | Only en/zh KWS models listed (VERIFIED docs) | English phrase. ASR-based phrase spotting fallback. Porcupine (paid) |
| Image-to-3D quality is too low for the user's character | High | Medium | Single fused meshes with no facial topology (INFERRED) | Use VRoid or an artist (Paths 1–2) |
| Asset licence violation | Medium | High | References bundle pixiv VRMA and Mixamo FBX (VERIFIED) | Asset manifest, own or commissioned assets only, CI check |
| LLM tool-call misuse / prompt injection from screen content | Medium | High | AILIS self-approval flaw (VERIFIED) | Approval from UI only, tiered permissions, no generic exec |
| Cursor surface changes (hooks schema, CLI flags, beta API) | Medium | Medium | Cloud Agents API is "public beta"; hooks `version:1` (VERIFIED) | A thin adapter layer. Hooks fail open. Pin docs versions in tests |
| SmartScreen warnings hurting adoption | High until signed | Medium | Every reference is unsigned | Sign from M3. EU route needs an organisation or an OV certificate |
| Electron security patch cadence | Certain | Medium | 8-week majors | Monthly dependency update routine |
| Upstream library churn (three.js monthly releases, three-vrm breaking changes) | Medium | Low | three 0.18x cadence (VERIFIED npm) | Pin exact versions. Upgrade deliberately |

## 3. Things we explicitly did NOT verify (UNKNOWN)

- Running any reference app on this machine. That needs installs or binaries, which the brief prohibits.
- Real CPU/GPU/RAM numbers for Electron vs Tauri on this workload.
- Whether the AVATAR, AILIS or Violet installers actually work on current Windows 11 builds (no Windows CI; unsigned).
- sherpa-onnx KWS accuracy and false-accept rate in real rooms.
- The current exact VRoid Studio base terms, Mixamo terms and Picovoice free-tier commercial terms (sources conflict or are secondary).
- UniRig model-weight licence. Charakuru licence specifics.
- Cursor CLI JSON output formats and Cloud Agents API endpoints (only a mirror of the docs was seen).
- The content of the Instagram reel.
- AIRI (`moeru-ai/airi`): only its desktop stack was confirmed (Electron + three). The overlay implementation was not reviewed.

## 4. Decision log (proposed)

| Decision | Status | Revisit when |
|---|---|---|
| Electron + TS + Three.js + three-vrm | Proposed | M1 AC7–AC9 fail |
| VRM 1.0 as the character format | Proposed | The character is non-humanoid |
| Procedural sleep/wake/idle, no third-party clips | Proposed | M7 |
| sherpa-onnx for local speech | Proposed (M4 spike) | KWS accuracy below target |
| BYOK hybrid LLM, no bundled Ollama | Proposed | Q7 answer |
| MCP + hooks as the only Cursor integration | Proposed | Cursor publishes new official surfaces |
| No Python or Docker in the consumer app | Firm | — |
