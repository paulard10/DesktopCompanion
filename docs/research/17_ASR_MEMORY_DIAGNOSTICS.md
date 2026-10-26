# M1.8A.4 MEMORY DIAGNOSTICS REPORT

**Date:** 2026-10-23  
**Scope:** ASR diagnostic message and mocked regression tests. No model, microphone, Qwen, desktop behavior, dependencies, Windows settings or credentials were changed.

## Changes

- [`src/main/localSpeech.ts`](../../src/main/localSpeech.ts) retains the **1,024 MiB / 1,073,741,824-byte** preflight safety threshold. It samples Windows available physical memory **once per transcription request** using the existing `os.freemem()` path. Below threshold, it returns the sampled amount (rounded down to MiB), the policy requirement, and the next action: close *unused* applications or wait and retry. It points to **Task Manager > Performance > Memory > Available**. If the OS metric is zero, nonfinite, invalid or throws, transcription fails closed with an “could not be measured” message rather than claiming that zero MiB was measured. The only injected sampler is an internal test seam; production uses `os.freemem()` and has no threshold override.
- Existing trusted speech IPC returns that error to the chat, where `src/renderer/chat.ts` already places it into `#speech-error` using `textContent`. No new IPC channel, renderer privilege or logging was added. The renderer still clears its temporary WAV byte array after the reply. The main process refuses before asset verification, temporary WAV creation and CLI launch, so a refused request creates no audio file. The existing `finally` cleanup for jobs that have started is unchanged.
- [`scripts/local-speech.test.mjs`](../../scripts/local-speech.test.mjs) now exercises above threshold, exactly threshold, below threshold, missing/invalid metrics, one sample per accepted request, no rejected-process launch, and the specific user-facing message. [`src/renderer/speechCapture.test.mts`](../../src/renderer/speechCapture.test.mts) verifies that a memory error is shown, no transcript is delivered, microphone capture stops, and the passed WAV is zeroed. Existing voice, Qwen and desktop tests remain.

## Windows measurements and metric limits

The guard uses Node/libuv's Windows `GlobalMemoryStatusEx.ullAvailPhys`, which includes immediately reusable standby, free and zero physical pages ([libuv implementation](https://github.com/libuv/libuv/blob/v1.x/src/win/util.c), [Microsoft definition](https://learn.microsoft.com/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)). It is a momentary preflight value, not a reservation or a measure of Whisper's private bytes. The previous helper pilot measured about **680 MiB sampled peak private** and **192 MiB peak working set**; those are different measures and cannot be added to or substituted for available physical memory.

A **single read-only diagnostic snapshot** of the supported Windows [`GetPerformanceInfo`](https://learn.microsoft.com/windows/win32/api/psapi/nf-psapi-getperformanceinfo) API at **2026-10-23 18:16:42 UTC** returned **773 MiB available physical**, **14,672 MiB system commit total**, **26,535 MiB commit limit**, and **11,863 MiB commit headroom**. These are not values from the user's blocked ASR attempt. Large commit headroom did not make the 773 MiB physical reading pass the policy. The snapshot used a one-time local PowerShell P/Invoke call during development; the application does **not** launch PowerShell or sample this API on the ASR path.

Microsoft's supported Windows performance counters can indicate paging, but a one-sample `Get-Counter` query for `\Memory\Pages/sec` and the commit counters failed on this machine. The counter names were not found, and enumerating counter sets returned `c0000bc8`; the cause was not established. No reliable paging rate was obtained; the application displays none. A single instantaneous page-fault counter would also be too weak to establish sustained paging. Electron's documented [`process.getSystemMemoryInfo()`](https://www.electronjs.org/docs/latest/api/process) exposes total/free/swap figures but no system commit total/limit or page-read rate. Adding a native binding or launching an extra diagnostic process on each low-memory refusal would increase complexity and memory pressure. Commit/paging snapshots are therefore **manual diagnostic evidence**, not additional safety gates or continuous telemetry.

## Safeguards retained

The threshold remains exactly **1,024 MiB**; equality is accepted. Invalid/unavailable samples reject. One short-lived CPU-only Whisper process is allowed at a time, with the same fixed Spanish arguments, timeout, cancellation and temporary-file cleanup. No audio or transcript is logged, uploaded or automatically sent to Qwen. The microphone still starts only after the user's action and permission. The chat draft remains editable; the robot overlay and click-through behavior are untouched. No application is closed automatically and no pagefile setting is changed.

## Verification

- `npm run check` ran: TypeScript typecheck **passed**, Vite production build **passed**, and **91/91 automated tests passed**. The pre-existing Vite large-chunk warning remains.
- The bundled smoke step could not complete in the restricted command environment: Electron exited before startup with Windows status `0x80000003`. A separate normal-desktop `npm run smoke` reached the existing single-instance lock and exited as a second instance because DesktopCompanion was already running. The running user app was **not** closed. Therefore a fresh-process smoke pass and the rendered memory message still require manual confirmation.
- Tests used mocked media and process calls. **No real microphone recording, Whisper inference, model download or paid API call occurred.**

## Safe user check

1. Open **Task Manager** with `Ctrl+Shift+Esc`, choose **Performance > Memory**, and read **Available**. The ASR message uses a snapshot of this type of physical-memory availability; the number may differ by the time Task Manager opens.
2. Optionally read **Committed** on that same page as used/limit. It indicates system commit pressure, not the amount of immediately available RAM. For paging, Windows **Resource Monitor > Memory > Hard Faults/sec** can be observed during normal use, but short spikes alone are not proof of a persistent problem.
3. With the app open, intentionally record a short non-sensitive Spanish phrase in Demo mode and stop. If blocked, confirm the chat shows the available MiB, **1,024 MiB required by policy**, and the retry guidance; the microphone indicator ends. Close only apps you choose to close, then retry when Task Manager shows more available memory. If it succeeds, confirm the transcript is editable and nothing is sent until Send.

## Decision

**Further optimization is justified only after paired workload measurements.** The user has demonstrated functional Tiny transcription when memory is available, and the guard now explains refusals without weakening protection. Capture the available-memory value at an actual blocked attempt, and compare normal-workload latency, page-fault activity and responsiveness. If the guard frequently blocks ordinary use despite safe measured headroom, evaluate a revised two-metric policy or quantized multilingual Tiny in an isolated pilot; do not lower the threshold or replace the model based solely on file size or this single commit snapshot.

M1.8A.4 MEMORY DIAGNOSTICS REPORT
