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
- Keeps a support map for exact API/auth-scoped status, prompts, and provider error tracking.
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

The maintained release is **0.1.7-fork.4**, based on community **0.1.7**. Fork releases use `<community-version>-fork.<revision>`; the fork revision increases without pretending to be a new upstream release.

- `main`: our maintained integration and release branch, including fork fixes.
- `upstream-main`: an exact mirror of the community's `main`, with no fork commits. Never install from this branch.
- Changes enter `main` through reviewed pull requests; existing branches and history are retained.

Install a reproducible release:

```bash
pi install git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.4
```

[GitHub Releases](https://github.com/chenhaoxiang/pi-provider-service-tier/releases) include the installable package tarball, a provenance manifest, and `SHA256SUMS`. These GitHub releases are not npm publications under the upstream author's namespace. See [release maintenance](docs/releasing.md) for asset installation and future releases.

## Mixed-version safety

From 0.1.7-fork.4, canonical v3 support lives in `pi-provider-service-tier-map-v3.json`. The old `pi-provider-service-tier-map.json` is read once only when the canonical file is absent, and is never rewritten by this version. Old sessions may keep writing their legacy file without erasing new API/auth evidence. No continuous merging or reverse migration is implied. Prefer converging sessions to the current reviewed package at a safe idle point.

Before downgrading package selection, use `node scripts/check-support-map-rollback.mjs <target-map-file> <target-max-schema>`; a v2 target must not be given a v3 legacy-path file. Preserve both stores and post-upgrade data instead of blindly restoring an old settings/map snapshot.

## Quick start and installation

```bash
pi install git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.4
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

Use `pi list` to inspect sources and `pi remove git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.4` to remove this source (add `-l` for project scope). Local checkouts can be installed with `pi install -l .` and removed with `pi remove -l .`. Do not load the same checkout with `-e .` while it is also installed; duplicate commands may result.

For other installation sources, remove the source shown by `pi list`; add `-l` for a project-local installation.

## Provider availability

| Pi provider | What to know |
| --- | --- |
| `openai` | Tier availability varies by model and authentication method. |
| `openai-codex` | Legacy ChatGPT route; do not assume public API-key support applies. |
| `openrouter` | Tier availability and fallback depend on routing. |
| `xai` | Priority availability is model/account-dependent. |
| `groq` | The package currently covers `auto` and `flex`, not every Groq tier. |

Native **Anthropic, Gemini/Vertex, and AWS Bedrock** are currently blocked, as are unlisted providers and unsupported API routes. This only disables the extension's features; normal Pi requests remain usable and saved settings are retained. Models accessed through OpenRouter follow OpenRouter's rules.

There are **no bundled support presets**. Even the same provider/model can accept different `service_tier` values depending on OAuth login, API-key access, or API route. Select values yourself and verify support for your current environment manually or through an explicitly approved Probe. The extension automatically distinguishes Pi-managed OAuth/API-key authentication and keeps their support records separate; old records with no authentication scope remain unclassified, not reused.

At startup, old preset information is removed from the current project's settings, user settings, and support map. Actual removal produces a `[pi-provider-service-tier v<version>]` informational notice identifying the installed extension version and explaining why. Explicit tier choices and manual/Probe records stay; cleanup does not turn tiers off or start probes.

See [provider details](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/providers.md) for exact routes, authentication cautions, and official references.

## Choose a tier and scope

Each tier command applies to the **currently selected provider/model**, not every model.

| Command | Purpose |
| --- | --- |
| `/service-tier-project`, `/service-tier-user` | Open a tier picker with support symbols and a legend. |
| `/service-tier-project <tier>` | Select a tier for this model in this project. |
| `/service-tier-user <tier>` | Select a user-wide default for this model. |
| `/service-tier-project off` | Disable it in this project. |
| `/service-tier-user off` | Disable the user-wide setting. |
| `/service-tier-project status` | Show project and effective settings. |
| `/service-tier-user status` | Show user and effective settings. |
| `/fast-project [on\|off\|status]` | Priority shortcut; no argument toggles it. |
| `/fast-user [on\|off\|status]` | User-wide priority shortcut. |
| `/service-tier-status-format <format\|reset\|status>` | Customize the footer in user settings, or remove its user override. |

`/service-tier-fast-project` and `/service-tier-fast-user` are the full-name equivalents of `/fast-project` and `/fast-user`. Argument completion is available with Tab.

Tier options in `/service-tier-project` and `/service-tier-user` start with `service_tier: `; `off` and `status` do not. The picker distinguishes `✓` Probe-verified, `?` unverified, `↪` fallback, `✕` rejected, and `✎` manual records for the current model/API/authentication mode. **All tiers remain selectable**; symbols describe saved evidence, not a future guarantee. Opening or cancelling does not probe or write settings; choosing a tier follows your existing [support-check policy](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/support-and-probes.md#unknown-support-policy) and may start paid Auto Probe. `○ off` and `ℹ status` are also available.

Selectable values: `priority`, `fast`, `ultrafast`, `flex`, `default`, `auto`, `scale`. **Not every provider/model accepts every value.** `default` and `auto` still request a tier; use `off` to stop this extension adding one.

### Session-local Fast mode

The short `/fast` command is intentionally session-scoped:

```text
/fast          # toggle current session
/fast on       # enable for this session branch
/fast off      # disable for this session branch
/fast status   # show current state
```

`Ctrl+Alt+F` is also registered as a shortcut when the running Pi version supports extension shortcuts. The status bar shows the current GPT model's session state, and the state is stored as a custom session entry. It follows resume, `/tree`, and `/fork` branch history; `/new` starts without a session override and may still inherit persistent settings. The existing `/service-tier-fast-project` and `/service-tier-fast-user` commands remain persistent project/user controls.

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

`ultrafast` is a separate, higher-priced OpenAI tier, not another name for priority. Check [OpenAI's guide](https://developers.openai.com/api/docs/guides/ultrafast-mode), current account/model eligibility, and pricing before enabling it; the extension supplies no preset approval.

## Read the status

Notifications, dialog titles, and command descriptions identify `pi-provider-service-tier`. Routine updates use **Info**, conditions needing attention use **Warning**, and failed requests or operations use **Error**. Choice/argument-completion labels and footer status intentionally stay compact, without the extension name.

| Display | Meaning |
| --- | --- |
| `service_tier ○ off` | No tier is being added by this extension. |
| `service_tier: ⚡ <tier>` | Priority, fast, or ultrafast is enabled. |
| `service_tier: ● <tier>` | Another tier is enabled. |
| `unknown` after a tier | Stored support information is inconclusive; the configured tier is still sent. |
| `service_tier ○ off (config error)` | A settings file needs repair; tier application is suspended. |
| No indicator | This provider/API route is blocked. |

Customize the footer, for example with `/service-tier-status-format {symbol} {tier} | {support}`. The optional `statusFormat` field lives in the existing extension JSON; no default format/file is created at startup. Use `reset` to remove the user override or `status` to inspect it. See [format tokens and file details](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/configuration.md#footer-format).

`manual` means user-maintained support, not a live check. Green `probe-verified` means a prior completed probe reported the expected tier; `probe-completed (tier unknown)` and `probe-fallback→<tier>` are not positive verification. None guarantees future delivery, billing, or speed.

## Support checks and costs

By default, `ask` offers an Auto Probe or a choice to leave unknown support unresolved after relevant commands. **Auto Probe sends low-token requests for provider/API-specific candidates, including paid tiers such as ultrafast on OpenAI; it is not free.** Choosing **Always auto-probe** also enables future cycles after tier/fast commands, even when support is already recorded.

To avoid automatic probes and support prompts:

```text
/service-tier-unknown-behavior leave-unknown
```

The other options are `ask`, `auto-probe`, and `status`. This changes the user-wide support-check policy, not the selected tier.

Tier/fast off commands cancel running probes and stop subsequent probe requests. Already received or processed requests may still be billed. Cancelled or late results are not saved.

Optional support maintenance:

| Commands | Purpose |
| --- | --- |
| `/service-tier-unset-support`, `/service-tier-unset-support-all` | Forget the current API/auth record or all eligible known-auth records. Preserve unclassified history; do not disable tiers or call providers. |

## Troubleshooting

- **Changed authentication:** OAuth/API-key support is separate. A detected mode change warns, refreshes support status, and cancels stale probes/prompts without changing tier settings or starting a Probe. Different accounts/keys within the same mode are not distinguished; re-confirm support or unset it before an explicitly approved fresh Probe.
- **Tier rejected:** use `/service-tier-project off` or select a different tier. Failed requests are not retried automatically; rejection does not turn the configured tier off.
- **No speed improvement:** the provider may ignore the tier or use a fallback. Completion and status alone cannot verify delivery; check provider-side usage/billing information.
- **Config error:** repair the file named in the error notification, or move it aside and retry. The extension preserves broken files rather than replacing them. A missing file allows normal user/project inheritance.
- **Support-map error:** repair or move aside the named map. Support becomes unknown, but healthy explicit tier settings remain active.
- **Unsure whether a tier is sent:** enable `/service-tier-debug on`, make a request, then use `/service-tier-debug off`. This reports the extension's decision, not the server's processing tier.

For file locations, manual settings, and recovery details, see [configuration](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/configuration.md).

## Further reading

- [Provider/API and authentication reference](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/providers.md)
- [Support records, probes, and known limitations](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/support-and-probes.md)
- [Development and offline verification](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/development.md)
- [Latency benchmarking — makes real provider calls](https://github.com/luxmargos/pi-provider-service-tier/blob/main/docs/benchmarking.md)

## License

MIT
