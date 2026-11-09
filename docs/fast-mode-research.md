# Fast-mode implementation research

[User guide](../README.md) · [Provider/API reference](providers.md) · [Support evidence](support-and-probes.md#known-evidence-limitations) · [Benchmarking](benchmarking.md)

**Research snapshot: 2026-10-15.** This package's comparison baseline is commit [`fccdf74`](https://github.com/luxmargos/pi-provider-service-tier/commit/fccdf74d209d56c4ee3d9c1890e204a8b2703bff), using Pi 1.1.0. This describes that Git checkout, not a claim that all its features were already published to npm under version 0.1.7.

## Scope and evidence levels

The review covered Pi gallery listings, npm metadata, versioned package source, official project/SDK source, issue discussions, and published benchmark records. Third-party extensions and reproduction scripts were **not installed or executed**. No credentials were inspected, accounts/billing checked, or new model requests made for this research.

Keep these evidence levels separate:

- **Implementation inspected:** source shows how a client constructs a request. This does not prove delivery, account eligibility, or actual processing.
- **Provider contract:** official API definitions describe semantics for their stated route; do not transfer them automatically to ChatGPT authentication or another endpoint.
- **Author-reported observation:** a public issue, README, or benchmark describes someone else's result. Reading it is not independent reproduction.
- **Maintainer-run historical observation:** the bounded local comparisons below establish what was sent, reported, and timed in those runs, not backend scheduling or actual charges.

Package versions below are the versions inspected, not promises about future releases. Repository `main`/`master` links are moving references. Some anonymous GitHub API requests hit rate limits, so repository HEAD commits were not pinned; failed/404/challenge responses were not used as implementation evidence. This is a focused comparison, not an exhaustive compatibility or security audit.

## Pi package comparison

Most reviewed Fast extensions ultimately send the same request field as this package's fast commands:

```json
{ "service_tier": "priority" }
```

| Package / inspected version | Fast request mechanism | Difference from this package |
| --- | --- | --- |
| [`pi-openai-fast-mode` 0.5.0](https://pi.dev/packages/pi-openai-fast-mode) | A [payload helper](https://unpkg.com/pi-openai-fast-mode@0.5.0/src/payload.ts) injects Priority through `before_provider_request` for configured OpenAI/OpenAI-Codex model pairs. | `/fast`, `--fast`, and an allowlist-based indicator. Its [target refresh](https://unpkg.com/pi-openai-fast-mode@0.5.0/src/config.ts) preserves `enabled` but replaces its own targets with package defaults. We removed bundled presets and preserve explicit choices. |
| [`pi-gpt-fast-mode` 0.1.2](https://pi.dev/packages/pi-gpt-fast-mode) | Its [payload helper](https://unpkg.com/pi-gpt-fast-mode@0.1.2/src/payload.ts) adds the selected `priority`, `flex`, `default`, or `auto` tier. | [Environment handoff](https://unpkg.com/pi-gpt-fast-mode@0.1.2/src/handoff.ts) passes the preference to new child processes through `PI_OPENAI_FAST_DESIRED`; this is not a different server-side Fast mechanism. |
| [`pi-openai-fast` 1.0.1](https://pi.dev/packages/pi-openai-fast) | A [service-tier injector](https://unpkg.com/pi-openai-fast@1.0.1/src/service-tier-injector.ts) copies an active request payload and adds Priority. | Session-oriented toggle, optional persistence, footer controls, and subagent handoff. A child still needs the extension loaded and a supported model. |
| [`pi-gpt-service-tier` 0.1.0](https://pi.dev/packages/pi-gpt-service-tier) | The [entrypoint](https://unpkg.com/pi-gpt-service-tier@0.1.0/extensions/index.ts) adds Priority to `openai-responses` requests. | Session-persisted toggle. Off removes an existing `service_tier` field; our off/no-op path does not strip fields supplied by Pi or another extension. |
| [`pi-openai-service-tier` 0.1.4](https://pi.dev/packages/pi-openai-service-tier) | The [entrypoint](https://unpkg.com/pi-openai-service-tier@0.1.4/index.ts) wraps provider calls and passes the native SDK option `serviceTier`. | Aims to integrate Pi-side cost estimates as well as request serialization. Uses default model lists and API-specific tier restrictions. Its execution compatibility with Pi 1.1.0 was not tested here. |
| [`@pixelsnis/pi-codex-fast-mode` 0.1.3](https://pi.dev/packages/@pixelsnis/pi-codex-fast-mode) | The [provider wrapper](https://unpkg.com/@pixelsnis/pi-codex-fast-mode@0.1.3/index.ts) creates local `-fast` aliases, restores the base model ID before sending, and adds Priority. | Model-picker convenience, not a separate upstream Fast model. It would be inaccurate to say it necessarily sends an invented model ID. We leave the model catalog and selected ID unchanged. |
| [`pi-better-openai` 0.1.22](https://pi.dev/packages/pi-better-openai) | Its [Fast controller](https://unpkg.com/pi-better-openai@0.1.22/src/fast-controller.ts) adds Priority for configured models. | Broader usage/footer/pet/image features; the inspected Fast transmission path is still payload injection. |
| [`@tunnckocore/pi-gpt-fast-mode` 0.4.0](https://github.com/tunnckoCore/pi-gpt-fast-mode) | The [entrypoint](https://unpkg.com/@tunnckocore/pi-gpt-fast-mode@0.4.0/src/index.ts) checks model conditions and copies the payload with Priority. | Toggle, shortcut, and configuration UX rather than a distinct processing-tier protocol. |

Our additional responsibilities are eligible provider/API guards, explicit provider/model-scoped activation, known-auth-scoped support history, and separation of request completion from reported-tier evidence. These are not stronger scheduling signals. Unknown/rejected support does not turn off a healthy explicit setting, and our footer is not a live monitor of every response's actual processing tier. See [runtime design](development.md#runtime-design) and [support semantics](support-and-probes.md#activation-and-status).

### Native options and cost estimates

`pi-openai-service-tier` identifies a useful integration question: injecting a JSON field and setting Pi's native `serviceTier` option are not necessarily equivalent for client-side accounting.

In the inspected Pi 1.1.0 SDK:

- [`openai-responses-shared.js`](https://unpkg.com/@earendil-works/pi-ai@1.1.0/dist/api/openai-responses-shared.js) uses the response tier, falling back to the native request option when metadata is absent, unless a route-specific resolver is supplied.
- [`openai-codex-responses.js`](https://unpkg.com/@earendil-works/pi-ai@1.1.0/dist/api/openai-codex-responses.js) has a resolver that uses a requested native `priority`/`flex` option for cost estimation even when the response reports `default`.

Therefore, native option forwarding can affect estimates in particular routes/metadata conditions. It does **not** follow that every payload-only request has an incorrect displayed cost. Neither strategy independently verifies API charges or ChatGPT credit consumption. Our extension currently does not set Pi's native cost option or replace provider implementations; adopting a wrapper would require separate Pi 1.1.0 integration and coexistence checks.

## Codex routing-header implementation

The Git-installable [`vcode11/pi-codex-fast-mode`](https://github.com/vcode11/pi-codex-fast-mode) adds a second signal on the official Codex route. Its scoped Pi gallery detail lookup returned 404 during this review, so it is not presented as a verified gallery/npm listing.

| Request route | Inspected signals |
| --- | --- |
| OpenAI Responses at `https://api.openai.com/v1` | Payload `service_tier: "priority"`. |
| Codex Responses at `https://chatgpt.com/backend-api` | Same payload plus `x-codex-routing-hint: model=<id>;tier=priority`. |
| Other providers/APIs/custom endpoints | Left untouched by its route checks. |

See the [extension source](https://github.com/vcode11/pi-codex-fast-mode/blob/main/extensions/codex-fast-mode.ts). The header is not invented by the extension: [official Codex client source](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs) constructs the same model/tier hint for Codex backend requests, with additional route exclusions. Neither source establishes that this header is sufficient or universally necessary for Fast.

### Published timing evidence

The author's [2026-08-11 JSONL results](https://github.com/vcode11/pi-codex-fast-mode/blob/main/bench/results-2026-08-11.jsonl) were parsed, not rerun:

| Author's metric | Baseline median | Fast-request median |
| --- | ---: | ---: |
| Streaming time | 36.062 s | 24.040 s |
| Full-turn time | 37.923 s | 25.999 s |

There are three runs per condition, each recording 3,892 output characters. The full-turn ratio is about 1.46×. These are the author's metric definitions, not automatically the same as our CLI process timings or server TTFT.

The records contain timing, character counts, and usage, but **no terminal served-tier field**. They support a reported latency difference, not independent proof of internal Priority processing or billing. The README separately claims a 2026-09-17 Astra API smoke reported `fast`; the inspected JSONL is not that smoke's raw evidence, so that claim remains an author report.

## Implementations outside Codex CLI

### OpenAI API and Vercel AI SDK

The [official OpenAI Responses type](https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response.py) describes `service_tier=priority` or `fast` as API Fast opt-in. It describes the response tier as the processing mode actually used, which may differ from the request. This is an API contract, not proof that a particular account/model accepts either literal value on a ChatGPT route.

[Vercel AI SDK documentation](https://ai-sdk.dev/providers/ai-sdk-providers/openai) exposes `providerOptions.openai.serviceTier`. Its [Responses implementation](https://github.com/vercel/ai/blob/main/packages/openai/src/responses/openai-responses-language-model.ts) serializes that option as `service_tier` and exposes response metadata as `providerMetadata.openai.serviceTier`. It also includes capability-based warnings/removal for some unsupported choices. No Codex CLI process is required by this mechanism; actual application remains account/model/route-dependent.

### OpenClaw embedded runtime

[OpenClaw's advanced OpenAI documentation](https://docs.openclaw.ai/providers/openai/advanced) maps `/fast on` / `params.fastMode` to `service_tier=priority` in its embedded runtime. Examples specifying `agentRuntime.id: "openclaw"` distinguish this direct-provider path from OpenClaw selecting a native Codex harness. Not every OpenClaw Fast invocation should therefore be counted as a non-Codex implementation.

The documentation also describes auto cutoffs, temporary requested/reported-tier observations, and some explicit-rejection recovery through Ultrafast → Fast → Standard with cooldowns. Our extension does not automatically downgrade the selected tier or retry a failed configured request. OpenClaw's documented Ultrafast implementation is not evidence that Ultrafast works on the account used for our historical tests.

### OpenCode: request confirmation without a guaranteed speedup

[OpenCode issue #39864](https://github.com/anomalyco/opencode/issues/39864) reports actual Priority serialization for ChatGPT-authenticated Fast model entries but little throughput difference from Standard. The author reports a same-account Codex CLI control about 1.47× faster in Fast mode.

This is a detailed user report, not proof that all OpenCode releases/accounts fail. Some core-source path lookups returned 404, so this review does not claim to have verified the entire current OpenCode implementation. The issue is useful evidence against equating a Fast model label or accepted Priority request with confirmed Fast performance.

### Python/curl reproduction and client identification

[`Tarquinen/codex-fast-tier-repro`](https://github.com/Tarquinen/codex-fast-tier-repro) provides a [README](https://github.com/Tarquinen/codex-fast-tier-repro/blob/master/README.md) and [Python/curl script](https://github.com/Tarquinen/codex-fast-tier-repro/blob/master/benchmark.py) calling the ChatGPT Codex backend without running Codex CLI.

The author reports roughly 56 tok/s with OpenCode-style identification versus 85 tok/s with a Codex-style `originator` and `User-Agent`, keeping Priority requested. The README attributes the difference to client identification and says the routing hint itself was not decisive.

These are author-reported measurements and causal interpretations. The four-condition public script and README example are not independent repeated-trial verification, proof of internal worker pools, or a sanctioned third-party protocol guarantee. The routing-hint claim also cautions against treating that header alone as a universal fix. No token copying, auth-file inspection, header-identity experiment, or script execution was performed here; client impersonation is not implemented by this package.

## Interpreting default with ChatGPT authentication

On 2026-03-10, Codex contributor `pash-openai` [responded to and closed issue #14204](https://github.com/openai/codex/issues/14204#issuecomment-4033184620), explaining that Fast is handled by server-side Codex routing in ChatGPT-authenticated mode and that the final response tier is not a reliable end-to-end indicator in that context:

> seeing `response.service_tier = "default"` does not mean Fast was ignored.

This is a Codex-side explanation, not merely another user's hypothesis. The issue concerned ChatGPT-authenticated Codex/WebSocket behavior; it is not a replacement for the general OpenAI API response contract or a guarantee for every endpoint, client version, transport, or account.

For this extension, `probe-fallback→default` describes an **observed request/report mismatch**, not independently established scheduling fallback. The caveat does not turn mismatches into `probe-verified`, imply unsupported tiers, change explicit settings, or establish billing. Matching metadata is still the package's existing historical evidence criterion, not independent backend verification.

## Historical observations in this checkout

The following previously authorized comparisons ran on 2026-10-15 using Pi 1.1.0, `openai/gpt-6.1-sol`, `openai-responses`, and `https://api.openai.com/v1/responses`. Each case used a fresh Pi session; baseline omitted the tier field and the other condition requested Priority. An external one-off observer checked actual serialized fields and terminal metadata; this is more instrumentation than the benchmark script's ordinary timing output.

| Profile | Completed requests, including warmup | Measured pairs | Thinking / workload | Baseline mean CLI time | Priority-request mean CLI time | Priority-request total-time wins |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| Stress light | 4; no warmup | 2 | Medium / light | 34.192 s | 32.388 s | 1/2 |
| Stress | 12; one warmup pair | 5 | High / standard | 69.299 s | 50.535 s | 5/5 |

The light mean was about 5.3% shorter but inconsistent between pairs. The stress mean was about 27.1% shorter, with the difference observed in both execution orders. The different workloads do not form a controlled comparison *between* profiles.

All 16 completed requests across these two runs reported final `default`; all eight Priority-condition requests serialized Priority. There were no retries or saved support-map observations. Streaming first-text observations were separate from CLI completion time: stress favored Priority in 4/5 first-text pairs, not 5/5. [Pi print-mode first stdout is not TTFT](benchmarking.md#read-the-output).

Important limits:

- Preflight found stored credential type `oauth` but effective auth mode `unknown`. The stored type alone does not conclusively classify actual request authentication.
- Our endpoint was `api.openai.com/v1/responses`, not the `chatgpt.com/backend-api/codex/responses` endpoint in the Codex reproductions. The Codex explanation/header policy cannot be transferred automatically.
- Generated output/reasoning amounts, prompt metadata, load, batching, and client effects differed or remained uncontrolled. Five measured pairs do not establish causality, universal speed, or future behavior.
- A shorter Priority-request time and a final Default report can both be faithfully recorded without deciding the backend cause. Neither alone proves Fast application or lack of practical effect.
- These are summarized maintainer observations. Raw per-request audit artifacts are not included in this package; the timing script alone does not independently reproduce the tier instrumentation. No actual charges or usage multipliers were verified.
- These completed authorizations do not permit reruns. This documentation adds no new live tests, account checks, or Ultrafast verification.

## Follow-up considerations, not implemented changes

1. Preserve explicit activation, non-mutating/no-op payload behavior, scoped history, and separation of completion, metadata, timing, and billing.
2. Use the Codex explanation when documenting OAuth metadata limitations, without broadening it to every OpenAI route or promoting mismatches to positive evidence.
3. Consider native `serviceTier` forwarding only through a separately reviewed Pi 1.1.0 integration; do not describe client estimates as verified charges.
4. If routing hints are considered, constrain them to the relevant official Codex backend and do not present them as entitlement or performance guarantees. Do not silently introduce client-identity spoofing, credential extraction, automatic retries, or new paid experiments.

This research changes no supported routes, tier choices, evidence schema, activation rules, provider wrappers, headers, or authentication handling. See the current [provider contract](providers.md) and [Probe lifecycle](support-and-probes.md#probe-lifecycle) for runtime behavior.
