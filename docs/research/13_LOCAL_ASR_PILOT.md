# M1.8A.0 — isolated local ASR feasibility pilot

**Date:** 2026-10-23  
**Scope:** development-only Windows x64 CPU pilot. The Electron app, chat, Qwen, preload, overlay, character, package dependencies, global tools and settings were not changed. No microphone was opened and no audio was sent to a service.

## Decision

**GO for technical feasibility of a short-lived local whisper.cpp Tiny process; NO-GO for M1.8A application integration yet.** With the final v1.9.2 binary, this laptop transcribed a 4.517-second Spanish test clip in **1.493, 3.618 and 5.306 seconds** in three fresh processes. The variation is unexplained. The helper exited cleanly, but the single synthetic clip yielded **5 edits in 9 reference words (WER 55.6%)** on every run. That is not acceptable evidence of conversational Spanish accuracy. The synthetic source appears imperfect, and no natural speech, noisy audio or real microphone was tested. Repeat with a small consented, representative Spanish set before selecting Tiny for the product.

The earliest memory snapshot had only **785 MiB available RAM**. The helper later showed roughly **679–680 MiB sampled peak private memory**, even though peak working set was about 192 MiB. Available memory rose to **2,035 MiB** after the runs, illustrating that these are time-dependent OS snapshots. A disposable process is essential; test under normal user memory pressure before integration.

## 1. Sources, versions and environment

| Item | Verified finding |
|---|---|
| OS and CPU | Windows 11 x64, build 26200; i5-1235U, 12 logical processors; total physical memory 8,017 MiB. |
| Initial free resources | 24.97 GiB available on C:; 785 MiB physical RAM available, 90% memory load. Later snapshot: 2,035 MiB available, 74% load. Values came from Windows DriveInfo and GlobalMemoryStatusEx, not a benchmark harness. |
| Node | v24.21.0 already present; no npm install. |
| Engine | Official [whisper.cpp v1.9.2 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2), CPU-only Windows x64 archive. [v1.9.3](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.3), [v1.9.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4) and v1.9.5 release metadata exposed no downloadable binaries; v1.9.2 was the newest official tagged x64 binary verified in this pilot. CLI reported version 1.9.2. An initial exploratory run used v1.9.1 before the v1.9.2 asset was found; all decision measurements below use v1.9.2. |
| Model | [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/main) revision **5359861c739e955e79d9a303bcbc70fb988958b1**, file **ggml-tiny.bin** (multilingual). This is not tiny.en. The repository metadata gave an LFS SHA-256 before download. |
| Test audio | [nprak26/synthetic-multilingual-speech-asr](https://huggingface.co/datasets/nprak26/synthetic-multilingual-speech-asr/blob/main/README.md) revision **1452d40b8bc51508307201d43185dcf4886bef2e**, es/es_1.wav, CC BY-NC 4.0. The exact reference text came from es/manifest.jsonl at that revision. This audio is suitable for this internal research pilot; its licence does **not** permit commercial redistribution. |
| Conversion tool | Existing ffmpeg.exe 9.0.2 was used once to convert the 22,050 Hz source WAV to 16,000 Hz mono 16-bit PCM. No converter was installed or bundled. The dataset card's generic 16 kHz description did not match this particular file's actual 22,050 Hz WAV header. |
| Local build tools | CMake and MSVC cl.exe were not found. No compiler/SDK was installed. Had the trusted official binary been unavailable, a local build would require CMake and a supported Windows C/C++ toolchain (for example Visual Studio Build Tools/MSVC), followed by verification of build inputs, output binaries and runtime DLLs. |

## 2. Exact downloaded assets and integrity

All files were placed temporarily under the ignored local directory **.local-asr/**. Hashes were checked before any binary execution or audio processing. The original ZIP and original 22,050 Hz WAV were removed after extraction/conversion and validation. No Base, Small or larger model was downloaded.

| Downloaded asset | Source | Download bytes | Verified SHA-256 | Retained? |
|---|---|---:|---|---|
| whisper-bin-x64.zip, exploratory | [Official v1.9.1 GitHub release asset](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.1); digest published by GitHub release API | 7,982,101 | 7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539 | No; superseded and deleted |
| whisper-bin-x64.zip, final | [Official v1.9.2 GitHub release asset](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2); digest published by GitHub release API | 8,194,445 | 49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a | No; six required files extracted, ZIP deleted |
| ggml-tiny.bin | [Official maintainer's model repository](https://huggingface.co/ggerganov/whisper.cpp/tree/main), pinned revision above | 77,691,713 | be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21 | Yes |
| es/es_1.wav | [Licensed sample repository](https://huggingface.co/datasets/nprak26/synthetic-multilingual-speech-asr/blob/main/README.md), pinned revision above | 199,244 | 4f0c33f3f296a22ac39e2cbc2c3e6d0e42e834c7376d0e660b9b0e779732c082 | No; converted WAV retained |

The converted local es_1_16k.wav is **144,624 bytes**, SHA-256 **d777a456362fe5e430d690fd33b7c6cca8344a4520e5ae0ffbe3df21cbd37af9**. It inherits the source audio's CC BY-NC 4.0 terms; it is not a redistributable app asset.

The archive contained many examples and CPU variants. Only **whisper-cli.exe, whisper.dll, ggml.dll, ggml-base.dll, ggml-cpu-alderlake.dll and ggml-cpu-x64.dll** were extracted. Their exact local hashes are pinned in the pilot harness and rechecked before each execution. The CLI successfully loaded the Alder Lake CPU backend on this machine. It ran with **-ng** (no GPU), Spanish **-l es**, two CPU threads, and no server.

**Retained footprint:** 8 files, **82,021,937 bytes / 78.22 MiB** including the multilingual model, six v1.9.2 binaries/DLLs and converted public sample. Both downloaded archives and the original sample were removed. Disposable per-run WAV copies are deleted after each run.

## 3. Harness and process boundaries

Development-only files: [scripts/asr-pilot.mjs](../../scripts/asr-pilot.mjs), [scripts/asr-pilot-monitor.ps1](../../scripts/asr-pilot-monitor.ps1), [.gitignore](../../.gitignore). No Electron process imports them.

The Node harness uses fixed paths under .local-asr, verifies executable, DLL, model and public-sample SHA-256 values, accepts only bounded enumerated options, checks for at most 20 seconds of mono 16 kHz 16-bit PCM WAV, and spawns the CLI with an argument array, **shell:false**, **windowsHide:true**. It neither runs a server nor accepts caller-supplied executable paths or arbitrary CLI flags. Defaults: **2 threads**, **30-second timeout**. Thread count is limited to 1–4. Ctrl+C or an explicit cancel timer terminates the child. Nonzero exits are errors.

The optional PowerShell monitor samples the child's working set, private bytes and CPU time every ~100 ms. Its execution-policy override applies to that one child invocation; it does not change a system setting. The monitor is a measurement aid, **not** an application dependency. Its measurements can miss brief peaks; CPU percentage uses 12 logical processors as denominator and excludes monitor overhead. The harness copies audio to a random disposable WAV and removes it in a finally path. In explicit consented-sample mode it also removes the provided consented.wav after success, cancel or error.

Run the public pilot again from the repository root:

    node scripts/asr-pilot.mjs --threads=2 --timeout-ms=30000

Test process cancellation without recording:

    node scripts/asr-pilot.mjs --cancel-after-ms=100

The measured total below is **CLI process spawn-to-exit wall time**, excluding pre-run SHA verification, WAV validation, monitor shutdown, source audio capture and UI work. The engine's load-time line is a separate internal measurement. SHA verification itself reads the 77.7 MB model and warms the OS file cache; **true cold disk-cache latency was not measured**.

## 4. Spanish audio and accuracy

The source is a short synthetic voice, not a human microphone recording. Its reference is:

> El zorro marrón rápido salta sobre el perro perezoso.

Every successful run returned:

> El zorro marró en rapidos altas sobre el perro perizoso.

Accent-preserving, case-insensitive, punctuation-insensitive word alignment yielded **5 word edits / 9 reference words = 55.6% WER**. The dataset's own manifest also records an imperfect prior ASR hypothesis for this sample. This result cannot distinguish a Tiny-model limitation from unclear synthetic speech, and a nine-word sample cannot estimate real-world Spanish WER. Missing/altered content includes **marrón**, **rápido salta**, and **perezoso**. No user audio was inspected or recorded.

## 5. Latency, CPU and memory measurements

Identical converted 4.517-second sample, **v1.9.2** binary, same model, 2 CPU threads, local offline CLI. Each row is a fresh child process with the working memory monitor. OS file cache was warm because the model was hashed before spawning. The system was not otherwise held to a fixed load, and the cause of the increasing wall times was not measured.

| Run | CLI total (ms) | Engine-reported load (ms) | Peak working set (MiB) | Sampled peak private (MiB) | Sampled CPU time (ms) | Approx. total-machine CPU | Transcript |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1,493 | 140.18 | 191.9 | 679.5 | 2,578 | 14.4% | Same 5-edit result |
| 2 | 3,618 | 167.58 | 192.1 | 680.1 | 6,672 | 15.4% | Same |
| 3 | 5,306 | 583.50 | 192.2 | 679.8 | 9,406 | 14.8% | Same |

Among v1.9.2 runs, process wall time was **1.493–5.306 s** and the approximate memory maxima were **192.2 MiB working set** and **680.1 MiB sampled private memory**. The difference between working set and private bytes matters on this memory-constrained machine: the latter is a Windows process commit-style measure and can exceed resident pages. It is not safe to equate 192 MiB working set with full memory cost. The rising wall time and CPU time may reflect system contention, frequency changes or paging, but their cause is **unconfirmed**. CPU percentages are coarse observations over a short process and do not include the separate monitor. No battery, noise, 10–20-second utterance, low-memory stress or true cold-cache result was obtained. The earlier exploratory v1.9.1 runs were ~1.41–1.51 s with the same transcription; they are not pooled with the final version's measurements.

## 6. Cleanup verification

Success, deliberate cancellation at 100 ms and deliberate timeout at 1,000 ms were tested. Cancel and timeout returned nonzero status, terminated whisper-cli and left **zero** disposable pilot WAVs and **zero** whisper-cli processes in a post-run check. A simulated consented sample made by copying the public WAV was also cancelled; consented.wav was removed. No user recording occurred. Process memory was released when the helper exited; a later OS snapshot showed 2,035 MiB available RAM, but background OS/app activity prevents attributing that increase solely to this pilot.

**Limit:** a forced kill of the Node harness itself (for example a power loss) could leave its disposable WAV. A future production controller should remove orphaned pilot-style temp audio on startup and use a private OS temporary directory. No crash-recovery test was performed here.

## 7. Windows packaging, security and licensing

The official x64 archive and its published GitHub SHA-256 were checked before extraction. The CLI and its five companion DLLs ran locally without installing a VC runtime. This Windows installation already has vcruntime140.dll, vcruntime140_1.dll and msvcp140.dll in System32. That does **not** establish that a clean customer Windows image has every required runtime; inspect PE imports and test a clean, non-admin x64 environment before packaging. Keep native EXE/DLLs outside Electron ASAR, ship only the chosen CPU backend/fallback, pin hashes and licensing notices, and test antivirus handling. Do not put the model in an unrestricted renderer-writable location. No Electron integration or packaged build was attempted.

[whisper.cpp v1.9.2](https://github.com/ggml-org/whisper.cpp/blob/v1.9.2/LICENSE) uses MIT. [OpenAI Whisper](https://github.com/openai/whisper/blob/main/LICENSE) states its code and original weights are MIT; the converted model repository declares MIT. Preserve notices and verify weight provenance for commercial release. The particular test WAV dataset is **CC BY-NC 4.0**, with attribution and noncommercial restrictions; it must never be bundled as a commercial demo sample. The ffmpeg conversion was a one-time local operation using an already installed tool. The pilot made no network inference call and had no microphone path. No offline airplane-mode or packet-trace verification was performed.

## 8. Proposed M1.8A gates and next smallest alternative

These are **proposed criteria, not established facts**:

1. On at least 30 short, consented, representative Spanish clips across speakers and ordinary room noise, target **WER ≤15%** after a fixed normalization policy, with no critical command omissions. Report median and worst-case examples, not one average alone.
2. For 5-second utterances on this laptop under normal app load, target **p95 Stop-to-draft ≤3 seconds**; for 10-second utterances, **p95 ≤10 seconds**. Measure capture stop, any conversion, process cold load and transcript delivery end to end. Two of the three final helper-only runs exceeded the proposed 3-second 5-second-audio target, so current evidence does not meet it.
3. Require clean helper exit after each utterance; no residual microphone, temp WAV or child process. Measure peak working set, **private bytes/commit**, page faults and available system RAM while Electron and normal user applications run. Decline or delay inference gracefully when headroom is inadequate. A proposed provisional guard is **≥1 GiB available RAM before launch**, subject to validation.
4. Verify no network transmission in a separate offline/network-observed test, and test a clean Windows x64 package with the correct runtime DLLs and model licences.

Because this sample's accuracy fails, the next smallest Whisper accuracy candidate is **multilingual Base** with the same CLI/provider boundary. It is approximately 142 MiB on disk and is likely to increase RAM and latency; it was **not downloaded or tested**. Vosk small Spanish is a smaller disk-footprint alternative but has separate native packaging and roughly 300 MB generic runtime memory, with unknown comparative accuracy. Benchmark only after obtaining better Tiny evidence and a memory budget.

## 9. Optional, explicitly consented microphone follow-up

No microphone command is run by this pilot. If the user chooses a separate future test, they can manually open Windows Sound Recorder, explicitly press Record, speak for at most 20 seconds, stop, and save the audio **locally** in the ignored .local-asr directory. With the already installed ffmpeg, a separately initiated conversion to 16 kHz mono PCM can be made with:

    ffmpeg.exe -nostdin -i .local-asr\user-original.m4a -ac 1 -ar 16000 -c:a pcm_s16le .local-asr\consented.wav

After inspecting the conversion result, delete the original recording locally; then explicitly run:

    Remove-Item -LiteralPath .local-asr\user-original.m4a -Force

    node scripts/asr-pilot.mjs --sample=consented

That mode deletes consented.wav and its disposable copy on completion or cancellation. It does not send automatically to Qwen or any other service. The user should **not** record private third parties or place the audio in a tracked directory. Do not use this optional procedure as a substitute for a separate, properly consented multi-speaker evaluation.

## 10. Removal

From the repository root, verify the exact target before a recursive removal:

    $workspace = (Resolve-Path .).Path
    $target = (Resolve-Path .local-asr).Path
    if ($target -ne (Join-Path $workspace '.local-asr')) { throw 'Unexpected pilot path' }
    Remove-Item -LiteralPath $target -Recurse -Force

This deletes the binary, DLLs, Tiny model, public WAV and any optional local audio. The two development scripts and this report are ordinary small text files; removing them and the .gitignore entry would remove the pilot entirely. No global software or settings were installed.
