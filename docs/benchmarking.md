# Latency benchmarking

[User guide](../README.md) · [Development](development.md) · [Provider/evidence limitations](providers.md) · [Fast-mode research](fast-mode-research.md)

**These commands make real provider calls and may cost money.** Run them only with explicit approval and an eligible provider/API/model/account. Offline package checks do not run a live benchmark. Case counts and timeouts are **not** hard token, billing, or network caps.

## Run profiles

From a prepared checkout with Pi installed:

```bash
npm run bench:service-tier
npm run bench:service-tier:quick
npm run bench:service-tier:stress
npm run bench:service-tier:stress:light
npm run bench:service-tier:swap
```

| Profile | Workload | Planned completions |
| --- | --- | ---: |
| Default | One warmup pair plus three measured pairs. | 8 |
| Quick | One measured pair, no warmup. Exploratory, not a firm performance conclusion. | 2 |
| Stress | One warmup pair plus five measured pairs, `high` thinking. | 12 |
| Stress light | Two measured pairs, no warmup, `medium` thinking, shorter memo, 2,500-character minimum. | 4 |
| Swap | Default workload; start the first pair with the tier case rather than baseline. | 8 |

Every npm profile explicitly passes `--model openai/gpt-6.1-sol`; direct script execution uses the same default. Tier defaults to `priority`, thinking to `medium`. Stress light runs baseline → tier, then tier → baseline. The existing profiles' model, memo workloads, thinking flags, and call budgets are unchanged. Requested thinking is not necessarily the effective Pi level or prepared provider effort; all three are reported separately where observable.

## What is compared

The script loads this checkout through `scripts/benchmark-observer.mjs`, using `--no-extensions -e <observer>` to disable other extensions. The benchmark-only factory registers the normal extension and read-only provider observers in a deliberate order. It is **not** the package's normal Pi entrypoint and must not be loaded independently. The package manifest still loads `src/index.ts`.

An owned temporary project alternates these model-specific settings:

- Baseline: `active: false`, with no prepared `service_tier` field allowed.
- Tier: active with the selected tier; the observer must see that exact prepared field.

The temporary project does not overwrite your current project's settings. It sets `unknownModelBehavior: "leave-unknown"`, disables agent/provider retries and compaction, and stops cache-warming decisions through Pi's public hook. Each case starts a fresh in-memory session with no tools or discovered context/resources. `--offline` disables automatic catalog network, **not** ordinary model traffic. Pi resolves authentication normally; the script neither reads credentials independently nor adds identity/routing headers, changes APIs/transports, or retries another tier.

Existing user-global settings are reported. Normal extension startup can still initialize/migrate settings and support-map files; repair config errors first. The observer does not save benchmark observations as support evidence. Its failure handler runs before the normal configured-request error handler, so a benchmark rejection stops the child without recording that rejection in the support map. Ordinary non-benchmark extension behavior is unchanged.

### Paired prompts and output control

Both conditions receive **identical CLI prompt arguments within each pair**, including scenario and nonce, and use the same temporary working directory. Metadata varies between pairs but no longer contains the condition name. An optional `@file` remains an attachment; all remaining text forms one CLI message rather than multiple followups. Custom file → custom text → built-in workload precedence is preserved. Identical arguments do not freeze attachment files, Pi's time-dependent system context, server cache state, or backend work.

The standard task requests six 170–220-word memo sections plus a checklist and a 4,000-character minimum. Light requests six 70–90-word sections plus a shorter checklist and a 2,500-character minimum. Section/word constraints are prompt instructions, not parser-verified. Both require the exact final `BENCHMARK_COMPLETE` line and normal SDK completion. Short, truncated, malformed, or marker-only responses fail rather than being retried. A 4 MiB stdout bound prevents unbounded capture.

An **opt-in supplementary** fixed-output workload leaves all npm profiles unchanged:

```bash
PST_BENCH_WORKLOAD=fixed node scripts/benchmark-service-tier.mjs --model openai/gpt-6.1-sol
```

It requests integers 1–1000, one per line, followed by the marker. Validation compares the entire sequence after CRLF normalization and outer-whitespace trimming; the built-in character minimum is 3,911. Setting `PST_BENCH_MIN_CHARS=0` does not disable this exact-sequence check. A custom prompt/file replaces the fixed task and uses ordinary marker/minimum validation, identified by `promptSource` and `outputValidation`. Fixed visible text still does not fix reasoning, tokenization, caching, or total backend work, and is not a promise of lower cost.

## Observation and stop rules

The observer uses Pi 1.1.0 public hooks without replacing/mutating payloads, headers, or raw stream events:

| Observation | What it establishes / does not establish |
| --- | --- |
| `before_provider_request` | The payload **after this extension's injection**, not serialized HTTP bytes or server receipt. Records tier, recognized reasoning effort, and an observable output-token cap. |
| Route and runtime metadata | Provider/model/API, configured endpoint **origin only**, metadata-classified auth mode, host Pi version and CLI Node version. Not account/workspace/key identity or an independently observed endpoint. |
| `after_provider_response` | One observed HTTP response callback/status. Not a count of all underlying network attempts. |
| `provider_stream_event` | First nonempty visible text delta and recognized provider-reported tier metadata. Reasoning events and generated claims are not tier/first-text evidence. |
| `message_end` | One normal assistant completion and normalized SDK usage, not actual billed cost. Incomplete terminal metadata or non-normal stop reasons invalidate the case. |

A versioned private sidecar is correlated to each case with a fresh ID; stale files are removed before launch. Success requires one preparation, one 2xx HTTP-response callback, one normal assistant message, the expected route/tier, valid timing metadata, and valid output. Missing/conflicting **tier reports** remain explicitly unavailable/conflicting; they do not invalidate otherwise observed timing or become matching-tier evidence. Missing first-text or usage fields remain unknown rather than zero.

A second preparation terminates the one-shot child **before it can continue to another send**. This uses process termination because Pi reports and swallows hook exceptions; throwing alone would not block a request. Invalid output, missing/inconsistent sidecars, extra response/message counts, timeouts, or changed observed runtime/route/auth-mode/thinking/token-limit context stop the benchmark without replacement cases. Prior successful cases are retained in failure diagnostics, but no successful aggregate is printed. Hookless paths or transports that do not emit an HTTP-response callback also fail rather than being silently measured through a different transport.

The case budget covers warmup and measured cases. Disabled retries/warming and preparation guards reduce accidental extra calls, but public hooks are **not a global wire firewall**: provider-internal attempts or normal credential refresh may not be counted. No hard output cap is invented when one is absent; a prepared token field is not an independently verified token/billing cap. Known auth modes also cannot detect account/key changes within the same mode. A benchmark command is never permission for a future rerun or additional experiment.

## Read the output

Raw JSON uses `schemaVersion: 2`; settings remain v2 and support maps v3. It includes the planned/started/completed case budget, observed preparation count, runtime/request context, per-case observations, workload statistics, and paired analysis. `wireRequestCount` is deliberately `null`. Warmups are retained separately and excluded from measured summaries.

### Timing definitions

| Field | Interval |
| --- | --- |
| `elapsedMs` | Pi process spawn to close: **primary** client-experienced total, including startup/shutdown. |
| `firstStdoutMs` | Spawn to first stdout. **Pi 1.1 print mode emits final assistant text**, not streaming deltas. |
| `postStdoutProcessMs` | Process time remaining after first stdout; `generationMs` is retained only as a deprecated alias. Neither is generation duration. |
| `observation.requestToFirstTextMs` | Request-payload preparation hook to first nonempty provider text delta. Includes observer/client/network/prefill/reasoning effects; **not server TTFT or pure queue time**. |
| `observation.requestToCompletionMs` | Same preparation hook to finalized assistant-message event, before normal extension error handling. Not pure server generation time. |

These clocks come from their respective processes' monotonic timers; the intervals are reported separately, not subtracted as if their endpoints were interchangeable. Observers add some client overhead. Missing streaming text does not fall back to stdout or reasoning timing.

### Paired variability, workload, and interpretation

Positive deltas are baseline minus selected-tier-request time. The report shows each pair, wins/losses/ties, paired mean/median, sample standard deviation, and baseline-first versus tier-first splits. First-streaming-text wins use only pairs with both observations and a separate denominator; they are not interchangeable with total-time wins.

The primary interpretation uses **paired mean total CLI elapsed-time reduction only**. Earlier stdout alone cannot make a slower total-time result pass. Its percentage is the mean paired reduction divided by baseline mean, not the average of pairwise percentages. The default **750 ms or 5%** practical threshold is descriptive, not a significance test.

The 95% paired-mean percentile-bootstrap interval uses 2,000 deterministic resamples and is **exploratory**. It is unavailable with one pair and unstable with a small sample; fewer than ten pairs receive an explicit warning. It assumes representative independent pairs and cannot capture systematic order/load bias or prove causality. Ten pairs are not an adequacy guarantee, and a small-sample p90 often just equals the maximum.

Compare visible-character, output-token, reasoning-token, and cached-input summaries before interpreting timing. `inputTokens` follows Pi normalization (cache reads are subtracted when reported); cached reads/writes are separate, and omitted cache details cannot be recovered. Reasoning tokens, when exposed, are a **subset of output tokens**, not additional tokens to add again. Only counters present in recognized provider usage metadata are taken from the finalized SDK message (`usageSource: "sdk-normalized-with-provider-presence"`). Missing counters are `null`/unavailable, not SDK-initialized zero; an explicitly reported zero remains zero. Longer text does not imply identical generated work; no token-normalized server decoding rate or actual billing is inferred.

Prepared Priority, completion, reported Default, and lower timing can coexist. Neither a matching report nor faster timing independently verifies backend scheduling, entitlement, price, or a future speedup. See [the research's endpoint/auth-specific caveats](fast-mode-research.md). Prior historical measurements are not rerun or retroactively upgraded by this implementation; the changed paired metadata/instrumentation also means old and new timings are not directly interchangeable.

## Common overrides

```bash
PST_BENCH_MODEL=openai-codex/gpt-6.1-sol npm run bench:service-tier
npm run bench:service-tier:quick -- --model openai/gpt-6-sol
PST_BENCH_MODEL=openai/gpt-6-astra PST_BENCH_TIER=ultrafast npm run bench:service-tier
PST_BENCH_ROUNDS=5 PST_BENCH_WARMUPS=1 PST_BENCH_THINKING=high node scripts/benchmark-service-tier.mjs
PST_BENCH_PROMPT_FILE=./my-benchmark-prompt.md npm run bench:service-tier
PST_BENCH_MIN_CHARS=0 PST_BENCH_PROGRESS_MS=0 npm run bench:service-tier
PST_BENCH_PRACTICAL_DELTA_MS=1000 PST_BENCH_PRACTICAL_DELTA_PCT=10 npm run bench:service-tier
```

Model precedence is `PST_BENCH_MODEL` → last `--model` argument → script default; `--model=value` is accepted. Other arguments and malformed numeric/tier/workload/thinking values fail before Pi starts. Exact API eligibility is checked again before request preparation. A custom model key must match the actual selected model, not merely a supported provider. Profile-specific inline assignments set that profile's rounds/warmups/thinking/workload; use direct execution for arbitrary combinations.

Ultrafast may be more expensive and unavailable on your account. The separate Codex route is not a verified equivalent of the current OpenAI provider. This benchmark does not switch routes or select a fallback to make an unsupported measurement succeed.

## Environment reference

| Variable | Default / meaning |
| --- | --- |
| `PST_BENCH_MODEL` | Overrides `--model`; fallback is `openai/gpt-6.1-sol`. Accepts thinking suffixes, including `:max`. |
| `PST_BENCH_PROVIDER` | Empty; required when selecting a bare model ID. |
| `PST_BENCH_MODEL_KEY` | Derived provider/model key with thinking suffix removed; advanced config-key override, still required to match the observed model. |
| `PST_BENCH_TIER` | `priority`; one of the package's seven selectable tiers. |
| `PST_BENCH_THINKING` | `medium`; `default` omits the explicit thinking flag. |
| `PST_BENCH_WORKLOAD` | `standard`; `light` uses the shorter memo; opt-in `fixed` validates the exact numeric sequence. |
| `PST_BENCH_ROUNDS` | `3` measured pairs. |
| `PST_BENCH_WARMUPS` | `1` warmup pair; `0` disables warmup. |
| `PST_BENCH_START_WITH` | `baseline`; `tier` starts with the tier case. |
| `PST_BENCH_TIMEOUT_MS` | `600000` per Pi process; terminate, then force-kill after five seconds if needed. |
| `PST_BENCH_MIN_CHARS` | `4000` standard / `2500` light / `3911` fixed; `0` disables only the length check. |
| `PST_BENCH_PROGRESS_MS` | `15000`; `0` disables progress updates. |
| `PST_BENCH_PRACTICAL_DELTA_MS` | `750`. |
| `PST_BENCH_PRACTICAL_DELTA_PCT` | `5`. |
| `PST_BENCH_PROMPT_FILE` | Optional prompt file; takes precedence over `PST_BENCH_PROMPT`. |
| `PST_BENCH_PROMPT` | Optional custom prompt; final-marker validation still applies. |
| `PST_BENCH_PI_BIN` | `pi`; may select an installed CLI or offline fake executable. Runtime versions are reported, not assumed from this checkout's dependencies. |
| `PST_BENCH_KEEP_TMP` | `1` retains the private temporary workspace for inspection. |

The observer records only allowlisted metadata/counts, not credential values/fingerprints, account IDs, headers, complete prompts/answers, hidden reasoning, or cost estimates. The parent no longer saves stdout/stderr tails; it reports lengths and allowlisted failure reasons. Response text is held in bounded memory only for validation. Temporary files are removed by default; retained directories are private and observation/config files use mode 0600. Review any artifacts before sharing, especially custom attachments or unrelated data managed by Pi itself.

For real-CLI mocks, use fake credentials **and OS-level network denial**. A replaced `fetch` alone is insufficient because CLI initialization can install another implementation. See [offline verification](development.md#offline-checks).
