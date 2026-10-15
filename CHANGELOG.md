# Changelog

Notable changes to this package are documented here.

## Unreleased

### Added

- Added the documented OpenAI `ultrafast` service tier and the `fast` alias across config validation, commands, completions, status, and full auto-probe cycles.
- Added topic-specific configuration, provider/API, support/probe, development, and benchmarking references under `docs/`, included them in the package, and shortened README to practical user guidance.

### Changed

- Match TUI notification severity to the outcome: informational preset retirement and approved Probe lifecycle updates, warnings for incomplete checks or a selected tier being rejected, and errors for actual configured-request failures. Keep authentication cautions and all activation/Probe approval behavior unchanged.
- Identify `pi-provider-service-tier` in non-footer TUI notifications, errors, dialog titles, command descriptions, argument-completion labels, and optional-backup warnings. Preserve the versioned preset-removal notice and leave compact footer/status/probe-progress text unchanged.
- Pinned Pi AI and coding-agent development references to 1.1.0, regenerated the lockfile, and aligned the Node.js minimum to 22.19.0; Pi-supplied peer dependencies remain `"*"`.
- Removed the entire bundled preset system, provider-wide support assumptions, automatic seeding/startup refresh, and `/service-tier-refresh-support` / `/service-tier-refresh-support-all`. Users select tiers and maintain support information manually or through explicitly approved Auto Probe.
- At startup, retire preset metadata from both settings scopes and preset-only/documented support from the shared map, including old blocked-provider presets and mixed records. Notify only after actual removal with `[pi-provider-service-tier v<version>]` using the installed package version, the provider/OAuth/API rationale, and manual/Probe guidance; explicit tier choices, unrelated settings, and manual/prepared Probe evidence remain.
- Warn that identical provider/model identities can have different `service_tier` support under OAuth, API-key access, or different APIs. Support records now use independent provider/model/API/OAuth-or-API-key slots while explicit activation settings remain unchanged. Old API-only records move to unclassified `auth.unknown` without assigning a login; their manual/Probe history is retained, not reused as current support. Detected auth-mode changes warn and invalidate stale probes/prompts, caches, and error tracking, without starting new probes. Account/key changes within one mode still require user confirmation.
- Auto-probes now use Pi's configured model registry for provider routing, authentication, and context normalization. Positive verification requires both a prepared tier and matching provider-reported processing-tier metadata after terminal SDK completion.
- Migrated support maps forward to v3 with independent provider/model/API records at the existing filename; settings remain v2. Partial historical metadata is normalized, unclassified data is preserved, and safe replacement/optional original-byte backups avoid unnecessary upgrade failures. Downgrade compatibility is not implemented.
- Added provider/API-specific probe candidates and per-tier manual/legacy/verified/rejected evidence plus completion-only/fallback observations. Status distinguishes user-maintained support from prior probe verification, and missing served-tier metadata remains unverified.
- Expanded the latency benchmark into paired warmup/measured runs with alternating order, first-output timing, paired deltas, win counts, practical-threshold interpretation, and quick/stress npm scripts.
- Changed the benchmark default to `openai/gpt-5.5`, validated tier overrides against the shared tier list, and made result labels reflect the selected tier.
- Restricted service-tier features to an explicit provider/API allowlist: OpenAI, legacy Codex, OpenRouter, xAI, and Groq routes. Native Anthropic, Google/Gemini/Vertex, Bedrock, unlisted providers, and mismatched APIs are blocked even with active manual config or saved probe records.
- Disabled package commands/aliases, completions, support prompts, probes, status, and injection on blocked routes. Normal Pi model requests remain available; saved settings and non-preset map entries are retained and all-model support maintenance skips blocked entries. Preset retirement scans existing files even on blocked routes.
- Deferred config/map initialization until an allowed route is selected and stopped in-progress probe cycles from continuing or saving results after their selected target changes.
- Rejected unlisted benchmark providers before starting Pi, documented current native-provider exclusions in README, and expanded TODO with provider-specific restoration work.

### Fixed

- Removed the implicit `priority` default: missing tiers stay off, and invalid explicit tiers/entries disable injection without reviving user tiers through project overrides. Status uses the validated effective tier; fast commands still explicitly select `priority`.
- Cleared stale injection tracking on requests this extension leaves unchanged, preventing unrelated tier errors from corrupting the support map after switching off.
- Distinguished absent project/user config from read, JSON, and whole-schema errors. Errors suspend tier injection/probes without falling back to another scope; existing invalid files, unrelated config, and support records remain untouched by initialization or package commands. Request-time checks re-read config instead of retaining a cached paid tier.
- Cancelled active auto-probes on tier/fast off commands, off toggles, model changes, session shutdown, and manual off/error edits. Cancellation propagates to the SDK stream, stops subsequent tiers, invalidates outstanding support prompts, and prevents partial or late results from being saved; cancellation is isolated per extension instance.
- Kept other confirmed tier knowledge when a user leaves an unlisted tier unknown, and avoided repeatedly prompting for preserved user-marked entries.
- Prevented stored support, prompt suppression, maintenance, and request errors from crossing APIs for the same provider/model. Historical acceptance-only probes are retained without being promoted to applied-tier verification; map errors preserve data without disabling healthy explicit settings.
- Corrected tier-command/Probe documentation to disclose paid unknown-behavior evaluation; startup cleanup and support unsetting do not probe.

## [0.1.7] - 2026-06-29

### Added

- Added service-tier v2 config and support-map handling with determined support entries, probe results, user-marked unknown entries, and startup migration.
- Added support refresh and unset commands for current-model and all-model support-map maintenance.
- Added user-global unknown-behavior controls with `ask`, `auto-probe`, and `leave-unknown` modes.
- Added background auto-probe progress updates and prompt text that warns about possible provider token use.
- Added request-injection debug notifications for troubleshooting.
- Added a latency benchmark script for comparing baseline requests with service-tier requests.

### Changed

- Request-time injection now follows the active project/user configuration even when support-map knowledge is unknown or negative.
- Auto-probe now checks every known service tier in one cycle and writes one complete `source: "probe"` entry only when every tier is determined.
- Unknown-behavior option names were clarified from the older aggressive/unknown wording to `auto-probe` and `leave-unknown`.
- Floating status text now omits provider/model details, keeps status visible when off, and uses simple off/priority/active indicators.
- README guidance now reflects the current commands, config schema, support-map behavior, and request-time injection behavior.

### Fixed

- Preserved completed probe entries when explicit tier or fast commands target tiers already known in `tiers` or `unsupportedTiers`.
- Avoided overwriting support maps with partial auto-probe results when any tier remains unknown.
- Kept auto-probe work in the background so user requests continue using the current active configuration.
- Recorded provider service-tier errors without retrying failed requests.

## [0.1.6] - 2026-05-26

### Changed

- Renamed the npm package to the unscoped `pi-provider-service-tier` package identity.
- Updated package metadata for the `0.1.6` release.

[0.1.7]: https://github.com/luxmargos/pi-provider-service-tier/compare/0.1.6...0.1.7
[0.1.6]: https://github.com/luxmargos/pi-provider-service-tier/compare/0.1.5...0.1.6
