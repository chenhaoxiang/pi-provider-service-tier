# Latency benchmarking

[User guide](../README.md) · [Development](development.md) · [Provider/evidence limitations](providers.md)

**These commands make real provider calls and may cost money.** Run them only with explicit approval, an eligible provider/API route, and a model/account supporting the selected tier. Offline package checks do not run the benchmark.

## Run profiles

From a prepared checkout with Pi installed:

```bash
npm run bench:service-tier
npm run bench:service-tier:quick
npm run bench:service-tier:stress
npm run bench:service-tier:stress:light
npm run bench:service-tier:swap
```

| Profile | Workload | Pi completions |
| --- | --- | ---: |
| Default | One warmup pair plus three measured pairs. | 8 |
| Quick | One measured pair, no warmup. Useful as a short check, not a firm performance conclusion. | 2 |
| Stress | One warmup pair plus five measured pairs, `high` thinking. | 12 |
| Stress light | Two measured pairs, no warmup, `medium` thinking, shorter memo, 2,500-character minimum. | 4 |
| Swap | Default workload; start the first pair with the tier case rather than baseline. | 8 |

Every npm profile explicitly passes `--model openai/gpt-6.1-sol`; direct script execution uses the same default. Tier defaults to `priority`, thinking to `medium`. Stress light runs baseline → tier, then tier → baseline, balancing execution order with fewer calls. Two pairs are exploratory, not a reliable speed guarantee.

## What is compared

The script loads this checkout in both cases with global extension discovery disabled (`--no-extensions -e <checkout>`). It uses a temporary project to alternate:

- Baseline: a project-local `active: false` override for the model.
- Tier: a project-local active setting for the selected tier.

It reports existing user-global settings; extension startup still follows its normal user-config/support-map behavior. Repair config errors before measuring so the extension does not suspend tier application. The temporary project does not overwrite your current project's settings. Each case starts a fresh in-memory Pi session. The script uses `--offline` to disable automatic catalog network activity, and `--approve` to trust only its owned temporary project for that process. Temporary `.pi/settings.json` disables agent/provider retries and automatic compaction; ordinary model requests still use your configured Pi authentication.

Pairs alternate execution order to reduce time-of-run bias. The standard no-tools prompt requests six 170–220-word sections plus a checklist and a 4,000-character minimum. The light workload requests six 70–90-word sections plus a shorter checklist and a 2,500-character minimum. Both require a `BENCHMARK_COMPLETE` marker; each run includes varying metadata to reduce identical-prompt effects. Workload, scenario, and metadata form one CLI message, with an optional `@file` attachment, so each case requests only one completion rather than separate followups. Custom prompt/file overrides retain their existing precedence.

The script checks provider IDs, explicit provider overrides, model-key overrides, and tier values before launching Pi. Exact API eligibility is still enforced by the extension at runtime. A custom model key must correspond to the selected model; it is not proof of a supported route.

## Read the output

Results include first stdout latency, total process/completion latency, paired deltas, win counts, aggregate comparisons, and raw JSON. Warmup results are excluded from measured summaries.

Positive paired deltas mean the selected tier was faster than baseline. The default practical-improvement threshold is **750 ms or 5%**. It is a heuristic for the sample, not a statistical guarantee.

**Pi 1.1 print mode emits the final assistant text, not streaming token deltas.** First stdout therefore measures final-text emission plus CLI/process effects, not first-token latency. The retained `generationMs` field is the remaining process time after first stdout, not model generation time. Queueing, output length, caching, thinking, traffic, and fallback can change results. Neither faster timing nor successful completion proves that the requested tier reached the server or was served; inspect provider-side evidence separately. Repeat measurements only with approval for the additional cost.

## Common overrides

```bash
PST_BENCH_MODEL=openai-codex/gpt-6.1-sol npm run bench:service-tier
npm run bench:service-tier:quick -- --model openai/gpt-6-sol
PST_BENCH_MODEL=openai/gpt-6-astra PST_BENCH_TIER=ultrafast npm run bench:service-tier
PST_BENCH_ROUNDS=5 PST_BENCH_WARMUPS=1 PST_BENCH_THINKING=high npm run bench:service-tier
PST_BENCH_PROMPT_FILE=./my-benchmark-prompt.md npm run bench:service-tier
PST_BENCH_MIN_CHARS=0 PST_BENCH_PROGRESS_MS=0 npm run bench:service-tier
PST_BENCH_PRACTICAL_DELTA_MS=1000 PST_BENCH_PRACTICAL_DELTA_PCT=10 npm run bench:service-tier
```

Model precedence is `PST_BENCH_MODEL` → last `--model` argument → script default. This preserves existing environment overrides despite the model-pinned npm scripts; `--model=value` is also accepted. Other benchmark arguments fail before launching Pi. Profile-specific inline environment assignments set that profile's rounds/warmups/thinking/workload; use direct script execution for arbitrary combinations.

Ultrafast may be more expensive and unavailable on your account. Legacy Codex is a separate route, not a verified equivalent of the current OpenAI provider.

## Environment reference

| Variable | Default / meaning |
| --- | --- |
| `PST_BENCH_MODEL` | Overrides `--model`; fallback is `openai/gpt-6.1-sol`. Accepts thinking suffixes, including `:max`. |
| `PST_BENCH_PROVIDER` | Empty; required when selecting a bare model ID. |
| `PST_BENCH_MODEL_KEY` | Derived provider/model key with thinking suffix removed; advanced config-key override. |
| `PST_BENCH_TIER` | `priority`; must be one of the package's seven selectable tiers. |
| `PST_BENCH_THINKING` | `medium`; `default` omits the explicit thinking flag. |
| `PST_BENCH_WORKLOAD` | `standard`; `light` uses the shorter memo and lower default character minimum. |
| `PST_BENCH_ROUNDS` | `3` measured pairs. |
| `PST_BENCH_WARMUPS` | `1` warmup pair; `0` disables warmup. |
| `PST_BENCH_START_WITH` | `baseline`; `tier` starts with the tier case. |
| `PST_BENCH_TIMEOUT_MS` | `600000` per Pi process. |
| `PST_BENCH_MIN_CHARS` | `4000` for standard / `2500` for light; `0` disables minimum-output-length validation. |
| `PST_BENCH_PROGRESS_MS` | `15000`; `0` disables progress updates. |
| `PST_BENCH_PRACTICAL_DELTA_MS` | `750`. |
| `PST_BENCH_PRACTICAL_DELTA_PCT` | `5`. |
| `PST_BENCH_PROMPT_FILE` | Optional prompt file; takes precedence over `PST_BENCH_PROMPT`. |
| `PST_BENCH_PROMPT` | Optional custom prompt. Completion-marker validation still applies. |
| `PST_BENCH_PI_BIN` | `pi`; also useful for offline tests with a fake executable. |
| `PST_BENCH_KEEP_TMP` | Set to `1` to retain the temporary workspace for inspection. |

Retained files and raw output can include generated content; review them before sharing. The script removes its temporary workspace by default.
