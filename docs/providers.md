# Provider/API reference

[User guide](../README.md) · [Support evidence and limitations](support-and-probes.md#known-evidence-limitations)

Package eligibility means the extension may operate on a route. It does **not** establish model support, account access, authentication compatibility, field delivery, or the tier actually served.

## Route eligibility

The package uses an explicit provider/API allowlist:

| Pi provider ID | Allowed API IDs | Notes |
| --- | --- | --- |
| `openai` | `openai-responses`, `openai-completions` | Model-specific fast/priority, flex, and ultrafast availability. |
| `openai-codex` | `openai-codex-responses` | Legacy ChatGPT route; public API-key documentation does not establish OAuth support. |
| `openrouter` | `openai-completions`, `openai-responses`, `anthropic-messages` | Routing and fallback may change the served tier. |
| `xai` | `openai-completions`, `openai-responses` | Priority is model/account-dependent. |
| `groq` | `openai-completions` | The package covers `auto`/`flex`; Groq's `on_demand`/`performance` are not selectable yet. |

Unlisted providers, custom provider aliases, mismatched APIs, and missing APIs are blocked. An OpenAI-compatible API name alone does not enable a provider. There is no config override.

When a blocked route is selected:

- All package commands/aliases refuse execution; names can remain visible in Pi, but argument completions are disabled.
- Status is hidden, and support prompts, probes, and tier injection are disabled.
- Default-file initialization is deferred. Stored settings and non-preset records are retained; bulk maintenance skips blocked/unresolved-API records. Startup retirement of old preset data still runs.
- A running probe is cancelled when its selected model/API changes, without saving partial results.

This does not block ordinary Pi requests or strip fields supplied by Pi/other extensions. Anthropic or Gemini models served through an allowed OpenRouter route follow OpenRouter's contract, not the native provider's contract.

## Why native routes remain blocked

| Pi provider/API | Required distinction |
| --- | --- |
| `anthropic` / `anthropic-messages` | Native Messages request tiers are `auto` and `standard_only`. Fast mode uses separate `speed: "fast"`; response labels such as `standard`, `priority`, and `batch` are not request enums. |
| `google` / `google-generative-ai` | GenerateContent's SDK field is `config.serviceTier`, not a generic top-level `service_tier`. |
| `google-vertex` / `google-vertex` | Vertex needs independently verified serialization and model/account eligibility. |
| Gemini Interactions | A distinct schema with values including `standard` and `deferred`; do not transfer its enum to GenerateContent by assumption. |
| `amazon-bedrock` / `bedrock-converse-stream` | Converse uses `serviceTier: { type: "..." }`. InvokeModel uses a separate header. Provider-specific candidates include `reserved`. |

Restoring these routes requires adapters, provider/API-specific probe candidates, serialization tests, and served-tier evidence—not just additional strings in the shared tier list. Implementation work is tracked in [TODO](https://github.com/luxmargos/pi-provider-service-tier/blob/main/TODO.md).

## OpenAI fast and ultrafast

The public OpenAI API documents `fast` as an alias for `priority` on applicable models. This does not establish acceptance of the literal `fast` value on ChatGPT OAuth or legacy Codex routes. Codex's logical Fast mode uses request `priority`; the extension's fast convenience commands also explicitly choose `priority`, without claiming it will actually be applied.

`ultrafast` is a separate, higher-priced tier with separate limits. The public API guide describes GPT-6 Astra and GPT-6.1 Sol; model, plan, workspace, and authentication eligibility still need checking for your environment. No bundled record marks these models as supported.

HTTP is supported; OpenAI recommends persistent WebSockets for tool-heavy agentic workflows. This extension does not change Pi's transport.

Public API documentation does not prove eligibility with Sign in with ChatGPT, a particular API-key account, a custom endpoint, or the legacy Codex backend. `scale` is selectable, but Scale Tier access is never inferred.

## User-managed support and authentication

There are no bundled presets, provider-wide support defaults, or refresh-from-preset commands. Configure the desired tier yourself; maintain manual support records or explicitly approve Auto Probe to inspect the current environment.

The same provider/model can accept different `service_tier` values with OAuth versus API-key access, different accounts/plans, or a different API. In Pi 1.1.0, even `openai` can use either public API-key access or ChatGPT OAuth; provider identity and compatible syntax do not prove the authentication contract.

Saved support is provider/model/API-scoped, **not authentication-scoped**. After changing login, key, endpoint, or API, confirm applicability yourself. Use `/service-tier-unset-support` to forget the selected API's old evidence before choosing a fresh, potentially paid Probe. An accepted/completed request without matching served-tier metadata is not proof of application.

Startup removes former preset information from current user/project settings and the shared map, including obsolete blocked-provider presets. Explicit tier settings and manual/Probe records survive. An actual removal is announced by `[pi-provider-service-tier]` with the reason and verification guidance. See [configuration migration](configuration.md#migration-and-file-io) and [support records](support-and-probes.md#support-map-schema).

## Official references

- OpenAI: [Fast](https://developers.openai.com/api/docs/guides/fast-mode), [Flex](https://developers.openai.com/api/docs/guides/flex-processing), [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode), [pricing](https://developers.openai.com/api/docs/pricing), [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create).
- OpenRouter: [Service tiers](https://openrouter.ai/docs/guides/features/service-tiers).
- xAI: [Priority Processing](https://docs.x.ai/developers/advanced-api-usage/priority-processing).
- Groq: [Service tiers](https://console.groq.com/docs/service-tiers).
- Anthropic: [Service tiers](https://platform.claude.com/docs/en/api/service-tiers), [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode).
- Google: [Gemini Interactions](https://ai.google.dev/api/interactions-api).
- AWS: [ServiceTier](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ServiceTier.html), [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html).
