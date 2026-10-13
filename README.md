# pi-provider-service-tier

English | [中文](README.zh-CN.md)

[![Fork release](https://img.shields.io/github/v/release/chenhaoxiang/pi-provider-service-tier)](https://github.com/chenhaoxiang/pi-provider-service-tier/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Node.js >= 22.19](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org/)
[![Pi extension](https://img.shields.io/badge/Pi-extension-purple.svg)](https://github.com/chenhaoxiang/pi-provider-service-tier)

Maintained fork of [luxmargos/pi-provider-service-tier](https://github.com/luxmargos/pi-provider-service-tier), retaining the session-local GPT Fast mode.

Choose a provider's processing tier for individual models in Pi, with project-specific settings or user-wide defaults. Your prompts, tools, and selected model stay unchanged.

Use it when you want to turn on faster or paid priority tiers for one model without changing your prompts, tools, selected model, or the rest of your Pi setup.

## What it does

- Adds a top-level `service_tier` field to outgoing provider request payloads.
- Scopes settings to the current `provider/model` pair.
- Supports project-local settings and user-global defaults.
- Provides simple `/service-tier-fast-*` commands for `service_tier: "priority"`.
- Keeps a support map for status, prompts, preset refreshes, and provider error tracking.
- Shows a bottom status indicator for the current service-tier setting.
- Adds a session-local GPT Fast mode (`/fast`) that follows the active session branch instead of changing project/user config.
- Supports OpenAI-compatible `openai-responses`, `openai-completions`, and built-in `openai-codex-responses` request shapes for GPT-family models.
- Detects unsupported tier errors, falls back to the normal tier for the current session, and updates the support map.

The extension only injects `service_tier` when all of these are true:

1. the current `provider/model` pair is active in the effective config,
2. a service tier is configured for that pair, and
3. the outgoing provider payload is an object that can receive `service_tier`.

The support map does not block request-time injection. If you explicitly enable a tier for the current provider/model, the extension sends it from `before_provider_request` whenever the outgoing provider payload is an object. Provider errors are recorded afterward and the failed request is not retried automatically.

> [!NOTE]
> This extension injects the provider payload field `service_tier`. For Pi's built-in OpenAI providers, Pi also has an internal `serviceTier` stream option used for cost accounting. This extension is intentionally broader and payload-hook based, so it does not adjust Pi's internal cost multiplier.

## Prerequisites

- Pi installed and available as `pi`.
- Node.js `>=22`.
- `git`, if installing directly from GitHub.
- A provider/model that supports `service_tier` if you want injected requests to succeed.
**Paid tiers can cost more, and faster responses are not guaranteed.** Availability depends on your provider, model, and account; a green status or successful probe does not confirm the tier actually served.

## Releases and branch policy

The maintained release is **0.1.7-fork.2**, based on community **0.1.7**. Fork releases use `<community-version>-fork.<revision>`; the fork revision increases without pretending to be a new upstream release.

- `main`: our maintained integration and release branch, including fork fixes.
- `upstream-main`: an exact mirror of the community's `main`, with no fork commits. Never install from this branch.
- Changes enter `main` through reviewed pull requests; existing branches and history are retained.

Install a reproducible release:

```bash
pi install git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.2
```

[GitHub Releases](https://github.com/chenhaoxiang/pi-provider-service-tier/releases) include the installable package tarball, a provenance manifest, and `SHA256SUMS`. These GitHub releases are not npm publications under the upstream author's namespace. See [release maintenance](docs/releasing.md) for asset installation and future releases.

## Quick start and installation

```bash
pi install git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.2
```

Add `-l` for a project-local install. Use `@main` only to track the moving maintained branch. The upstream npm package is a separate release line and does not necessarily contain our Fast-mode changes.

Restart Pi or `/reload`, then use `/fast on` for the current GPT session, or the persistent `/service-tier-fast-project on` / `/service-tier-fast-user on` controls described below.

For local development:

```bash
git clone https://github.com/chenhaoxiang/pi-provider-service-tier.git
cd pi-provider-service-tier
npm ci --ignore-scripts
pi -e .
```

Use `pi list` to inspect sources and `pi remove git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.2` to remove this source (add `-l` for project scope). Local checkouts can be installed with `pi install -l .` and removed with `pi remove -l .`. Do not load the same checkout with `-e .` while it is also installed; duplicate commands may result.

Selectable values: `priority`, `fast`, `ultrafast`, `flex`, `default`, `auto`, `scale`. **Not every provider/model accepts every value.** `default` and `auto` still request a tier; use `off` to stop this extension adding one.

### Session-local Fast mode

The short `/fast` command is intentionally session-scoped:

```text
/fast          # toggle current session
/fast on       # enable for this session branch
/fast off      # disable for this session branch
/fast status   # show current state
```

`Ctrl+Alt+F` is also registered as a shortcut when the running Pi version supports extension shortcuts. The status bar shows the current GPT model's session state, and the state is stored as a custom session entry. It follows resume, `/tree`, and `/fork` branch history; `/new` starts with Fast disabled. The existing `/service-tier-fast-project` and `/service-tier-fast-user` commands remain persistent project/user controls.

Session-local Fast is limited to model IDs beginning with `gpt` and these API shapes:

- `openai-responses`
- `openai-completions`
- `openai-codex-responses`

Other models, including Kimi, DeepSeek, Claude, Gemini, and non-GPT aliases, are left unchanged. Custom provider IDs such as `codex-local` are supported as long as Pi exposes the model through one of the API shapes above; the extension does not require the provider ID to be `openai`.

When the provider rejects `service_tier`, the extension records a session-local fallback to the normal tier and requests one continuation without the failed assistant entry on Pi versions that support the boundary API. It does not switch models or change reasoning settings. A server that silently ignores the field is treated as a normal successful request; the status only indicates that Fast was requested, not that the upstream scheduler accepted it.

Fast mode is a convenience wrapper for enabling `service_tier: "priority"` for the current GPT provider/model.

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
| `/service-tier-project <tier>` | Current project | `priority`, `flex`, `default`, `auto`, `scale`, `off`, `status` |
| `/service-tier-user <tier>` | User-global | `priority`, `flex`, `default`, `auto`, `scale`, `off`, `status` |

Examples:

```text
/service-tier-project flex
/service-tier-user priority
```

`ultrafast` is a separate, higher-priced OpenAI tier, not another name for priority. The bundled documentation records it for `gpt-6-astra` and `gpt-6.1-sol`; account access is still not guaranteed. Check [OpenAI's guide](https://developers.openai.com/api/docs/guides/ultrafast-mode) and pricing before enabling it.

## Read the status

| Display | Meaning |
| --- | --- |
| `service_tier ○ off` | No tier is being added by this extension. |
| `service_tier: ⚡ <tier>` | Priority, fast, or ultrafast is enabled. |
| `service_tier: ● <tier>` | Another tier is enabled. |
| `unknown` after a tier | Stored support information is inconclusive; the configured tier is still sent. |
| `service_tier ○ off (config error)` | A settings file needs repair; tier application is suspended. |
| No indicator | This provider/API route is blocked. |

Green means there is stored support information, **not verified speed, billing, or actual tier delivery**.

## Support checks and costs

By default, `ask` offers an Auto Probe or a choice to leave unknown support unresolved after relevant commands. **Auto Probe sends low-token requests for all seven tiers, including paid tiers such as ultrafast; it is not free.** Choosing **Always auto-probe** also enables future cycles after tier/fast commands and refresh commands with an active tier, even when support is already recorded.

To avoid automatic probes and support prompts:

```text
/service-tier-unknown-behavior leave-unknown
```

The other options are `ask`, `auto-probe`, and `status`. This changes the user-wide support-check policy, not the selected tier.

Tier/fast off commands cancel running probes and stop subsequent probe requests. Already received or processed requests may still be billed. Cancelled or late results are not saved.

Optional support maintenance:

| Commands | Purpose |
| --- | --- |
| `/service-tier-refresh-support`, `/service-tier-refresh-support-all` | Reload bundled support information for the current/all eligible models. **May prompt or start paid probes** when a tier is active. |
| `/service-tier-unset-support`, `/service-tier-unset-support-all` | Forget stored support information for the current/all eligible models. Does not disable the tier or call providers. |

## Troubleshooting

- **Tier rejected:** use `/service-tier-project off` or select a different tier. Failed requests are not retried automatically; rejection does not turn the configured tier off.
- **No speed improvement:** the provider may ignore the tier or use a fallback. Completion and status alone cannot verify delivery; check provider-side usage/billing information.
- **Config error:** repair the file named in the warning, or move it aside and retry. The extension preserves broken files rather than replacing them. A missing file allows normal user/project inheritance.
- **Unsure whether a tier is sent:** enable `/service-tier-debug on`, make a request, then use `/service-tier-debug off`. This reports the extension's decision, not the server's processing tier.

For file locations, manual settings, and recovery details, see [configuration](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/configuration.md).

## Further reading

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
    "openai/gpt-4.1": {
      "active": false,
      "serviceTier": "flex"
    }
  }
}
```

`unknownModelBehavior` is optional and defaults to `ask`. Valid values are `ask`, `auto-probe`, and `leave-unknown`. Use `/service-tier-unknown-behavior [ask|auto-probe|leave-unknown|status]` to manage the user-global setting, or set it manually in either config file. Project config overrides user config for this field.

On extension startup, existing config and support-map files are migrated one schema version at a time before the extension refreshes stored non-probe entries from bundled presets. Read paths tolerate older files, but the persisted migration rewrite happens during startup.

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
      "updatedAt": "2026-05-19T00:00:00.000Z"
    }
  }
}
```

`determined` means the entry has a complete stored support decision from presets or a completed auto-probe. `source` is `preset` for bundled preset refreshes, `probe` for auto-probe results, `error` for provider errors observed during normal requests, `user-mark` for user choices to leave support unknown, and `manual` for manual map edits.

Preset support currently includes:

| Provider/API | Models | Tiers |
| --- | --- | --- |
| `openai` + `openai-responses` | only IDs listed in `presets/openai.json` | model-specific documented tiers; `ultrafast` is listed only for `gpt-6-astra` and `gpt-6.1-sol` |
| `openai-codex` + `openai-codex-responses` | only IDs listed in `presets/openai-codex.json` | separate legacy-route copy, not live account verification |

There is no provider-wide preset fallback. Unlisted model/API pairs stay unknown. The old `opencode-go` preset has been removed and that provider is blocked for persistent tier controls and probes; saved files are retained. See [provider and preset details](docs/providers.md#bundled-presets).

Other providers/models remain unknown unless refreshed from presets or updated by a completed auto-probe result. Unsupported provider errors are recorded in the map for troubleshooting and future status, but they do not disable an active configured tier by themselves.

## Unsupported tier errors

If a provider returns an error indicating `service_tier` is unsupported or invalid, the extension:

1. removes that tier from the map entry for the current provider/model,
2. records it in `unsupportedTiers`,
3. notifies the user, and
4. does **not** retry the failed request.

Future requests still follow the active project/user configuration. Disable or change the configured tier if you do not want the extension to send it again.

## Development

```bash
git clone https://github.com/chenhaoxiang/pi-provider-service-tier.git
cd pi-provider-service-tier
npm ci --ignore-scripts
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

Useful overrides:

```bash
PST_BENCH_MODEL=openai-codex/gpt-5.5 npm run bench:service-tier
PST_BENCH_START_WITH=tier npm run bench:service-tier
PST_BENCH_ROUNDS=5 PST_BENCH_WARMUPS=1 PST_BENCH_THINKING=high npm run bench:service-tier
PST_BENCH_PROMPT_FILE=./my-benchmark-prompt.md npm run bench:service-tier
PST_BENCH_MIN_CHARS=0 npm run bench:service-tier # disable minimum-output validation
PST_BENCH_PROGRESS_MS=0 npm run bench:service-tier # disable per-run progress updates
PST_BENCH_PRACTICAL_DELTA_MS=1000 PST_BENCH_PRACTICAL_DELTA_PCT=10 npm run bench:service-tier
PST_BENCH_TIER=default npm run bench:service-tier
```

`npm run check` runs TypeScript type checking, Node tests, and `npm pack --dry-run` to verify the published package contents.
- [Provider/API reference and presets](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/providers.md)
- [Support records, probes, and known limitations](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/support-and-probes.md)
- [Development and offline verification](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/development.md)
- [Latency benchmarking — makes real provider calls](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/benchmarking.md)

## License

MIT
