# M1.8A.1 — natural Spanish ASR validation

**Status, 2026-10-23:** Test harness and protocol ready. **No natural microphone recordings have been made or supplied; natural-speech measurements are pending. NO-GO for M1.8A integration remains in effect.** This document does not infer natural accuracy from the synthetic clip.

**Later user report for M1.8A.2:** Six natural Spanish runs were completed after this snapshot. The user reports 0 errors in the short clip, 0 in the technical clip, 1 in the long clip (approximately 2.56% aggregate WER), 1.4–1.6 second transcriptions, approximately 680 MiB peak private memory, and successful cancellation/cleanup. The exact six run records were not supplied for independent audit; subjective responsiveness is still pending. The earlier NO-GO statement and pending results ledger below describe the state **before** this later report. See [the push-to-talk implementation report](15_PUSH_TO_TALK_INTEGRATION.md).

## 1. Scope and investigation

Read alongside [local voice architecture](12_LOCAL_VOICE_ARCHITECTURE.md) and the [isolated Tiny pilot](13_LOCAL_ASR_PILOT.md). This is an isolated test of the existing multilingual Whisper Tiny model with whisper.cpp v1.9.2 on this Windows 11, i5-1235U, 8 GB laptop. Nothing in Electron, chat, Qwen, preload, overlay, character or credentials was modified. No model was downloaded in this phase.

The previous synthetic recording was a 22,050 Hz mono 16-bit WAV converted by existing ffmpeg to 16,000 Hz mono PCM. The actual WAV header, not the dataset's generic description, established its source rate. The current harness validates RIFF/WAVE, PCM codec, one channel, 16,000 Hz, 16 bits, at most 20 seconds and at most 2 MB before execution. It passes the fixed flags **-l es**, **-ng** and **-t 2** to the verified CPU-only CLI, with no translation flag. Natural recordings must be converted to the same format. Windows Sound Recorder may save compressed audio and may apply device/OS processing; that is part of the natural-mic test context and should be noted.

The earlier v1.9.2 process times were **1.493, 3.618 and 5.306 seconds** for the same 4.517-second synthetic clip. Model load reported **140.18, 167.58 and 583.50 ms**. Process CPU time also rose, while peak working set stayed ~192 MiB and sampled peak private memory ~680 MiB. This pattern is compatible with competing CPU load, frequency/thermal changes or paging, but none was measured well enough to assign a cause. The harness hashes the 77.7 MB model before each launch, warming the OS file cache; these are fresh **process** starts, not cold disk-cache starts. Do not label load time as whole-process startup or these repeats as a cold-cache benchmark.

The prior WER calculation was case-insensitive, punctuation-insensitive and **accent-preserving**, with a Levenshtein edit distance over words. The updated harness retains that rule, normalizes Unicode to NFC, discards empty tokens and keeps digits literal. For example, “como” and “cómo” count as different words; “14” and “catorce” would also differ. The three test sentences below avoid numbers. If a speaker changes a word or skips a phrase, correct the reference to the **words actually spoken** before running; do not edit the reference to match Whisper's answer.

## 2. Predeclared GO / NO-GO criteria

These are **proposed engineering thresholds**, fixed before inspecting any natural recording. Six runs are a **screening test**, not a statistically reliable Spanish WER benchmark or p95 latency estimate.

**Provisional GO for an M1.8A push-to-talk prototype only if all apply:**

1. In both user-controlled profiles, the aggregate edit distance divided by aggregate reference-word count across the three sentences is **≤15% WER**; no sentence loses a critical name, negation or technical noun. Record each transcript and exact reference. A wider, consented multi-speaker test remains required before a quality claim.
2. Each short clip completes in **≤3 s**, technical clip in **≤5 s**, and long clip in **≤10 s** from CLI spawn to exit in both profiles. These are screening limits, not measured p95. A production Stop-to-draft metric will include conversion and UI work.
3. Under the realistic workload, sampled helper peak working set is **≤350 MiB**, sampled private memory **≤800 MiB**, and available system RAM after each run is **≥500 MiB**. These guard values need refinement using page faults and actual user workload; a working-set-only pass is insufficient.
4. DesktopCompanion and Cursor remain usable during each run by user observation: no sustained freeze, audio glitch or serious cursor/overlay lag. No helper process or accidental disposable file remains after exit; the user-owned source recordings remain intact.

**NO-GO** if any gate fails or measurements cannot be completed. If accuracy/latency fails while memory headroom is adequate, recommend a **separate controlled multilingual Base pilot** on the same exact recordings; do not download it now. If private memory, available RAM or responsiveness fails with Tiny, Base is a poor next memory bet. Instead inspect a small Spanish-capable sherpa-onnx ASR candidate and its **actual** Windows runtime memory/licence before selecting or downloading one. The documented sherpa Whisper Tiny INT8 files are ~99 MB combined on disk, but lower live RAM and better accuracy have **not** been established.

## 3. Exact voluntary recording instructions

No script opens the microphone. The user chooses whether and when to run this stage.

1. In a quiet room, ensure no other person is being recorded without consent. Open **Windows Sound Recorder manually** from the Start menu. Choose the desired microphone. Record **one sentence per file**, naturally, with a brief pause at the start and end. Keep each clip under **20 seconds**. Press Stop and save locally. Do not run the harness while recording.
2. Use these distinct prompts as written, or speak natural equivalents and edit the reference to the exact words actually spoken:

   | Fixed clip name | Type | Suggested text |
   |---|---|---|
   | short | Everyday | **Hola, ¿cómo estás? Hoy hace buen tiempo.** |
   | technical | Technical | **Necesito revisar la conexión de red y el uso de memoria del ordenador.** |
   | long | Longer natural sentence | **Esta mañana abrí el calendario para organizar mis tareas, pero antes de empezar tuve que responder un mensaje importante.** |

3. Save the original recordings in the ignored local folder **.local-asr/natural/** as short.m4a, technical.m4a and long.m4a. If Sound Recorder uses a different extension, adjust only the input filename in the conversion command. The app does not access this folder.
4. If the user explicitly chooses to process these recordings, run these three separate local commands from the repository root using the **already installed** ffmpeg. The **-n** flag refuses to overwrite an existing converted WAV:

       ffmpeg.exe -nostdin -hide_banner -loglevel error -i .local-asr\natural\short.m4a -ac 1 -ar 16000 -c:a pcm_s16le -n .local-asr\natural\short.wav
       ffmpeg.exe -nostdin -hide_banner -loglevel error -i .local-asr\natural\technical.m4a -ac 1 -ar 16000 -c:a pcm_s16le -n .local-asr\natural\technical.wav
       ffmpeg.exe -nostdin -hide_banner -loglevel error -i .local-asr\natural\long.m4a -ac 1 -ar 16000 -c:a pcm_s16le -n .local-asr\natural\long.wav

5. Edit the local, ignored [.local-asr/natural/references.json](../../.local-asr/natural/references.json) to give the **exact spoken transcription** for short, technical and long. The prepared file contains the suggested prompts; it is not a claim about what was recorded. Do not include information you would not want displayed in a local terminal.
6. Keep both original and converted recordings. **The natural test harness does not delete, rename or upload any user recording.** It also does not create a second audio copy for natural mode. Delete audio only when the user separately decides to do so; the removal commands in the earlier pilot report are optional and should not be run as part of these tests.

The fixed input names and reference file are the only natural data the harness reads. It does not scan personal audio folders. It will reject missing WAVs, unsupported formats and overlong recordings. It never sends text to Qwen.

## 4. Two user-controlled workload profiles

Run at most **one transcription per sentence per profile** initially: six natural tests total. Do not run a stress suite. If one run is interrupted, note it and repeat only that run once.

**Baseline:** The user chooses a normal quiet period with unnecessary heavy tasks already finished. Do not automatically close or modify applications. If convenient, note Task Manager's available memory and CPU before testing. With the terminal in the repository root, execute:

    node scripts/asr-pilot.mjs --sample=natural-short --profile=baseline --threads=2
    node scripts/asr-pilot.mjs --sample=natural-technical --profile=baseline --threads=2
    node scripts/asr-pilot.mjs --sample=natural-long --profile=baseline --threads=2

**Realistic workload:** The user voluntarily opens Cursor and DesktopCompanion as they normally use them, with their usual project/chat state. Do not close or foreground other windows automatically. Execute:

    node scripts/asr-pilot.mjs --sample=natural-short --profile=workload --threads=2
    node scripts/asr-pilot.mjs --sample=natural-technical --profile=workload --threads=2
    node scripts/asr-pilot.mjs --sample=natural-long --profile=workload --threads=2

During each run the user should note whether typing, app controls, animation/cursor response and switching windows remain smooth. The harness reports pre/post available RAM, whole-machine CPU busy percentage over the CLI interval, helper CPU time, sampled private memory, peak working set, process time, transcript, exact reference and WER. The PowerShell observer is a transient pilot measurement process; its 100 ms sampling can miss a brief private-memory peak. The **monitorSettleMs** field is the delay from CLI exit until its observer returns, and is **not** Whisper inference time. The CLI close event establishes process exit. In natural mode no disposable user-audio copy is created; **tempCleanupMs** is therefore null.

The user can share **only the six JSON text results and their responsiveness notes** to continue analysis; do not attach or upload raw audio. Those text results will contain transcripts and exact references, so review them for private content before sharing.

## 5. Results ledger

**Natural test: not run.** The user has not chosen to record or provided audio. No natural clip duration, transcript, WER, latency, CPU, memory under either profile or responsiveness observation can be reported yet.

| Profile | Clip | Duration | Transcript / reference | Edits / WER | CLI wall | Peak private / working set | Available RAM pre/post | CPU | Responsiveness |
|---|---|---|---|---|---|---|---|---|---|
| Baseline | short | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Baseline | technical | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Baseline | long | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Workload | short | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Workload | technical | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| Workload | long | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

**Synthetic control after the harness change, not natural evidence:** the existing 4.517-second public clip completed in **1,495 ms** with 2 threads; engine-reported load **179.88 ms**, peak working set **192.1 MiB**, sampled private memory **679.9 MiB**, approximate helper CPU **13.5% of 12 logical processors**, whole-machine CPU busy **33.9%**, available RAM **1,067 → 1,082 MiB**. It still produced **5/9 word edits**. The monitor settled in **169 ms** after CLI exit and its disposable public WAV was removed in **1 ms**. No natural inference follows from this control.

## 6. Current recommendation and safety

**Current decision: NO-GO for M1.8A integration; natural-speech viability is undetermined.** The isolated v1.9.2 Tiny harness is ready for voluntary testing. Accuracy on one synthetic voice and rising prior timings cannot justify microphone UI or automatic chat input. Do not download multilingual Base until the six natural results show an accuracy/latency failure with acceptable RAM. If Tiny itself causes memory pressure, first assess a genuinely Spanish sherpa-onnx model with measured live memory; its file size alone is insufficient evidence.

No recording is started by the harness or by reading this document. The microphone remains off by default. Recordings and references stay local in an ignored directory, no user audio is automatically deleted, and transcripts are printed only to the local terminal. No Qwen request, API credential access, paid call, Electron change or Git push is involved.

**Validation of the harness without microphone audio:** Node syntax check passed; 3 focused tests passed for Spanish normalization, bounded natural-mode options and WAV format rejection. A natural-mode invocation with no recording failed as expected with a missing fixed WAV path. The synthetic control completed and exited cleanly. These checks prove harness behavior, **not** natural Spanish accuracy or app responsiveness.
