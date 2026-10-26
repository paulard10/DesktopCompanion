# 11 — OmniRoute feasibility

**Date:** 2026-10-23  
**Status:** research only. OmniRoute was not started, changed, or called. No token, cookie, or `.env` file was opened. DesktopCompanion was not modified.

This note checks whether the OmniRoute install already on this PC can be the first AI backend. [09 — AI integration preflight](09_AI_INTEGRATION_PREFLIGHT.md) designed a main-process provider and preferred a local model. [10 — Windows local AI resource audit](10_WINDOWS_LOCAL_AI_RESOURCE_AUDIT.md) then found about 620 MB of available RAM and recommended `qwen3:0.6b` only as a supervised test. The preference now is zero cost without loading a model into this 8 GB laptop.

The installed OmniRoute is a local router. A request that it forwards to a cloud model is online inference. The router running on localhost does not make that answer offline.

## 1. Current OmniRoute installation

| Check | Result |
| --- | --- |
| Installed | Yes |
| Version | `omniroute` 3.8.50, from `package.json` in the global npm package |
| Method | npm global. Commands are `%APPDATA%\npm\omniroute.cmd` and `omniroute.ps1`. Package directory is `%APPDATA%\npm\node_modules\omniroute` |
| License of the router | MIT, declared in that `package.json` |
| Node engine declared by the package | `>=22.22.2 <23` or `>=24.0.0 <27`. This machine's Node 24.21.0 is inside the second range |
| Data directory | `%USERPROFILE%\.omniroute` |
| Package size on disk | 2,362 MiB |
| Process | Not running. No OmniRoute process. Port `20128` is not listening. The `.pid` files under `.omniroute\server` and `.omniroute\supervisor` are empty |
| Incremental RAM today | 0 MiB, because the service is stopped. It was not started, so a running working set was not measured |

The documented local API, from OmniRoute's OpenAPI spec and quick start, is:

`http://127.0.0.1:20128/v1/chat/completions`

with `Authorization: Bearer` set to an endpoint key created in Dashboard → Endpoints. The installed package's default listen port in those docs is `20128`. Sources: [OpenAPI spec](https://github.com/diegosouzapw/OmniRoute/blob/main/docs/openapi.yaml), [quick start for v3.8.50](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.50/docs/getting-started/QUICK-START.md), [user guide](https://github.com/diegosouzapw/OmniRoute/blob/main/docs/guides/USER_GUIDE.md).

A standalone Electron app would use that same pattern as the documented IDE clients: the trusted main process sends HTTP to `127.0.0.1` only. The renderer never opens the socket. Production CSP already sets `connect-src 'none'` in `src/shared/csp.ts`, so the chat page cannot call OmniRoute even if it is given a URL.

One local endpoint key exists. Its dashboard name is `agent-world-local`, and its allowed-model list is empty. The key string was not read. That key belongs to another local client. DesktopCompanion must not reuse it.

## 2. Provider access and free-tier findings

The database was opened read-only. The query selected provider id, auth type, active flag, default model, test status, and usage totals. It did not select access tokens, refresh tokens, API keys, cookies, emails, or `provider_specific_data`. `%USERPROFILE%\.omniroute\.env` was not opened.

| Stored fact | Value |
| --- | --- |
| Provider connections | 1 |
| Provider id | `kiro` |
| Auth type | `oauth` |
| Active | yes |
| Test status | `active` |
| Combos | none |
| Custom provider nodes | none |
| Successful chat calls | 323 |
| Model on those calls | requested `kiro/qwen3-coder-next`, recorded provider `kiro`, model `qwen3-coder-next` |
| Other models in the call log | `connection-test` only (208 rows) |
| Kimi provider or Kimi model id | none in connections, usage, or call-log model columns |

So the Qwen use on this install is Kiro serving **Qwen3 Coder Next**, not a Qwen Cloud key and not Qwen Web. Kimi is not configured here. Kiro's own FAQ lists Qwen3 Coder Next among the open-weight models inside Kiro, next to a free tier of 50 credits. Source: [Kiro FAQ](https://kiro.dev/faq/).

OmniRoute's catalog entry for this provider, in the installed 3.8.50 source, says the free tier is about 50 credits per month and carries this warning: Kiro's terms prohibit third-party proxy or harness use. The entry is marked `subscriptionRisk` with a deprecated risk notice.

Kiro's FAQ states the permitted surfaces and the prohibition in one place:

> Kiro subscriptions can be used with Kiro IDE, Kiro CLI, Kiro Web, Kiro Crew, ACP compatible IDEs, and automation in software development (ex: reviews during CI/CD). Use through third-party automation harnesses (such as OpenClaw) that route requests outside of Kiro's native interfaces is not permitted.

Source: [Kiro FAQ](https://kiro.dev/faq/) and the same sentence on [Kiro pricing](https://kiro.dev/pricing/).

OmniRoute is a third-party router. DesktopCompanion calling OmniRoute, which then calls Kiro with the stored OAuth session, is that prohibited shape. It is not an ACP IDE, and it is not Kiro's own CLI. The 323 earlier calls show the route has worked. They do not make it allowed for this app.

Other Qwen and Kimi mechanisms exist in OmniRoute's catalog. None of them are connected in this database:

| Catalog id | How a person signs in | Why it is not the current install |
| --- | --- | --- |
| `qwen-cloud`, `qwen-cloud-token-plan` | API key from Qwen Cloud / Model Studio | No connection row |
| `qwen-web` | Browser token or cookie from chat.qwen.ai | No connection row. Cookie replay is also the wrong credential for our app |
| `kimi`, `kimi-coding-apikey` | Moonshot or Kimi Code API key. The user guide prices Kimi K2 at a $9/month plan or per-use billing | No connection row |
| `kimi-coding` | OAuth for the Kimi Code CLI, marked subscription risk | No connection row |
| `kimi-web` | Browser token from kimi.ai | No connection row |
| `qoder` (`if/`) | OAuth. The guide lists free Qwen and Kimi model ids on that provider, also marked subscription risk | No connection row |

`auto` routing is the wrong switch even if the service were started. OmniRoute's user guide describes `auto` as a score across every connected provider, with fallback. A later paid connection would become eligible. This app needs one explicit model and an error when that model is unavailable.

## 3. Integration architecture

The chat path today stays inside the main process. `src/preload/chatPreload.ts` exposes `sendMessage`, which sends `chat:send`. `src/main/chatWindow.ts` accepts that event only from the chat frame, then `acceptUserMessage` in `src/shared/demoConversation.ts` appends a fixed demo reply. There is no network.

A future provider keeps that boundary:

- The renderer still sends text and renders text. It receives no base URL, no bearer token, and no upstream token.
- The main process is the only caller.
- One request at a time. A second send returns busy.
- Short history, a 2,048-token context cap when the API allows it, and a short reply cap.
- The provider is opt-in. The demo reply remains the default.
- Failure is an error in the chat. There is no silent hop to a second host.

**OmniRoute provider: do not build it against this install.** The endpoint would have been `POST http://127.0.0.1:20128/v1/chat/completions` with a dedicated endpoint key and the model id `kiro/qwen3-coder-next`. That call would reuse the Kiro OAuth session OmniRoute already stores. Section 2 is the reason that adapter is out.

**Direct provider, if a later milestone is approved:** the main process calls one Alibaba Model Studio OpenAI-compatible URL with a general API key the user creates for this app. Model Studio's own docs tell third-party tools to use that key and a regional compatible-mode base URL. Source: [get an API key](https://www.alibabacloud.com/help/en/model-studio/get-api-key), [connect third-party tools](https://www.alibabacloud.com/help/en/model-studio/more-tools). The key lives in the main process only, supplied by the user, never copied out of `.omniroute`.

```ts
interface ConversationProvider {
  readonly id: 'demo' | 'qwen-direct';
  identify(): { provider: string; model: string };
  send(
    request: { messages: { role: 'system' | 'user' | 'assistant'; text: string }[] },
    signal: AbortSignal,
  ): AsyncIterable<
    | { type: 'delta'; text: string }
    | { type: 'done'; model: string }
    | { type: 'error'; code: 'timeout' | 'cancelled' | 'unavailable' | 'rejected' | 'busy' }
  >;
}
```

Rules for `qwen-direct`, when it is eventually implemented:

- One host, one model id, chosen from the free-quota model list at implementation time.
- No `auto`, no combo, and no second provider.
- Enable the console switch **Free Quota Only** before the first call. Model Studio's free-quota page says that after the quota is gone, billing continues as pay-as-you-go unless that switch is on. Source: [free quota for new users](https://www.alibabacloud.com/help/en/model-studio/new-free-quota), updated 16 October 2026.
- Token Plan and Coding Plan keys do not draw the new-user free quota. A general pay-as-you-go key does, and it can also bill. The stop switch is what keeps a test from becoming a charge.
- The free quota is for the Singapore region, international deployment scope, real-time inference, and 90 days from activation. This audit did not check whether this user has that account or any remaining quota.
- Timeouts stay as in doc 09: 20 seconds to the first token, 60 seconds overall.
- Do not log message text.

## 4. Security and licensing considerations

| Path | Permitted for DesktopCompanion? |
| --- | --- |
| Kiro OAuth through OmniRoute | No. Kiro forbids third-party harnesses that leave its native interfaces. OmniRoute's own Kiro entry says the same. |
| Reusing `agent-world-local` | No. The secret was not read, and the key was created for another client. The upstream would still be Kiro. |
| Qwen Web or Kimi Web cookies | No. Those are browser session copies. They were not present here, and they are not an application credential. |
| Model Studio API key that the user creates | Yes, as an ordinary API client. Model Studio documents third-party tools and application code as the way to call it. Billing still follows the key unless Free Quota Only is on. |
| Ollama `qwen3:0.6b` | Yes for a local test. The weights are Apache 2.0, as recorded in doc 09 and doc 10. The cost is RAM and CPU, not a third-party session. |

The router license (MIT) covers OmniRoute itself. It does not grant a right to forward a Kiro session into another product.

Prompts sent through OmniRoute today would leave the PC for Kiro. A Model Studio call would leave the PC for Alibaba Cloud. An Ollama call stays on the machine.

## 5. RAM implications

From doc 10, this PC had 7.83 GiB visible and 620 MB available at the end of that audit, with 20.92 GiB already committed. Nothing in today's inspection started OmniRoute, so its running cost is still unmeasured.

What is known:

- Stopped, OmniRoute adds no RAM.
- The package is 2,362 MiB on disk. That number is disk, not a working set.
- A cloud answer through the router does not load Qwen weights into Iris Xe or system RAM. The Node server still has to run beside Cursor, Chrome, Claude, and Codex. On this machine that extra process is unpaid RAM we have not measured, and available memory is already under 1 GB.
- Ollama `qwen3:0.6b` at 2,048 tokens was sketched in doc 10 at about 1.3 GiB of extra commit. That is the option that can slow the laptop. It is also the option that works with the network unplugged.

Avoiding a slowdown points away from Ollama and also away from leaving a large Node router resident. A direct HTTPS call from the Electron main process adds one short-lived request, not a model and not a second server.

## 6. Recommended first AI backend

**Do not use the existing OmniRoute installation.**

The blocker is specific. The only connected account is Kiro OAuth, the only chat model in its history is `kiro/qwen3-coder-next`, and Kiro's terms plus OmniRoute's own warning disallow a third-party harness. There is no eligible free Qwen or Kimi connection on this install to point at instead.

**First backend to build, after a separate approval: a direct Model Studio call with Free Quota Only enabled.**

That matches zero incremental model RAM, a credential made for an application, and a console switch that stops the service when the free quota ends. It is online. It is not a promise that this account still has free quota. The user creates the key. This project does not read one out of OmniRoute.

**Offline alternative:** the supervised `qwen3:0.6b` test in doc 10, only if the user accepts the RAM risk and approves the install. Do not pull `qwen3:1.7b` first. Do not install Ollama as part of this note.

Comparison:

| | A. This OmniRoute install | B. Ollama `qwen3:0.6b` | C. Model Studio free quota, Free Quota Only |
| --- | --- | --- | --- |
| Incremental money | Kiro free tier is 50 credits, then paid add-ons exist. The integration itself is not allowed | No token bill | $0 while the quota lasts and the stop switch is on. Pay-as-you-go begins if that switch is left off |
| RAM | Router process, unmeasured, plus no local weights | About 1.3 GiB extra commit in the doc 10 sketch. Can stall an 8 GB laptop | Request overhead in the Electron process. No local weights and no router |
| Quality | Qwen3 Coder Next, as already used through Kiro. No speed or quality number was measured today | Small local model. Weaker than a hosted Qwen | A hosted Qwen id chosen from the free-quota list. Stronger than 0.6B, still not measured here |
| Speed | Depends on Kiro and the network. Not measured | CPU on the i5-1235U. Not measured | Network round trip. Not measured |
| Offline | No. Local routing to Kiro is still cloud inference | Yes, after the model is on disk | No |
| Privacy | Prompts go to Kiro | Prompts stay on the PC | Prompts go to Alibaba Cloud |
| Limits | About 50 Kiro credits on the free tier | Context must stay at 2,048. One request | 90-day Singapore free quota for eligible models, real-time only. The exact remaining balance was not looked up |
| Terms | Not permitted for this app | Apache 2.0 weights, local run | API key is the documented application credential |
| Reliability | Service is stopped. One upstream, and it can rate-limit | Depends on free RAM and the page file | Depends on the quota and the network |
| Other Windows users | Each person would need OmniRoute, a Kiro login, and the same prohibited hop | Each person installs Ollama and downloads 523 MB. Heavy for an 8 GB PC | Each person creates their own key and turns on Free Quota Only. No shared key |

## 7. Exact next implementation milestone

Do not start it until you approve it.

**M1.6B — direct free-quota Qwen, main process only.**

1. You create a Model Studio general API key and turn on Free Quota Only. You confirm the quota has not expired.
2. The milestone adds `qwen-direct` behind the existing chat IPC. Demo stays the default until you opt in.
3. The key is entered by you into the main process. It is not read from `.omniroute`, not sent to the renderer, and not logged.
4. One model id, one request at a time, short context, cancel on chat close.
5. No OmniRoute client, no Kiro model id, no `auto` fallback, no Ollama install in that milestone.
6. `npm run check` still has to pass. No GitHub push.

If you would rather stay offline, say so and the next approval is the doc 10 Ollama test instead. That replaces M1.6B. It does not run both.

## 8. npm cache cleanup

| Check | Result |
| --- | --- |
| `npm config get cache` | `C:\Users\Usuario\AppData\Local\npm-cache` |
| Size on 2026-10-23 in doc 10 | 8,070 MiB |
| Size remeasured for this note | 8,200 MiB |

`npm cache clean --force` deletes that download cache. It does not remove DesktopCompanion `node_modules`, the git repo, the global OmniRoute install (2,362 MiB under the Roaming npm package directory), Cursor, Claude data, the uv cache, the pip cache, or WSL.

After a clean, the next `npm install` of a package that is not already unpacked in `node_modules` downloads that package again. Installed programs keep running. An install attempted with no network, and with the cache empty, waits until the registry is reachable.

The command is advisable when you want the disk space. It does nothing for RAM, and it is not required for the AI decision. It was not run.

uv cache, pip cache, personal files, Cursor profiles, Claude data, and WSL were left untouched.

No OmniRoute connection, no model download, and no cache deletion until you approve them.
