# Changelog

Notable changes to this package are documented here.

## Unreleased

### Added

- Added session-local GPT Fast mode through `/fast`, `/fast on`, `/fast off`, and `/fast status`.
- Persisted the session override on the active Pi branch and added a bottom status hint with the `/fast` toggle.
- Added a safe fallback that disables Fast for the current session and retries the normal tier when the provider rejects `service_tier`.

- Added the documented OpenAI `ultrafast` service tier and the `fast` alias across config validation, commands, completions, status, and full auto-probe cycles.
- Added a documentation-based, model-specific `presets/openai.json`, with broad Ultrafast support recorded only for GPT-6 Astra and GPT-6.1 Sol.
- Added topic-specific configuration, provider/API, support/probe, development, and benchmarking references under `docs/`, included them in the package, and shortened README to practical user guidance.

### Changed

- Limited Fast-mode behavior to GPT-family models using OpenAI-compatible Responses, Completions, or Codex Responses APIs.
- Pinned Pi AI and coding-agent development references to 1.1.0, regenerated the lockfile, and aligned the Node.js minimum to 22.19.0; Pi-supplied peer dependencies remain `"*"`.
- Replaced the legacy Codex preset with an initial copy of the OpenAI preset's support information, preserving distinct provider/API identities and separately maintained files.
- Removed the bundled `opencode-go` preset and provider-wide tier fallback assumptions without deleting users' saved configuration or support maps.
- Left unlisted/account-dependent tiers unknown instead of treating missing evidence as unsupported; preset metadata and README now distinguish API documentation from live account probes.
- Auto-probes now use Pi's configured model registry for provider routing, authentication, and context normalization, and require a terminal success event before recording support.
- Expanded the latency benchmark into paired warmup/measured runs with alternating order, first-output timing, paired deltas, win counts, practical-threshold interpretation, and quick/stress npm scripts.
- Changed the benchmark default to `openai/gpt-5.5`, validated tier overrides against the shared tier list, and made result labels reflect the selected tier.
- Restricted service-tier features to an explicit provider/API allowlist: OpenAI, legacy Codex, OpenRouter, xAI, and Groq routes. Native Anthropic, Google/Gemini/Vertex, Bedrock, unlisted providers, and mismatched APIs are blocked even with active manual config or saved probe records.
- Disabled package commands/aliases, completions, support prompts, probes, status, and injection on blocked routes. Normal Pi model requests remain available; saved config/map entries are retained and all-model support maintenance skips blocked entries.
- Deferred config/map initialization until an allowed route is selected and stopped in-progress probe cycles from continuing or saving results after their selected target changes.
- Rejected unlisted benchmark providers before starting Pi, documented current native-provider exclusions in README, and expanded TODO with provider-specific restoration work.

### Fixed

- Removed the implicit `priority` default: missing tiers stay off, and invalid explicit tiers/entries disable injection without reviving user tiers through project overrides. Status uses the validated effective tier; fast commands still explicitly select `priority`.
- Cleared stale injection tracking on requests this extension leaves unchanged, preventing unrelated tier errors from corrupting the support map after switching off.
- Distinguished absent project/user config from read, JSON, and whole-schema errors. Errors suspend tier injection/probes without falling back to another scope; existing invalid files, unrelated config, and support records remain untouched by initialization or package commands. Request-time checks re-read config instead of retaining a cached paid tier.
- Cancelled active auto-probes on tier/fast off commands, off toggles, model changes, session shutdown, and manual off/error edits. Cancellation propagates to the SDK stream, stops subsequent tiers, invalidates outstanding support prompts, and prevents partial or late results from being saved; cancellation is isolated per extension instance.
- Kept other confirmed tier knowledge when a user leaves an unlisted tier unknown, and avoided repeatedly prompting for preserved user-marked entries.
- Corrected refresh/probe documentation to disclose that unknown-behavior evaluation can trigger paid probes.

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
