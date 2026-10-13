# Provider/API reference

[User guide](../README.md) · [Support evidence and limitations](support-and-probes.md#known-evidence-limitations)

Package eligibility means the extension may operate on a route. It does **not** establish model support, account access, authentication compatibility, field delivery, or the tier actually served.

## Route eligibility

The package uses an explicit provider/API allowlist:

| Pi provider ID | Allowed API IDs | Notes |
| --- | --- | --- |
| `openai` | `openai-responses`, `openai-completions` | Model-specific fast/priority, flex, and ultrafast availability. |
| `openai-codex` | `openai-codex-responses` | Separately maintained legacy route; presets are not live backend verification. |
| `openrouter` | `openai-completions`, `openai-responses`, `anthropic-messages` | Routing and fallback may change the served tier. |
| `xai` | `openai-completions`, `openai-responses` | Priority is model/account-dependent. |
| `groq` | `openai-completions` | The package covers `auto`/`flex`; Groq's `on_demand`/`performance` are not selectable yet. |

Unlisted providers, custom provider aliases, mismatched APIs, and missing APIs are blocked. An OpenAI-compatible API name alone does not enable a provider. There is no config override.

When a blocked route is selected:

- All package commands/aliases refuse execution; names can remain visible in Pi, but argument completions are disabled.
- Status is hidden, and support prompts, probes, and tier injection are disabled.
- Config/map initialization is deferred. Stored records are retained; bulk maintenance skips blocked/unresolved-API records.
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

For documented models, OpenAI accepts `fast` as an alias for `priority`. The fast convenience commands retain `priority` for compatibility.

`ultrafast` is a separate, higher-priced tier with separate limits. Broad documentation-based support is recorded only for `gpt-6-astra` and `gpt-6.1-sol`. The Responses reference also mentions access-controlled `gpt-5.6-sol`; its bundled Ultrafast support remains unknown rather than assuming broad access.

HTTP is supported; OpenAI recommends persistent WebSockets for tool-heavy agentic workflows. This extension does not change Pi's transport.

Neither public API documentation nor a preset proves eligibility with Sign in with ChatGPT, a particular API-key account, a custom endpoint, or the legacy Codex backend. `scale` is selectable, but Scale Tier access is never inferred.

## Bundled presets

| Provider/API | File | Basis |
| --- | --- | --- |
| `openai` / `openai-responses` | [`presets/openai.json`](../presets/openai.json) | Model-specific API documentation for 33 model IDs. |
| `openai-codex` / `openai-codex-responses` | [`presets/openai-codex.json`](../presets/openai-codex.json) | Initial copy of the same information, with distinct legacy identities. |

The OpenAI preset was authored first; Codex received an initial copy, not a runtime alias. The files are maintained independently. Their metadata timestamps are documentation updates, not live-call timestamps. Presets do not register unavailable models in Pi.

Documented models receive `default`/`auto`; fast/priority and flex follow model-specific pricing information. Only the two models above receive positive `ultrafast` entries. Unlisted/account-dependent tiers remain unknown, with no provider-wide fallback and no inferred negative decisions.

Bundled lookup is API-filtered: `openai-completions` does not get the Responses preset by default. However, **saved support-map evidence can still be reused across allowed APIs for the same provider/model**; this unresolved limitation is detailed in [support records](support-and-probes.md#known-evidence-limitations).

The removed `opencode-go` preset does not delete historical settings or map records; that provider remains blocked.

## Official references

- OpenAI: [Fast](https://developers.openai.com/api/docs/guides/fast-mode), [Flex](https://developers.openai.com/api/docs/guides/flex-processing), [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode), [pricing](https://developers.openai.com/api/docs/pricing), [Responses reference](https://developers.openai.com/api/reference/resources/responses/methods/create).
- OpenRouter: [Service tiers](https://openrouter.ai/docs/guides/features/service-tiers).
- xAI: [Priority Processing](https://docs.x.ai/developers/advanced-api-usage/priority-processing).
- Groq: [Service tiers](https://console.groq.com/docs/service-tiers).
- Anthropic: [Service tiers](https://platform.claude.com/docs/en/api/service-tiers), [Fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode).
- Google: [Gemini Interactions](https://ai.google.dev/api/interactions-api).
- AWS: [ServiceTier](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ServiceTier.html), [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html).
