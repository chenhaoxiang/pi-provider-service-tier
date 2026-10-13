# pi-provider-service-tier

[![npm version](https://img.shields.io/npm/v/pi-provider-service-tier.svg)](https://www.npmjs.com/package/pi-provider-service-tier)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Node.js >= 22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org/)
[![Pi extension](https://img.shields.io/badge/Pi-extension-purple.svg)](https://github.com/luxmargos/pi-provider-service-tier)

A Pi extension that lets you choose an API `service_tier` per provider/model.

Use it when you want to turn on faster or paid priority tiers for one model without changing your prompts, tools, selected model, or the rest of your Pi setup. Whether a tier changes anything depends on the provider behind the model; see [Provider support](#provider-support).

## What it does

- Adds a top-level `service_tier` field to outgoing provider request payloads.
- Scopes settings to the current `provider/model` pair.
- Supports project-local settings and user-global defaults.
- Provides simple `/service-tier-fast-*` commands for `service_tier: "priority"`.
- Keeps a support map for status, prompts, preset refreshes, and provider error tracking.
- Shows a bottom status indicator for the current service-tier setting.
- Detects unsupported tier errors and updates the support map.

The extension only injects `service_tier` when all of these are true:

1. the current provider/API route is on this package's allowlist,
2. the current `provider/model` pair is active in the effective config,
3. a service tier is configured for that pair, and
4. the outgoing provider payload is an object that can receive `service_tier`.

For an allowed provider/API route, the support map does not block request-time injection. If you explicitly enable a tier for the current provider/model, the extension sends it from `before_provider_request` whenever the outgoing provider payload is an object. The provider/API allowlist takes precedence over every setting and support-map entry: a blocked route never receives this extension's injection, even with manually edited `active: true` config or an old successful probe record. Provider errors are recorded afterward and the failed request is not retried automatically.

> [!NOTE]
> This extension injects the provider payload field `service_tier`. For Pi's built-in OpenAI providers, Pi also has an internal `serviceTier` stream option used for cost accounting. This extension is intentionally broader and payload-hook based, so it does not adjust Pi's internal cost multiplier.

## Provider support

### Allowed provider/API routes

This package uses a fail-closed allowlist. Only the following declared provider/API combinations can use its commands, prompts, auto-probes, status, and request injection. An OpenAI-compatible API name alone does not enable an unlisted provider. Eligibility is not a guarantee that a particular tier works with your model, account, authentication method, or custom endpoint.

| Pi provider ID | Allowed API | Tier documentation / limitations |
| --- | --- | --- |
| `openai` | `openai-responses`, `openai-completions` | Model-specific `priority`/`fast`, `flex`, and `ultrafast` availability. [Fast](https://developers.openai.com/api/docs/guides/fast-mode) · [Flex](https://developers.openai.com/api/docs/guides/flex-processing) · [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) |
| `openai-codex` | `openai-codex-responses` | Legacy route retained separately. Its preset is documentation-based, not a live backend verification. |
| `openrouter` | `openai-completions`, `openai-responses`, `anthropic-messages` | Top-level `service_tier` is documented for these routes. Routing and fallback can change the tier actually served. [Service tiers](https://openrouter.ai/docs/guides/features/service-tiers) |
| `xai` | `openai-completions`, `openai-responses` | Priority processing is model/account-dependent; inspect the served tier. [Priority Processing](https://docs.x.ai/developers/advanced-api-usage/priority-processing) |
| `groq` | `openai-completions` | This package can select `auto` and `flex`. Groq's `on_demand` and `performance` values are not yet in this package's tier list. [Service tiers](https://console.groq.com/docs/service-tiers) |

On allowed routes, the extension only injects the `service_tier` field. A successful completion alone does not prove that the field reached the server or that the requested tier was applied. Check the provider's returned tier or documented response headers before drawing billing or latency conclusions. Auto-probe currently uses completion/error results and does not verify the served tier.

### Not currently supported: Bedrock, Gemini, and Anthropic

**Native AWS Bedrock, Google Gemini/Vertex, and Anthropic providers are not supported by this package.** Their upstream tier features do not make the current generic injection correct.

| Blocked Pi provider ID | Why support is deferred |
| --- | --- |
| `amazon-bedrock` | Pi uses Bedrock Converse, which requires `serviceTier: { type: "..." }`, not top-level `service_tier`. InvokeModel uses a header instead. Bedrock also has `reserved`. [ServiceTier](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ServiceTier.html) |
| `google`, `google-vertex` | Pi's GenerateContent adapters require SDK `config.serviceTier`, not top-level `service_tier`. Gemini Interactions uses a different request schema, including `standard` and `deferred`. [Interactions](https://ai.google.dev/api/interactions-api) |
| `anthropic` | Native Messages accepts `auto` and `standard_only`; native fast mode uses the separate `speed` parameter. The current shared tier list and convenience commands do not implement that contract. [Service tiers](https://platform.claude.com/docs/en/api/service-tiers) · [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) |

Every other unlisted provider or mismatched API is also blocked, including custom provider aliases. Anthropic or Gemini models routed through an allowed OpenRouter API are governed by **OpenRouter's** tier contract, not the blocked native provider contract.

When a blocked route is selected:

- All 12 package commands, including aliases, global settings, support maintenance, and debug commands, refuse execution with an explanation. Command names may remain visible in Pi, but package argument completions are disabled.
- No unknown-support prompts or auto-probe requests are started, and the service-tier status is hidden. An in-progress probe cycle stops before its next request if the selection changes away from its target, without saving partial results.
- Existing project/user config and support-map entries are retained but cannot enable tier injection. Refresh-all and unset-all skip blocked route entries.
- Startup does not create or migrate this package's config/map files until an allowed route is selected. Normal Pi model requests remain available; this block applies only to this extension and does not rewrite payload fields supplied by Pi or other extensions.

Provider-specific adapters, tier candidates, and verification needed to restore native support are tracked in [`TODO.md`](https://github.com/luxmargos/pi-provider-service-tier/blob/main/TODO.md). There is no config override for the provider/API block.

## Prerequisites

- Pi `>=1.1.0` installed and available as `pi` (development references are pinned to `1.1.0`).
- Node.js `>=22.19.0`, matching Pi 1.1.0's minimum.
- `git`, if installing directly from GitHub.
- A provider/API route on this package's allowlist, plus a model/account supporting the selected tier. See [Provider support](#provider-support); native Bedrock, Gemini/Vertex, and Anthropic are currently blocked.

## Quick start

Install the package, reload Pi, then enable priority mode for the current provider/model.

```bash
pi install npm:pi-provider-service-tier
```

Inside Pi:

```text
/reload
/service-tier-fast-project on
/service-tier-fast-project status
```

Use `pi install -l npm:pi-provider-service-tier` instead if you want a project-local install rather than a user-global install.

## Installation details

### Install from npm

Install globally for your Pi user settings:

```bash
pi install npm:pi-provider-service-tier
```

Or install only for the current project:

```bash
pi install -l npm:pi-provider-service-tier
```

Restart Pi, or run `/reload` inside Pi after installing.

### Install from GitHub

Install globally for your Pi user settings:

```bash
pi install git:github.com/luxmargos/pi-provider-service-tier
```

Or install only for the current project:

```bash
pi install -l git:github.com/luxmargos/pi-provider-service-tier
```

### Clone locally

```bash
git clone https://github.com/luxmargos/pi-provider-service-tier.git
cd pi-provider-service-tier
npm install
```

Load it temporarily for one Pi run:

```bash
pi -e .
```

Or install the local checkout for the current project:

```bash
pi install -l .
```

Restart Pi or run `/reload`, then enable a tier:

```text
/service-tier-project priority
```

### Verify or remove

List installed Pi packages:

```bash
pi list
```

Remove the user-global npm install:

```bash
pi remove npm:pi-provider-service-tier
```

Remove the project-local npm install:

```bash
pi remove -l npm:pi-provider-service-tier
```

Remove the user-global GitHub install:

```bash
pi remove git:github.com/luxmargos/pi-provider-service-tier
```

Remove the project-local GitHub install:

```bash
pi remove -l git:github.com/luxmargos/pi-provider-service-tier
```

Remove the project-local local checkout install:

```bash
pi remove -l .
```

> [!TIP]
> Do not load the same checkout with `pi -e .` while it is also installed with `pi install -l .`. Pi may load duplicate commands with numeric suffixes.

## Common usage

### Fast mode

Fast mode is a convenience wrapper for enabling `service_tier: "priority"` for the current provider/model. OpenAI now also accepts `service_tier: "fast"` as an alias for supported models; these convenience commands keep sending `priority` for backward compatibility.

| Command | Scope | Description |
| --- | --- | --- |
| `/service-tier-fast-project` | Current project | Toggle priority tier for the current provider/model. |
| `/service-tier-fast-project on` | Current project | Enable priority tier. |
| `/service-tier-fast-project off` | Current project | Disable this extension for the current provider/model in this project. |
| `/service-tier-fast-project status` | Current project | Show the current project setting. |
| `/service-tier-fast-user` | User-global | Toggle priority tier for the current provider/model. |
| `/service-tier-fast-user on` | User-global | Enable priority tier as a user default. |
| `/service-tier-fast-user off` | User-global | Disable the user-global setting for the current provider/model. |
| `/service-tier-fast-user status` | User-global | Show the current user-global setting. |

The older `/fast-project` and `/fast-user` commands remain available as aliases.

### Explicit service tiers

Use these commands when you want a tier other than `priority`.

| Command | Scope | Arguments |
| --- | --- | --- |
| `/service-tier-project <tier>` | Current project | `priority`, `flex`, `default`, `auto`, `scale`, `fast`, `ultrafast`, `off`, `status` |
| `/service-tier-user <tier>` | User-global | `priority`, `flex`, `default`, `auto`, `scale`, `fast`, `ultrafast`, `off`, `status` |

Examples:

```text
/service-tier-project flex
/service-tier-project fast
/service-tier-project ultrafast
/service-tier-project off
/service-tier-user priority
/service-tier-user status
```

Commands apply only to the current provider/model pair. Argument completions are available; type a command plus a space, then press Tab.

#### OpenAI Ultrafast availability

`ultrafast` is a real OpenAI `service_tier` value, not a synonym for `priority` or `fast`. The current [Ultrafast guide](https://developers.openai.com/api/docs/guides/ultrafast-mode) and [pricing table](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast) document broad API availability for `gpt-6-astra` and `gpt-6.1-sol`. Select one of those models before enabling it. HTTP is supported, and OpenAI recommends persistent WebSockets for tool-heavy agentic workflows. This extension does not change Pi's transport.

The [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create) also mentions access-controlled `gpt-5.6-sol` support, while the current broad-availability guide lists the two newer models. The bundled presets conservatively leave `gpt-5.6-sol` Ultrafast support unknown. API documentation does not prove availability on a particular account, with Sign in with ChatGPT, or through the legacy Codex backend.

Ultrafast has separate rate limits and higher pricing. Preset support is documentation-based, not a live account probe or a guarantee of speed. Explicit configuration still sends the tier even when support is unknown.

### Status indicator

The extension keeps a bottom floating status visible for the current model:

- `service_tier ○ off` when this extension is inactive for the current provider/model.
- `service_tier: ⚡ <tier>` when `priority`, `fast`, or `ultrafast` is active.
- `service_tier: ● <tier>` for other active tiers.
- `unknown` is appended when the active tier is not recorded as supported in the support map.
- The indicator is hidden entirely for blocked provider/API routes, even if saved config is active.

The status omits provider/model text because Pi already shows the selected provider and model. Supported active tiers are shown in green unless `NO_COLOR` is set.

### Refresh or unset support

```text
/service-tier-refresh-support
/service-tier-refresh-support-all
/service-tier-unset-support
/service-tier-unset-support-all
```

- `/service-tier-refresh-support` refreshes preset support for the current provider/model.
- `/service-tier-refresh-support-all` refreshes preset support for allowed provider/API routes returned by Pi's model registry, skipping blocked routes.
- `/service-tier-unset-support` removes the current allowed provider/model from the support map, making support unknown.
- `/service-tier-unset-support-all` clears entries for allowed provider/API routes; blocked or unresolved-API records are preserved.

Refresh commands copy preset information first. If a tier is active, they also evaluate the configured unknown behavior, which can prompt for or start paid probes. The preset copy itself does not call providers. Unset commands do not call providers or mark models unsupported.

Tier and fast commands preserve `source: "probe"` map entries when the requested tier is already recorded in `tiers` or `unsupportedTiers`. Use refresh commands when you intentionally want to replace support data from bundled presets.

### Unknown behavior

```text
/service-tier-unknown-behavior ask
/service-tier-unknown-behavior auto-probe
/service-tier-unknown-behavior leave-unknown
/service-tier-unknown-behavior status
```

`ask` is the default. When an explicit tier, fast, or refresh command selects a tier whose stored support is unknown, Pi prompts with:

- `Auto-probe once`
- `Always auto-probe`
- `Leave unknown once`
- `Always leave unknown`

`auto-probe` starts a full probe cycle after explicit tier/fast commands and refresh commands with an active tier, even if that tier is preset-supported. `leave-unknown` leaves unknown support unresolved without prompting. The command writes user-global config. Request-time injection still follows the active configured tier.

In `ask` mode, a tier absent from both `tiers` and confirmed `unsupportedTiers` is unknown, even when other tiers are determined. Entries marked `source: "user-mark"` do not prompt again while preserved. Leaving one tier unknown does not discard other confirmed tier knowledge.

The `ask` prompt shows a separate warning line that auto-probe sends low-token probe requests for every known service tier and may consume provider tokens.

`Auto-probe once` and `Always auto-probe` start low-token current-model probes for all seven service tiers (including `fast` and `ultrafast`) in the background and show progress notifications while provider results arrive. Probes use Pi's configured model registry for provider routing, authentication, and context normalization. Requests sent while probing is in progress are not queued by this extension; they use the current active configuration and current stored support state. A completed probe cycle writes one `source: "probe"` map entry with complete `tiers` and `unsupportedTiers`. If any tier cannot be determined, the support map is not overwritten with partial probe results. Failed probes are not retried. Successful completion is currently treated as a support result; it does not prove that the tier field was delivered or establish the actual processing tier, latency, or billing.

Tier/fast `off` commands (including fast toggles that turn off) cancel an already-running probe cycle: the extension stops the remaining tiers, signals abort to the current SDK stream, and does not save cancelled or late results. Model changes and session shutdown also cancel the cycle. Probe guards re-read config during the cycle, so manual off edits or whole-file config errors also stop it without a reload. Cancellation is best-effort at the provider boundary: requests already received or processed by the server may still incur charges. Turning on again can start a new cycle under the configured unknown-support policy; the cancelled cycle cannot resume.

### Debug injection decisions

```text
/service-tier-debug on
/service-tier-debug off
/service-tier-debug status
```

Debug mode is session-local. When enabled, the extension notifies whether each provider request was injected with `service_tier` or skipped.

## Configuration files

This package uses `pi-provider-service-tier` for package and config-file identity.

Project config:

```text
.pi/extensions/pi-provider-service-tier.json
```

User-global config:

```text
~/.pi/agent/extensions/pi-provider-service-tier.json
```

Global support map:

```text
~/.pi/agent/extensions/pi-provider-service-tier-map.json
```

Project and user configs are merged:

- user config provides defaults,
- project config overrides fields for the same provider/model key,
- provider/model entries that exist only in user config still apply in projects unless overridden.

If you previously used an older local package name, move or copy any existing `pi-service-tier*.json` files to the filenames above.

## Config schema

Example:

```json
{
  "version": 2,
  "unknownModelBehavior": "ask",
  "entries": {
    "openai/gpt-5.5": {
      "active": true,
      "serviceTier": "priority"
    },
    "openai/gpt-6-astra": {
      "active": false,
      "serviceTier": "ultrafast"
    }
  }
}
```

An entry is effective only when `active` is `true` and the merged config contains a valid `serviceTier`. There is **no implicit `priority` default**: if neither scope supplies a valid tier, the effective state is off and this extension adds no `service_tier` property. Partial project entries can still inherit a valid tier explicitly configured in user config.

An explicitly invalid `serviceTier` (including `"off"`, `null`, or the wrong JSON type) disables that scope's entry instead of falling back to a user tier. Malformed per-model entries or explicit non-boolean `active` values are also treated as inactive. Config migrations and subsequent writes normalize such invalid entries to off, retaining their model keys and unrelated valid settings. Use `active: false` to disable a tier; `/fast-*` commands explicitly select `priority` when enabled. Config is re-read before each provider request and by ongoing probe guards, rather than trusting a cached active tier.

A **missing** config file allows normal inheritance. An **unreadable file, invalid JSON, or invalid whole-file schema** in either scope suspends this extension's tier injection and probes for the project, even if the other scope explicitly enables a tier. Whole-file errors include non-object roots/`entries`, unsupported schema versions, and invalid unknown-behavior values. The status shows `service_tier ○ off (config error)` and commands/request checks report the affected path without logging file contents. Existing files are not reset to defaults, and startup migration and package command writes are deferred until both scopes are healthy. Normal Pi requests remain usable and payload fields supplied elsewhere are not removed. Repair the file manually or move it aside, then retry; changing a tier with a package command does not overwrite a broken file.

`unknownModelBehavior` is optional and defaults to `ask`. Valid values are `ask`, `auto-probe`, and `leave-unknown`. Use `/service-tier-unknown-behavior [ask|auto-probe|leave-unknown|status]` to manage the user-global setting, or set it manually in either config file. Project config overrides user config for this field.

When an allowed provider/API route is first selected in a session, existing config and support-map files are migrated one schema version at a time before the extension refreshes eligible stored non-probe entries from bundled presets. If startup selects a blocked route, this initialization is deferred. Read paths tolerate older files. Stored blocked-provider entries are not deleted and do not override the runtime block.

## Support map schema

Example:

```json
{
  "version": 2,
  "entries": {
    "openai/gpt-5.5": {
      "provider": "openai",
      "id": "gpt-5.5",
      "api": "openai-responses",
      "determined": true,
      "tiers": ["priority", "flex", "default", "auto", "fast"],
      "source": "preset",
      "updatedAt": "2026-10-12T04:33:41Z"
    }
  }
}
```

`determined: true` enables the recorded tier decisions; it does not imply that every newly added or unlisted tier is unsupported. `tiers` lists positive knowledge and `unsupportedTiers` lists explicit negative knowledge. A tier absent from both remains unknown. A completed auto-probe covers every currently known tier. `source` is `preset` for bundled preset refreshes, `probe` for auto-probe results, `error` for provider errors observed during normal requests, `user-mark` for user choices to leave support unknown, and `manual` for manual map edits.

### Bundled presets

| Provider/API | File | Support information |
| --- | --- | --- |
| `openai` + `openai-responses` | `presets/openai.json` | Model-specific API documentation for 33 model IDs, including GPT-5.6, GPT-6, and GPT-6.1. |
| `openai-codex` + `openai-codex-responses` | `presets/openai-codex.json` | Initial copy of the same information, with legacy provider/API identities preserved. |

`openai` is the current Pi provider, supporting API-key and Sign in with ChatGPT authentication. `openai-codex` is legacy. The primary OpenAI preset was created first, then copied into the separate Codex file; neither file aliases the other at runtime. They can be maintained independently after this initial copy. Presets do not register models or make unavailable models appear in Pi.

Both presets record `default`/`auto` for documented models, `priority`/`fast` where the [Fast pricing table](https://developers.openai.com/api/docs/pricing?latest-pricing=fast) lists support, and `flex` where the [Flex pricing table](https://developers.openai.com/api/docs/pricing?latest-pricing=flex) lists support. Only `gpt-6-astra` and `gpt-6.1-sol` receive a positive `ultrafast` decision. `scale` remains selectable, but account/model-specific Scale Tier eligibility is not assumed. Source URLs and limitations are recorded in each preset.

There are no provider-wide preset fallback assumptions. Unlisted models and tiers on an allowed route remain unknown; custom `openai` + `openai-completions` models do not inherit Responses preset knowledge. Unlisted providers and mismatched APIs are blocked outright, rather than treated as probe candidates. The bundled `opencode-go` preset was removed; its saved settings and support-map entries remain stored but are now blocked. Support maintenance commands skip blocked route records.

API documentation does not guarantee support with ChatGPT subscription authentication or the legacy backend. The legacy copy is not a newly probed Codex support matrix. Unsupported provider errors are recorded in the map for troubleshooting and future status, but they do not disable an active configured tier by themselves.

## Unsupported tier errors

If a provider returns an error indicating `service_tier` is unsupported or invalid, the extension:

1. removes that tier from the map entry for the current provider/model,
2. records it in `unsupportedTiers`,
3. notifies the user, and
4. does **not** retry the failed request.

On allowed provider/API routes, future requests still follow the active project/user configuration. Disable or change the configured tier if you do not want the extension to send it again. Blocked routes never receive this extension's injection, regardless of saved config or recorded support.

This error-based detection only catches providers that reject the field. Providers that silently ignore `service_tier` never produce an error, so the support map and status can report such a tier as accepted even though the provider does not act on it; see [Provider support](#provider-support).

## Development

```bash
git clone https://github.com/luxmargos/pi-provider-service-tier.git
cd pi-provider-service-tier
npm install
npm run check
```

Local smoke test:

```bash
pi -e . --provider openai --model gpt-5.5
```

Real latency comparison against Pi and your provider account:

```bash
npm run bench:service-tier       # paired benchmark: 1 warmup pair + 3 measured pairs
npm run bench:service-tier:quick # old-style short check: 1 measured pair, no warmup
npm run bench:service-tier:stress
npm run bench:service-tier:swap  # run priority before baseline in the first pair
```

The benchmark loads this checkout for every run with global extension discovery disabled, then compares paired Pi `--print` completions with the project setting off against completions with `service_tier: "priority"` on. It alternates pair order to reduce time-of-run bias, records both first-output latency and total completion latency, prints paired deltas/win counts, and classifies whether the observed difference clears a practical threshold. It also inspects the user-global service-tier config and reports whether the target model already has priority enabled globally; the baseline still writes a project-local `active:false` override before Pi starts. It defaults to `openai/gpt-5.5` and a no-tools prompt sized to make elapsed time measurable. This makes real provider calls and may cost money.

The benchmark rejects unlisted provider IDs before starting Pi. The extension's API guard still applies at runtime; benchmark only an allowed provider/API route with confirmed tier behavior.

Useful overrides:

```bash
PST_BENCH_MODEL=openai-codex/gpt-5.5 npm run bench:service-tier # legacy provider
PST_BENCH_MODEL=openai/gpt-6-astra PST_BENCH_TIER=ultrafast npm run bench:service-tier # higher-cost tier
PST_BENCH_START_WITH=tier npm run bench:service-tier
PST_BENCH_ROUNDS=5 PST_BENCH_WARMUPS=1 PST_BENCH_THINKING=high npm run bench:service-tier
PST_BENCH_PROMPT_FILE=./my-benchmark-prompt.md npm run bench:service-tier
PST_BENCH_MIN_CHARS=0 npm run bench:service-tier # disable minimum-output validation
PST_BENCH_PROGRESS_MS=0 npm run bench:service-tier # disable per-run progress updates
PST_BENCH_PRACTICAL_DELTA_MS=1000 PST_BENCH_PRACTICAL_DELTA_PCT=10 npm run bench:service-tier
PST_BENCH_TIER=default npm run bench:service-tier
```

`npm run check` runs TypeScript type checking, mocked Node tests (no paid provider calls), and `npm pack --dry-run` to verify the published package contents. Development uses `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` at exactly `1.1.0`; their peer dependencies remain `"*"` because Pi supplies them at runtime, following Pi's package conventions.

## License

MIT
