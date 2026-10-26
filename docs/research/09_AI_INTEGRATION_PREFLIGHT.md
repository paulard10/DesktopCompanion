# 09 — AI integration preflight

**Date:** 2026-10-23  
**Status:** research only. No provider, model, SDK, or production code was added.

This note prepares the first real conversation for DesktopCompanion. M1.5 remains the demo chat: fixed local replies, no network, and the robot's sleep, wake, and gaze reducer unchanged. The checks below are read-only. No credential store, token file, or personal document was opened.

## 1. Hardware report

Read on this machine on 2026-10-23. Decimal figures are GiB as reported by Windows, written with a dot.

| Item | Reading |
| --- | --- |
| Computer | Microsoft Surface Laptop Go 3 |
| CPU | 12th Gen Intel Core i5-1235U, 10 cores, 12 logical processors, WMI max clock 2500 MHz |
| Installed RAM | 7.83 GiB visible |
| Free RAM at the time of the check | 0.79 GiB |
| GPU | Intel Iris Xe Graphics, driver 32.0.101.6737, status OK |
| Dedicated GPU VRAM | None. `nvidia-smi` is not installed. WMI reports 2 GiB of adapter memory, which on this integrated GPU is a share of system RAM, not a separate graphics card. |
| Operating system | Microsoft Windows 11 Home, version 25H2, build 26200, 64-bit. The NT version string is 10.0.26200. One registry product-name field still says Windows 10 Home; the operating-system caption is Windows 11 Home. |
| Disk | C: 237.1 GiB NTFS, 17.5 GiB free |
| Ollama | The `ollama` command is not installed. No `ollama` process is running. |
| Local inference | Nothing answered on `127.0.0.1:11434` (Ollama), `127.0.0.1:1234` (a common LM Studio port), or `127.0.0.1:8080`. |

The free-RAM figure is one moment while the desktop was already in use. It is not a permanent capacity. It does show that a model cannot be loaded on top of the current working set.

Ollama's Windows guide says the install needs at least 4 GB for the program, plus more space for models, and that a normal user install does not require an administrator. This disk can hold that plus one small model, and would then have roughly 12 GB free if the 4 GB install figure is accurate. That is enough for a trial and tight for Windows updates and other downloads.

Sources: [Ollama on Windows](https://docs.ollama.com/windows), [Ollama hardware support](https://docs.ollama.com/gpu).

## 2. Current SDK and authentication findings

These are separate kinds of access. Having Cursor, Claude Code, or Codex installed does not by itself give DesktopCompanion a chat backend.

### Existing subscription access

A Claude, ChatGPT, or Cursor subscription pays for that vendor's own apps and, in some cases, their coding agent. It is not a general API allowance.

Anthropic's Agent SDK overview and quickstart say that, unless previously approved, third-party developers may not offer claude.ai login or subscription rate limits in their products, including agents built on the Claude Agent SDK. The supported method is an API key in `ANTHROPIC_API_KEY`, or Bedrock, Google Cloud, or Microsoft Foundry credentials. The [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) is stricter about a product we would ship: developers building products with the Agent SDK should use an API key, may not offer Claude.ai login inside their own application, and may not route requests through Free, Pro, or Max credentials or store those session tokens. An end user may sign in to an unmodified Claude Code binary with their own subscription. That is Claude Code, not our chat window.

A help-center article updated 7 October 2026 says Max and Team plans now include monthly API credits, and that Agent SDK, `claude -p`, and third-party app usage can still draw on subscription limits because an earlier restriction was paused. That article and the legal page do not say the same thing. For DesktopCompanion, follow the legal page and the SDK quickstart: do not attach the user's Claude login to this app. This preflight did not look up which Claude plan is signed in on this PC, so Max or Team credit eligibility is unknown.

Codex can sign in with a ChatGPT subscription or with an API key. The [authentication guide](https://developers.openai.com/codex/auth) says the ChatGPT desktop app, Codex CLI, and IDE extension share a cached login, stored in `~/.codex/auth.json` or the OS credential store, and refresh it during use. The Python SDK readme says an existing Codex login is reused automatically. That reuse is for Codex itself. It is not permission to point a desktop companion at the cache. This preflight did not open that file.

Cursor's TypeScript SDK authenticates with a user or service-account API key, or with `Cursor.auth.login()`, which mints a key through a browser login. The SDK does not read a key out of the installed Cursor application. Team Admin API keys are not accepted. Official API overview: the Cloud Agents API and the SDKs run Cursor agent workflows, with workspace context, tools, commands, and edits. They are not a chat-completions API.

### API usage credits

Claude Max 5x, Max 20x, and Team plans can claim monthly Claude Console credits: $100, $200, and up to $500 pooled, respectively. Free, Pro, and Enterprise plans are not eligible. New subscribers wait 7 days. Credits cover the Claude API, Claude Managed Agents, the Claude Agent SDK, and the console playground. They do not cover Claude Code or extra usage inside the Claude apps, and they expire each billing cycle with no rollover. Using them still means creating an API key and paying the platform from that credit balance. Source: [API credits for Max and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers).

ChatGPT subscription usage and OpenAI API billing are different accounts. Codex's own auth page says an API-key sign-in is billed on the OpenAI Platform at standard API rates, not as included ChatGPT plan usage.

### Pay-per-token API access

Prices below are official standard rates in USD per million tokens, checked 2026-10-23. They are list prices, not a quote for this project. Cache writes, long prompts, batch, and regional processing cost more or less than the base rate. See the linked pages before any key is used.

Claude API, short of the long-prompt surcharge ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

| Model | Input | Output |
| --- | --- | --- |
| Claude Haiku 5.5, prompts up to 100,000 tokens | $0.10 | $0.50 |
| Claude Haiku 5.5, prompts over 100,000 tokens | $0.50 | $2.50 |
| Claude Sonnet 5.5 | $2 | $10 |
| Claude Opus 5.5 | $4 | $20 |
| Claude Fable 5.1 | $10 | $50 |

OpenAI API, standard short-context rates ([pricing](https://developers.openai.com/api/docs/pricing)):

| Model | Input | Output |
| --- | --- | --- |
| GPT-6 Luna | $0.10 | $0.50 |
| GPT-6.1 Sol | $2 | $10 |
| GPT-6 Astra | $10 | $50 |

A short companion reply is cheap at the Haiku 5.5 or GPT-6 Luna rate. The cost risk is an unbounded prompt, a retry loop, or a key left in the app, not the price of one sentence.

### Local inference

Ollama's local API is `http://127.0.0.1:11434`. Local requests need no API key. The OpenAI-compatible base URL is `http://127.0.0.1:11434/v1`, and the client key is ignored. Streaming chat, and a non-stateful Responses subset, are documented. The native chat route is `POST /api/chat`. Cloud models on `https://ollama.com` are a separate, keyed service and are not the local plan. Sources: [API introduction](https://docs.ollama.com/api/introduction), [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility), [authentication](https://docs.ollama.com/api/authentication).

Documented acceleration is NVIDIA CUDA, AMD ROCm or Vulkan, Apple Metal, and Vulkan more generally. Intel Iris Xe is not in the NVIDIA or AMD tables. Vulkan can use a Windows GPU whose driver exposes it, and Ollama's issues show Iris Xe machines that stayed on CPU until a Vulkan or iGPU setting was applied. This PC has not run Ollama, so GPU offload here is unverified. Plan for CPU inference, and treat any Iris Xe speedup as something to measure after an approved install.

### SDK capabilities, and why the coding agents are the wrong backend

| Option | What it actually does | Fit for this chat |
| --- | --- | --- |
| Claude Agent SDK | Runs an agent with tools, against a working directory, using an API key or a cloud provider. | A coding agent. Not a small talk window. Subscription login is not allowed for our product. |
| Codex SDK | Starts Codex threads, streams turns, and controls workspace access and a sandbox. It can reuse a Codex login. | A coding agent with a filesystem. Reusing the login would also mix ChatGPT subscription billing into our app. |
| Cursor SDK and Cloud Agents API | Runs the Cursor agent, locally or in the cloud, with tools, commands, and edits. Requires its own API key. | Explicitly not a chat-completions API. A local run needs Node 22.13 or newer and a workspace. |
| Claude or OpenAI HTTP API | Text in, text out, with the caller's key. | A possible later BYOK provider. No tools required. |
| Ollama on localhost | Text in, text out, on this machine. | The first backend that does not bill anyone and does not touch a subscription. |

Sources: [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Codex Python SDK](https://github.com/openai/codex/blob/main/sdk/python/README.md), [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript), [Cursor APIs](https://cursor.com/docs/api).

### Commercial redistribution

- Do not ship Claude Code, Codex, or Cursor inside DesktopCompanion, and do not resell a seat on those subscriptions.
- Anthropic's conditions for redistributing Claude Code require an unmodified binary, each end user's own credential, and no use of the Claude or Anthropic names in a way that implies a partnership.
- Ollama's program is installed by the user. Bundling its binary or a model into our installer is a later licensing decision, not part of the first conversation.
- Qwen3 dense weights, including 1.7B, are Apache 2.0 on Qwen's announcement and on the license blob Ollama publishes for `qwen3:1.7b`. Apache 2.0 allows commercial use and redistribution if its notice and license terms are kept. Qwen2.5 3B and 72B are the exception inside that older family: Ollama's own model page says those two sizes use the Qwen license, not Apache 2.0. Do not choose `qwen2.5:3b` for a product that may be commercial.

## 3. Provider comparison

| | A. Local Ollama | B. Anthropic API | C. OpenAI API | D. Claude Agent SDK | E. Codex SDK |
| --- | --- | --- | --- | --- | --- |
| First-chat cost | No token bill. Disk and RAM only. | Pay per token, or Max/Team console credits if that plan is later confirmed. | Pay per token. | Same as the API, plus an agent runtime. | ChatGPT subscription or API rates, plus an agent runtime. |
| Data leaving the PC | No, if the call stays on `127.0.0.1`. | Yes, to Anthropic or the chosen cloud. | Yes, to OpenAI. | Yes. | Yes, unless pointed at a local provider. |
| Quality on this PC | Limited by a 1–2B model and little free RAM. | High, even with Haiku 5.5. | High, even with GPT-6 Luna. | High, and aimed at tool use. | High, and aimed at a repository. |
| Nontechnical install | User must install Ollama and download a model. Poor as the only path for a shipped app. | User pastes their own key later. | User pastes their own key later. | User must accept an agent that can see a workspace. | Same, and it may see the Codex login. |
| Billing surprise | None, until someone enables Ollama cloud. | Real if the prompt is unbounded. | Real if the prompt is unbounded. | Real, and easy to confuse with a Claude subscription. | Real, and easy to confuse with a ChatGPT subscription. |
| Fits M1.5 security | Main process calls localhost. Renderer stays offline. | Main process holds the key. | Main process holds the key. | Pulls in tools and a working directory we do not want. | Pulls in a sandbox, a cwd, and possibly `auth.json`. |

**Recommendation for the first real conversation:** A, local Ollama, on this developer machine only.

It is the only option that needs no key, no subscription, and no third-party login. B and C are the right later path for a person who wants a stronger answer and brings their own key. D and E should not be the conversational backend.

## 4. Recommended local model

**Use `qwen3:1.7b` if a download is later approved.** Do not download it as part of this preflight.

| Fact | Source |
| --- | --- |
| Tag | `qwen3:1.7b` on the [Ollama library](https://ollama.com/library/qwen3) |
| Download size | 1.4 GB |
| Quantization | `Q4_K_M`, from the published GGUF metadata (`general.file_type`) |
| Context in that file | 40960 tokens in the same metadata. Qwen's announcement table lists 32K for Qwen3-1.7B. The app should request a much smaller context than either number. |
| Languages | Qwen's [Qwen3 announcement](https://qwenlm.github.io/blog/qwen3/) lists English and Spanish among 119 languages and dialects. |
| Licence | Apache 2.0 for the dense Qwen3 models, including 1.7B, on that announcement and on [Ollama's license blob](https://ollama.com/library/qwen3:1.7b/blobs/d18a5cc71b84). |

Why this size and not a neighbour:

- `qwen3:0.6b` is 523 MB and easier on RAM, and it is the fallback if 1.7B swaps or fails to load.
- `qwen3:4b` is 2.5 GB and `qwen3:8b` is 5.2 GB. Those downloads, plus Windows and the apps already open, do not fit a comfortable first test on 7.83 GiB.
- `qwen2.5:1.5b` is 986 MB, Apache 2.0, and explicitly multilingual, but it is the older generation. `qwen2.5:3b` is the wrong licence for a product that may be commercial.

Expected limits, without a benchmark on this PC:

- No tokens-per-second number is claimed. None was measured.
- Qwen3 thinks before it answers unless non-thinking mode is requested. The announcement defaults `enable_thinking` to true. On this CPU that extra text would be paid for in wait time. The first provider must request non-thinking mode and must not show a thinking trace as the chat reply.
- The model will be weaker at long instructions, facts, and mixed Spanish and English than Haiku 5.5 or GPT-6 Luna. Short turns are the intended test.
- Runtime RAM is weights plus the KV cache plus everything else already running. Ollama does not publish a RAM figure for this laptop. With 0.79 GiB free at check time, other programs have to be closed before a load can succeed.
- Iris Xe offload is unverified here. If Vulkan is not selected, inference stays on the i5-1235U.
- Keep one model loaded. Ollama's own iGPU discussion treats concurrent models as a way to exhaust shared RAM.

Redistribution: Apache 2.0 allows shipping the weights later if the license and notices travel with them. Do not put the file in the app until that packaging is a separate, approved decision. The first test is `ollama pull`, done by the user after approval.

## 5. Proposed AI adapter architecture

The chat renderer stays sandboxed. Production CSP already sets `connect-src 'none'`. The main process is the only place that may open a socket, and for the first provider that socket is `127.0.0.1:11434` only.

The current demo path stays the default until a provider is selected. `acceptUserMessage` remains the offline fallback when Ollama is absent, so the chat never pretends a model answered.

### Adapter

One interface, implemented in the main process. No tools, no shell, and no filesystem access on behalf of the model.

```ts
interface ConversationProvider {
  readonly id: 'demo' | 'ollama';
  identify(): { provider: string; model: string };
  send(
    request: ConversationRequest,
    signal: AbortSignal,
  ): AsyncIterable<ConversationEvent>;
}

interface ConversationRequest {
  conversationId: string;
  messages: { role: 'system' | 'user' | 'assistant'; text: string }[];
}

type ConversationEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; finish: 'stop' | 'length' | 'cancelled' }
  | { type: 'error'; code: ConversationErrorCode; message: string };

type ConversationErrorCode =
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'rejected'
  | 'too-long'
  | 'busy';
```

Rules for the first Ollama implementation:

- One request at a time. A second send returns `busy` until the first finishes or is cancelled.
- Cancel by aborting the localhost request. The chat close and a Stop control both abort.
- 20 seconds to the first token, then 60 seconds overall. Either limit becomes `timeout`.
- Send only a short system prompt plus the last few turns. Cap the requested context (`num_ctx`) far below 32K, and cap the reply (`num_predict`) to a few hundred tokens. Those caps exist to bound RAM and wait time. They are not a measured optimum.
- Ask Ollama not to think. If a thinking block still arrives, drop it before the text is shown.
- The model id in `done` is the id Ollama reports, not a label we invent.
- Do not log message text. Log provider, model, error code, and timing only.
- Do not follow a model instruction to open a tool, file, or URL.

### IPC

Extend the existing chat channel, still checked so the sender is the top-level chat page on the trusted origin. The robot page cannot start a completion. The chat preload still does not receive `ipcRenderer`.

Suggested events, all validated before they reach the page:

- `chat:send` already carries the user text. Main appends the user line, then starts the provider.
- `chat:cancel` aborts the active request.
- `chat:delta` carries a string chunk.
- `chat:done` carries the model id and finish reason.
- `chat:error` carries the error code and a short fixed sentence. No provider body, no stack, no URL with a key.

The page keeps using `textContent`. Streaming appends text nodes. It does not parse the model output as HTML.

### Robot presence, separate from behavior

Do not add ATTENTIVE, THINKING, RESPONDING, or ERROR to `reduceBehavior`. Sleep, wake, gaze, and the 60 second timer stay as they are. Chat send and typing already refresh that timer through the trusted wake path. A model reply does not move the window and does not grant a permission.

Presence is a second, allowlisted value owned by the main process:

| Intent | When | What the robot may do |
| --- | --- | --- |
| ATTENTIVE | The chat is open and no request is running. | The existing awake face and gaze. |
| THINKING | A request is in flight and no token has arrived. | A small, deterministic waiting pose. |
| RESPONDING | Tokens are arriving. | A small speaking pose, then back to attentive when `done` arrives. |
| ERROR | The provider returns `error`. | A brief error pose, then attentive. The chat shows the fixed error sentence. |

The renderer may play only those four poses. It cannot set them itself, and it cannot use them to change phase, click-through, or sleep.

## 6. Security and billing risks

- A coding-agent SDK pointed at this repository can read files and run commands. That is the opposite of the M1.5 boundary. Do not import one to get a chat reply.
- Reusing `~/.codex/auth.json`, a Claude OAuth token, or a Cursor key harvested from the installed app would bypass the vendor's login flow. Do not read those stores.
- An API key in the renderer, in git, or in a log line is a billing leak. A future BYOK key belongs in the main process, in OS-protected storage, and never in IPC payloads or the chat page.
- Ollama on localhost has no authentication. Binding it to a public interface would let other machines use the model. The provider must call `127.0.0.1` only.
- Ollama cloud and `OLLAMA_API_KEY` are metered. The first provider must not set that key and must not select a `:cloud` tag.
- A long context or an automatic retry can turn a cheap Haiku or Luna call into a large bill. The same caps used for Ollama apply to any later HTTP provider: one request, a timeout, a short history, and no retry loop.
- Max and Team API credits expire and do not cover Claude Code. They are not a reason to skip an API key or to hide usage from the person paying.
- The model can still say something false or claim it used the computer. The system prompt and the chat header must keep saying that this build has no screen access, no Cursor access, and no tools. The demo label goes away only when a real provider is selected, and the header then names that provider and model.
- Shared graphics memory is the same RAM as the OS. Loading a model while free RAM is under 1 GiB can make the machine unresponsive. The implementation should refuse to start a request when Ollama is not running, rather than spawning a download.

## 7. Exact next implementation task

**M1.6B — local conversation provider, after install approval.**

1. Add the provider interface and keep the current demo provider as the default.
2. Add an Ollama provider in the main process for `http://127.0.0.1:11434/api/chat`, streaming, with the caps in section 5.
3. Stream validated text to the chat page. Add cancel.
4. Send the four presence intents to the robot without changing the behavior reducer.
5. If Ollama is not running or the model is missing, show a fixed unavailable message and keep the demo reply available. Do not install Ollama from the app.
6. Tests: error codes, timeout and cancel, one-at-a-time rejection, sender checks, presence allowlist, and the existing behavior and click-through tests still passing.
7. No new npm dependency unless `fetch` in the main process proves insufficient.

Do not start M1.6B until the packages in section 8 are approved. Do not add a key, a tool, or a second provider in that task.

## 8. Packages or software requiring approval

Nothing was installed. Approval is required before any of the following:

| Item | Why | Approval needed |
| --- | --- | --- |
| Ollama for Windows, per-user installer from [the official Windows page](https://docs.ollama.com/windows) | Local server. About 4 GB, no administrator rights according to Ollama. | Yes, before M1.6B can be tried on this PC. |
| `ollama pull qwen3:1.7b` | 1.4 GB download, Apache 2.0. | Yes, separate from the installer. |
| `qwen3:0.6b` | 523 MB fallback if 1.7B cannot load. | Only if the 1.7B trial fails. |
| `@anthropic-ai/sdk`, `openai`, `@cursor/sdk`, Claude Agent SDK, Codex SDK | Not needed for the localhost provider. | No for M1.6B. |
| An Anthropic or OpenAI API key | Later BYOK. | No for M1.6B. |

## M1.6A PREFLIGHT REPORT

This Surface Laptop Go 3 has an Intel i5-1235U, 7.83 GiB of RAM, Intel Iris Xe with no dedicated VRAM, Windows 11 Home 25H2, and 17.5 GiB free on C:. Ollama is not installed, and no local inference port is open. Cursor, Claude Code, and Codex are the wrong backend for this chat: they are coding agents, and their subscriptions are not an API we may route through DesktopCompanion. The safe, zero-bill first conversation is Ollama on localhost with `qwen3:1.7b` in `Q4_K_M`, non-thinking, one request at a time, called only from the main process. Quality and speed will be modest, and this hardware is not the machine to ship as a local-model requirement. A later stronger answer should be the user's own Claude Haiku 5.5 or GPT-6 Luna key, behind the same adapter.

**Next step:** approve the Ollama install and the 1.4 GB `qwen3:1.7b` download, or say not to. Implementation waits for that decision.
