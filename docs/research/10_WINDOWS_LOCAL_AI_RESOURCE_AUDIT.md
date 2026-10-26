# 10 — Windows local AI resource audit

**Date:** 2026-10-23  
**Status:** read-only. Nothing was installed, downloaded, deleted, closed, or changed.

This note checks whether Ollama with `qwen3:0.6b` or `qwen3:1.7b` can run on this Surface Laptop Go 3 while the desktop is already in use. [09 — AI integration preflight](09_AI_INTEGRATION_PREFLIGHT.md) recommended `qwen3:1.7b` before this live memory reading. The measurements below change that first download to `qwen3:0.6b`.

Decimal GiB figures are Windows units (1024-based). Process and folder sizes that came from byte counts are in MiB. Ollama's own "523MB" and "1.4GB" labels are quoted as published.

No file contents were opened. Startup shortcuts, credential files, and personal documents were not read.

## 1. Current RAM situation

Read at the end of this audit, after the folder measurements. An earlier pass in the same session saw 831 MB available and 0.78 GiB free physical memory. The later reading is tighter. Treat both as one busy moment, not as a permanent capacity.

| Reading | Value |
| --- | --- |
| Visible physical RAM | 7.83 GiB |
| Free physical RAM | 0.59 GiB |
| Available RAM (`Available MBytes`) | 620 MB |
| System cache (`CacheBytes`) | 0.09 GiB |
| Nonpaged pool | 791 MiB |
| Commit charge | 20.92 GiB |
| Commit limit | 25.92 GiB |
| Commit headroom | 5.0 GiB |
| Page file | `C:\pagefile.sys`, system-managed. No explicit `Win32_PageFileSetting`. |
| Page file allocated | 18,528 MB |
| Page file in use | 2,922 MB |
| Page file peak during this boot | 5,825 MB |

Three different memory numbers are in play:

- **Working set** is physical RAM a process has used recently. Shared pages can appear in more than one process. Closing a process does not hand back that whole number. Windows may keep the pages in the standby list, and Memory Compression may already be holding a compressed copy.
- **Private bytes** are memory committed for that process alone. A large part of it can live in the page file. Private bytes are not a prediction of RAM that will become free.
- **Commit charge** is the system-wide total of memory Windows has promised, backed by RAM plus the page file. At 20.92 GiB it is already far above the 7.83 GiB of physical RAM. The remaining promise Windows can still make is about 5.0 GiB. A model can fit inside that promise by paging, and the machine can still become unresponsive.

Memory Compression is the largest working set, about 1,445 MiB, with only about 10 MiB private. That is Windows storing other processes' pages in compressed form. It is not an application to close.

The page file stays as Windows configured it. Shrinking it, deleting it, or raising it to "make room" for a model is out of scope.

## 2. Top memory-consuming applications

Final snapshot, ordered by working set. Private MiB is shown so it is not mistaken for RAM.

| Name | Count | Working set | Private |
| --- | ---: | ---: | ---: |
| Memory Compression | 1 | 1,444 MiB | 10 MiB |
| Cursor | 19 | 1,076 MiB | 2,706 MiB |
| svchost | 94 | 459 MiB | 900 MiB |
| chrome | 11 | 417 MiB | 1,793 MiB |
| ChatGPT | 16 | 237 MiB | 2,670 MiB |
| msedgewebview2 | 21 | 204 MiB | 1,064 MiB |
| claude | 10 | 197 MiB | 1,394 MiB |
| MsMpEng (Defender) | 1 | 189 MiB | 524 MiB |
| powershell | 3 | 107 MiB | 207 MiB |
| electron | 5 | 81 MiB | 236 MiB |
| explorer | 1 | 56 MiB | 150 MiB |
| mc-fw-host | 2 | 52 MiB | 333 MiB |
| Zoom | 2 | 40 MiB | 417 MiB |
| RuntimeBroker | 7 | 38 MiB | 38 MiB |
| ms-teams | 2 | 34 MiB | 75 MiB |
| codex | 2 | 34 MiB | 298 MiB |
| msedge | 5 | 32 MiB | 145 MiB |
| node | 18 | 32 MiB | 1,805 MiB |
| dwm | 1 | 25 MiB | 226 MiB |
| convex-local-backend | 1 | 18 MiB | 81 MiB |

Largest individual working sets in that same snapshot: one Cursor process at 398 MiB, another Cursor process at 240 MiB, Defender at 188 MiB, one Chrome process at 135 MiB.

What those names are, from executable paths only. Command lines were not read.

| Process | Identity |
| --- | --- |
| Cursor | The IDE in this session. 19 processes. |
| chrome | Google Chrome. 11 processes. |
| ChatGPT | OpenAI Codex desktop app, `ChatGPT.exe` under the WindowsApps Codex package. 16 processes. |
| claude | Claude Windows app, plus the Claude Code `claude.exe` under the user npm prefix. 10 processes combined. |
| codex | Codex CLI under `%LOCALAPPDATA%\OpenAI\Codex\bin`. 2 processes. |
| electron | All 5 are DesktopCompanion's dev Electron, under this repo's `node_modules\electron\dist`. |
| node | 18 processes, only 32 MiB of working set and 1,805 MiB private. Split: 9 from `C:\node.exe`, 6 from the Codex computer-use runtime, 3 from the Cursor install's helper. Closing "all node" would hit Cursor and Codex together. |
| msedgewebview2 | Shared host used by other apps, including Teams. Closing it by name is the wrong action. |
| MsMpEng | Windows Defender. Leave it running. |
| svchost | Windows services. Leave them running. |

A few minutes earlier, smaller background processes that matter for startup were: OneDrive about 10 MiB working set plus OneDrive Sync about 13 MiB, Postman Agent about 15 MiB working set (235 MiB private). Those private figures still do not come back as a matching amount of RAM.

Upper hint if the user later closes Chrome, the Codex desktop app, and Claude: about 417 + 237 + 197 = 851 MiB of working set. That is a ceiling, not a refund. Cursor is another 1,076 MiB of working set, and closing it ends this IDE session. Together those four are still a temporary dip in pressure. They do not turn this 8 GB laptop into a machine with several free gigabytes.

## 3. Disk-space overview

| Drive | Type | File system | Size | Free |
| --- | --- | --- | --- | ---: |
| C: | Local fixed disk | NTFS | 237.1 GiB | 17.4 GiB |

No other local fixed disk was present. Folder sizes below are from a list-only directory walk (`robocopy /L`). Nothing was copied or deleted. `C:\Windows\Temp` could not be measured.

### Caches and temporary folders

| Location | Size | Role |
| --- | ---: | --- |
| `%LOCALAPPDATA%\npm-cache` | 8,070 MiB | npm cache. `npm config get cache` points here. |
| `%USERPROFILE%\.cache\codex-runtimes` | 1,387 MiB | Codex runtime files. Hugging Face cache next to it is 0.5 MiB. |
| `%LOCALAPPDATA%\Temp` | 1,897 MiB | Current user temp. `TEMP` is this folder. |
| `%LOCALAPPDATA%\uv\cache` | 1,065 MiB | uv package cache. |
| `%LOCALAPPDATA%\pip\Cache` | 431 MiB | pip cache. |
| Chrome Default `Cache` + `Code Cache` | 232 + 381 MiB | Browser cache for the Default profile only. |
| Edge Default `Cache` | 185 MiB | Edge cache for the Default profile only. |
| `%LOCALAPPDATA%\CrashDumps` | 81 MiB | Crash dumps. |
| `%LOCALAPPDATA%\Microsoft\Windows\INetCache` | 52 MiB | Legacy Internet cache. |
| Cursor `Cache`, `GPUCache`, `CachedData`, `CachedExtensionVSIXs` | 8 + 6 + 282 + 134 MiB | Small caches inside a much larger profile. |
| `C:\Windows\SoftwareDistribution\Download` | 5 MiB | Windows Update download folder. |
| DesktopCompanion `node_modules` | 479 MiB | Active project dependencies. |
| DesktopCompanion `dist` | 3 MiB | Built app output. |

pnpm and Yarn cache directories were absent. `%USERPROFILE%\.npm` was absent.

### Largest application-data directories

These are totals. They are not cleanup targets unless a row above already isolated a cache.

| Directory | Size | What to do with it |
| --- | ---: | --- |
| `%APPDATA%\Cursor` | 10,923 MiB | Leave it. `User` is 7,486 MiB and `snapshots` is 2,929 MiB. |
| `%LOCALAPPDATA%\Claude-Data` | 9,097 MiB | Leave it. One Claude data directory. |
| `%LOCALAPPDATA%\npm-cache` | 8,070 MiB | Official cache clean, after approval. |
| `%LOCALAPPDATA%\Google` | 5,377 MiB | Leave the profile. Only the Default cache rows above are cache. |
| `%LOCALAPPDATA%\Microsoft` | 5,026 MiB | Leave it. |
| `%LOCALAPPDATA%\wsl` | 4,747 MiB | Leave it. One WSL data directory. |
| `%LOCALAPPDATA%\Programs` | 3,660 MiB | Installed user programs. Leave them. |
| `%LOCALAPPDATA%\Packages` | 3,581 MiB | Store apps. Leave them. |
| `%LOCALAPPDATA%\CapCut` | 3,329 MiB | App data. Leave it. |
| `%APPDATA%\npm` | 3,067 MiB | Global npm prefix (`npm root -g`). Claude Code lives here. Leave it. |
| `%LOCALAPPDATA%\hermes` | 2,728 MiB | Application data, almost all in `hermes-agent` (2,667 MiB). Configuration files were present and were not opened. Leave it. |
| `%LOCALAPPDATA%\Temp` | 1,897 MiB | Temporary files, through Windows Settings. |
| `%LOCALAPPDATA%\Postman-Agent` | 1,290 MiB | Installed agent, not a cache. |
| `%APPDATA%\Zoom` | 1,249 MiB | App data. Leave it. |
| `%LOCALAPPDATA%\uv\cache` | 1,065 MiB | uv cache. `%APPDATA%\uv\tools` is a separate 363 MiB of tools. Leave the tools. |

Ollama is not installed. `ollama` is not on `PATH`. No `ollama` process is running. Nothing is listening on `127.0.0.1:11434`, `127.0.0.1:1234`, or `127.0.0.1:8080`. These paths are absent: `%USERPROFILE%\.ollama`, `%LOCALAPPDATA%\Ollama`, `%LOCALAPPDATA%\Programs\Ollama`, and `%LOCALAPPDATA%\Ollama\models`. There is no model store to clean. A future per-user install would create one of those locations. This audit did not create it.

Free space of 17.4 GiB can hold Ollama's published minimum (at least 4 GB for the program, plus model storage) and one small model. Using the 4 GB figure in full, plus the 523 MB model, would leave roughly 13 GiB free. That is enough for a trial and tight for Windows Update. The npm cache, if the user later cleans it, is the change that makes the disk comfortable.

## 4. Safe cleanup opportunities

Each action is for the user to run later, after approving that specific item. This audit ran none of them.

### A. Programs that can be closed for a test

Benefit is temporary RAM. The recoverable amount is an upper hint from the working set, not a promise. Private bytes are listed so they are not used as the expected gain.

| Close | Benefit | Upper hint | Risk | Lasts | Action |
| --- | --- | --- | --- | --- | --- |
| Google Chrome | RAM | 417 MiB working set | Low. Open tabs go away until Chrome is reopened. | Temporary | Quit Chrome from its menu. |
| Codex desktop app (`ChatGPT.exe`) | RAM | 237 MiB working set | Low for the PC. That app closes. | Temporary | Quit the Codex / ChatGPT desktop window. |
| Claude app | RAM | 197 MiB working set | Low for the PC. Claude's own windows close. | Temporary | Quit Claude. |
| Zoom | RAM | 40 MiB working set | Low, unless a call is in progress. | Temporary | Quit Zoom. |
| Teams | RAM | 34 MiB working set | Low. Chat notifications pause until it is opened again. | Temporary | Quit Teams. |
| Cursor | RAM | 1,076 MiB working set | High for this work session. The IDE, this chat, and unsaved editor state go with it. | Temporary | Quit Cursor only for an isolated model test, after saving work. |
| DesktopCompanion Electron | RAM | 81 MiB working set | The robot overlay stops until `npm run dev` is started again. | Temporary | Stop the dev session from its own terminal only if the test should run without the companion. |

OneDrive (about 23 MiB working set combined) and Postman Agent (about 15 MiB) are real background programs and poor RAM wins. Leave `node.exe` alone. The 1,805 MiB private figure is spread across Cursor helpers, Codex runtimes, and `C:\node.exe`.

### B. Optional startup programs

Benefit is persistent only in the sense that the program stops launching at sign-in. RAM gain is the working set of that program, and only while it would otherwise have been running. Disable these in **Settings > Apps > Startup**, or on the Startup tab of Task Manager. This audit did not change any of them.

Registered in the current-user Run key, with no disabled flag seen:

| Startup entry | Enabled flag | Running now | Risk if the user disables it |
| --- | --- | --- | --- |
| OneDrive (`OneDrive.exe /background`) | Enabled | Yes, small working set | OneDrive stops syncing until it is started again. |
| Microsoft Edge autolaunch | Enabled | Edge is running, 32 MiB working set | Edge stops opening a background window at sign-in. |
| Postman Agent | Registered, no disabled flag | Yes, about 15 MiB working set | The local Postman agent stops until it is started. |
| Teams (`msteams:system-initiated`) | Registered, no disabled flag | Yes, 34 MiB working set | Teams stops auto-starting. |
| Opera Stable (`--autostart`) | Registered, no disabled flag | Not in the process list | Opera stops auto-starting. |
| Opera Browser Assistant | Registered, no disabled flag | Not in the process list | The assistant stops auto-starting. |

Also registered: Tailscale in the common Startup folder. A Tailscale process was about 17 MiB of working set in the earlier sample. Disabling that shortcut disconnects the VPN at sign-in.

The user Startup folder also contains `App.url`. That shortcut was not opened. Review it in `shell:startup` before removing it.

### C. Caches with an official clean command

Benefit is disk space. It lasts until the tool downloads those packages again. Measured size is the folder size, which is the upper bound if the command deletes the whole cache and no file is locked.

| Cache | Measured | Risk | Action, when approved |
| --- | ---: | --- | --- |
| npm cache | 8,070 MiB | Low. Projects and `node_modules` stay. Later `npm install` re-downloads. | `npm cache clean --force` |
| uv cache | 1,065 MiB | Low. Installed tools under `%APPDATA%\uv\tools` (363 MiB) stay. | `uv cache clean` |
| pip cache | 431 MiB | Low. Environments stay. Later installs re-download. | `pip cache purge` |

Browser caches, through each browser's own settings, cached images and files only:

| Browser | Measured | Risk | Action |
| --- | ---: | --- | --- |
| Chrome Default profile | 613 MiB | Low if only cached images and files are cleared. | Chrome Settings, Privacy and security, Delete browsing data. Leave passwords and history unchecked. |
| Edge Default profile | 185 MiB | Same. | Edge Settings, Privacy, Clear browsing data. Cached images and files only. |

Crash dumps, 81 MiB, can be removed by the user from `%LOCALAPPDATA%\CrashDumps` when they are not investigating a crash. That is a small disk gain.

`%USERPROFILE%\.cache\codex-runtimes` is 1,387 MiB. It is a Codex runtime store, not an npm cache. Deleting that one directory is optional, medium risk: quit Codex first, and expect Codex to download the runtime again. Leave the rest of `.cache` alone.

Cursor's cache-like folders add up to about 430 MiB (`CachedData`, `CachedExtensionVSIXs`, `Cache`, `GPUCache`). There is no separate official cleaner to recommend, and Cursor is open. Leave them until a later session when Cursor is quit, and even then leave `User`, `snapshots`, and `auth.json` in place.

### D. Windows Settings storage cleanup

**Settings > System > Storage > Temporary files.**

The user temp folder measured 1,897 MiB. Windows will offer a smaller selectable amount when files are in use. That benefit is disk space, mostly persistent until apps write temp files again, and the risk is low when Windows itself is doing the deletion.

`C:\Windows\SoftwareDistribution\Download` measured 5 MiB, so Delivery Optimization and Windows Update cleanup are unlikely to return much on this boot. The Recycle Bin was not measured. Review that checkbox. Leave Downloads unchecked if it appears.

`C:\Windows\Temp` was not readable from this session. Do not clean it by hand.

### E. Leave these alone

| Item | Why |
| --- | --- |
| Windows Defender (`MsMpEng`) and SecurityHealth startup | Security software. Startup flag is enabled. |
| KeePass 2 PreLoad | Password manager, enabled in the machine Run key. |
| Realtek audio startup (`RtkAudUService64.exe -background`) | Enabled driver helper. Disabling it can affect sound, for almost no RAM. |
| Page file and virtual memory | System-managed, already in use (2,922 MB now, 5,825 MB peak). Do not delete or resize it to force a model to load. |
| System files, `C:\Windows\Temp`, and the Windows folder | Not a cache. |
| `%APPDATA%\Cursor\User` (7,486 MiB) and `snapshots` (2,929 MiB) | Editor state and local history. `auth.json` in the Cursor profile was not opened. |
| `%APPDATA%\npm` (3,067 MiB) | Global tools, including Claude Code. |
| DesktopCompanion repo, `node_modules` (479 MiB), `dist`, git history, and these research notes | The project under test. |
| `%LOCALAPPDATA%\Claude-Data` (9,097 MiB) | Claude application data. |
| `%LOCALAPPDATA%\hermes` (2,728 MiB) | Application data and configuration. Contents were not read. |
| WSL directory (4,747 MiB) | A Linux disk image, not a temp folder. |
| `%LOCALAPPDATA%\Google`, `\Microsoft`, `\Programs`, `\Packages`, CapCut, Postman Agent, Zoom, Binance, and Discord profile folders | Application or personal data. Only the browser cache checkboxes in section C are in scope. |
| Credential files, `.env` files, and anything under the user Documents, Desktop, Pictures, or Downloads folders | Not inspected, and not cleanup targets. |

## 5. Expected benefits and risks

The disk and the RAM tell different stories.

The dependable disk actions are the three official cache commands. npm alone is 8,070 MiB. uv and pip add 1,065 MiB and 431 MiB. If all three complete, free space on C: can rise from 17.4 GiB by up to about 9.3 GiB. User temp, through Settings, can add up to the 1,897 MiB that was measured, and will usually return less. Browser cache checkboxes can add up to about 0.8 GiB. Those disk gains do not create RAM.

The RAM actions are temporary and smaller than the private-byte column suggests. Quitting Chrome, the Codex desktop app, and Claude is on the order of 0.9 GiB of working set. Quitting Cursor as well is on the order of another 1.1 GiB, at the cost of this session. Memory Compression, Defender, and `svchost` stay. After those quits, a 0.6B model is still a supervised test on an 8 GB machine, not a proven fit.

Startup disables are persistent and small. Edge, Opera, Teams, Postman Agent, OneDrive, and Tailscale are the optional ones. OneDrive and Tailscale have sync and VPN consequences. Defender, KeePass, and Realtek stay enabled.

Doing none of this is a valid outcome. The machine is usable now because Windows is paging. Adding a model on top of the current desktop is the risky part, not the lack of a cleanup.

## 6. 0.6B vs 1.7B

Official metadata checked 2026-10-23. No model was downloaded. No tokens-per-second figure was measured.

Ollama's tag list currently gives `qwen3:0.6b` and `qwen3:0.6b-q4_K_M` the same digest, `7df6b6e09427`, at 523 MB, with a 40K context label. `qwen3:1.7b` and `qwen3:1.7b-q4_K_M` share digest `8f68893c685c`, at 1.4 GB, also labeled 40K. The default tags are the Q4_K_M files. Source: [Ollama qwen3 tags](https://ollama.com/library/qwen3/tags).

Architecture, from the Hugging Face configs for the matching base models, which sets the KV shape of the quantized files as well:

| | Qwen3-0.6B | Qwen3-1.7B |
| --- | --- | --- |
| Layers | 28 | 28 |
| Query heads / KV heads | 16 / 8 | 16 / 8 |
| Head dimension | 128 | 128 |
| Hidden size | 1,024 | 2,048 |
| Intermediate size | 3,072 | 6,144 |
| `max_position_embeddings` | 40,960 | 40,960 |

Sources: [Qwen3-0.6B config](https://huggingface.co/Qwen/Qwen3-0.6B/raw/main/config.json), [Qwen3-1.7B config](https://huggingface.co/Qwen/Qwen3-1.7B/raw/main/config.json). Qwen's 29 April 2025 announcement table lists the same layer and head counts and a 32K context for both sizes, and Apache 2.0 for both dense models. English and Spanish are in its list of 119 languages. Source: [Qwen3 announcement](https://qwenlm.github.io/blog/qwen3/). Ollama's library pages also show the Apache 2.0 license text. The announcement's 32K and the config's 40,960 disagree. Either full window is too large for this PC. The test requests 2,048.

KV cache size below is arithmetic, not a measurement. It assumes keys and values are stored as 16-bit floats, which is the usual llama.cpp default. Ollama's library page does not publish the KV dtype for these tags. If a future run uses a quantized KV cache, the cache is smaller than this. If the runtime uses a wider type, it is larger.

Bytes per token = 2 × layers × KV heads × head dimension × 2 bytes = 2 × 28 × 8 × 128 × 2 = 114,688 bytes, which is 112 KiB. Both models share this shape. The weight file is the difference.

| Context | KV cache, both models |
| --- | ---: |
| 2,048 tokens | 224 MiB |
| 4,096 tokens | 448 MiB |
| 40,960 tokens | 4.38 GiB |

A planning sketch adds three pieces: the published weight file, the 224 MiB KV cache at 2,048 tokens, and a 512 MiB reserve for the Ollama process and compute buffers. That reserve was not measured. Real overhead can be higher.

| Planning sketch at 2,048 tokens | qwen3:0.6b Q4 | qwen3:1.7b Q4 |
| --- | --- | --- |
| Weights, as published | 523 MB | 1.4 GB |
| KV cache | 224 MiB | 224 MiB |
| Unmeasured reserve | 512 MiB | 512 MiB |
| Extra commit, rough total | about 1.3 GiB | about 2.1 GiB |

Available RAM at the end of the audit was 620 MB. Neither sketch fits in free physical RAM on the current desktop. Commit headroom is about 5.0 GiB, so either model can be promised memory by using the page file. The page file is already 2.9 GiB into an 18.1 GiB allocation. Paging a model on this CPU can stall the UI before the commit limit is reached.

Qwen3 thinks before it answers unless non-thinking mode is requested. The announcement defaults `enable_thinking` to true, and `/no_think` is the prompt switch. Ollama's API has a separate `think` field: `false` asks for no thinking output when the model allows it. Source: [Ollama thinking](https://docs.ollama.com/capabilities/thinking). Thinking mode on this CPU would spend the wait, and the KV budget, on text the companion should not show.

Intel Iris Xe is not in Ollama's NVIDIA or AMD tables. Any Vulkan offload on this machine is unverified because Ollama has never run here. Plan on the i5-1235U. Source: [Ollama GPU support](https://docs.ollama.com/gpu), and the hardware notes in doc 09.

## 7. Recommended first model

**`qwen3:0.6b` is the first model to pull, and only after a separate approval.**

`qwen3:1.7b` stays a second experiment. Try it only if the 0.6B model is loaded, idle, and Available memory is still above about 1.5 GiB. The extra cost of 1.7B at the same context is the larger weight file, about 0.9 GB on the library labels. If the 0.6B test already drops Available memory under about 400 MB, or the cursor stutters, stop there. Do not pull 1.7B on that boot.

Operating rules for either size:

- One request at a time.
- Context 2,048 tokens for the first test.
- `think` set to false.
- A short reply cap on the test (`num_predict` 128). A later companion can use a few hundred tokens. That cap is a safety bound, not a tuned setting.
- Unload after the test. Ollama's default is to keep a model for 5 minutes. `keep_alive` of `0` unloads when the request finishes. `ollama stop qwen3:0.6b` unloads it immediately. Source: [Ollama FAQ](https://docs.ollama.com/faq).
- No second model loaded beside it.
- No background generation while the robot is asleep. The companion, when it eventually calls a model, should unload when the session goes idle.

This PC can attempt 0.6B as a supervised test. It is a poor fit as a model that stays resident next to Cursor, Chrome, Claude, and Codex. Doc 09's quality preference for 1.7B still stands for a machine with more free RAM. It is the wrong first download on this one.

## 8. Exact next steps for the user

1. Read this note and say which, if any, cleanup commands are approved. Approval to clean a cache is not approval to install Ollama.
2. Optional disk, in this order, each only if you want it: `npm cache clean --force`, then `uv cache clean`, then `pip cache purge`.
3. Optional RAM, before a future test: quit Chrome, the Codex desktop app, and Claude. Leave Defender, KeePass, and the page file as they are. Quit Cursor only if you want the test to have the IDE's working set back, and only after saving.
4. Optional and persistent: in Settings > Apps > Startup, turn off Opera, Opera Browser Assistant, Edge autolaunch, Postman Agent, or Teams if you do not want them at sign-in. Turn off OneDrive or Tailscale only if you accept the sync or VPN pause.
5. Leave every item in section E untouched.
6. Wait. Installing Ollama and pulling `qwen3:0.6b` is a separate yes.

## 9. Requirements for installing and testing Ollama safely

Do this only after you approve the install. The commands below are for you to run. They were not run during this audit.

Install requirements:

- Official Windows guide: [Ollama on Windows](https://docs.ollama.com/windows). Per-user install. The guide does not require an administrator. This PC is Windows 11 Home, version 25H2, build 26200, which meets the guide's Windows 10 22H2 baseline.
- At least 4 GB free for the program, plus the model. C: has 17.4 GiB free today. After the installer, if free space is under 10 GiB, stop and clean the npm cache before any pull.
- Pull one tag: `ollama pull qwen3:0.6b`. That is the 523 MB Q4_K_M file. Do not pull `qwen3:1.7b` in the same step.
- Stay on `http://127.0.0.1:11434`. Local requests need no API key. Do not sign this test in to Ollama cloud.

Test procedure:

1. Quit the apps you chose in section 8. Note Available memory in Task Manager, or with:

```powershell
(Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue
```

2. Send one short request. `curl.exe` avoids PowerShell's `curl` alias:

```powershell
curl.exe http://127.0.0.1:11434/api/chat -d "{\"model\":\"qwen3:0.6b\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one sentence.\"}],\"think\":false,\"keep_alive\":\"1m\",\"stream\":false,\"options\":{\"num_ctx\":2048,\"num_predict\":128}}"
```

3. Watch Available memory while it loads and answers.

Stop if any of these happen:

- Available memory stays under about 400 MB.
- The cursor stutters, or windows stop painting.
- The machine stops accepting clicks or keystrokes.

Then run, if a terminal still opens:

```powershell
ollama stop qwen3:0.6b
```

If a terminal cannot be opened, wait. Do not change the page file. Signing out of Windows ends the processes without deleting files. A restart is the recovery if the session stays frozen. Do not pull `qwen3:1.7b` after a stop.

4. After a calm run, unload the model anyway with `ollama stop qwen3:0.6b`. A calm run means the UI stayed responsive and Available memory stayed comfortably above 400 MB. The 1.7B decision waits for a later approval, and only if idle Available memory with 0.6B loaded is still above about 1.5 GiB.

DesktopCompanion stays unchanged. The chat renderer keeps `connect-src 'none'`. A future milestone, separately approved, is what may let the main process call `127.0.0.1:11434`. This test does not wire the robot to the model, and it does not generate while the robot is asleep.

No cleanup and no install until you approve them.
