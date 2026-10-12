# TODO

Native Anthropic, Google Gemini/Vertex, and AWS Bedrock are **not currently supported**. Their commands, prompts, probes, status, and config-driven tier injection are blocked. Keep the runtime block in place until the provider-specific work below is implemented and verified; upstream tier documentation or a successful ordinary completion is not enough to enable support.

## Restore native Anthropic support

Pi provider id is `anthropic` for both OAuth (Claude Pro/Max via `/login`) and API key (`ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`), so keys are `anthropic/<model-id>` either way. API: `anthropic-messages`, `baseUrl: https://api.anthropic.com`.

Upstream: `service_tier` only accepts `auto` and `standard_only`; Priority Tier is closed to new commitments; fast mode uses `speed: "fast"` instead.

- [ ] Add provider/API-specific request candidates `auto` and `standard_only`, including config validation, completions, and probe coverage. Do not send the OpenAI tier union to native Messages.
- [ ] Implement the native Messages payload adapter for API-key and OAuth routes, scoped to the resolved request model/provider.
- [ ] Design native `speed: "fast"` as a separate, explicit capability. Do not silently translate a configured `service_tier` into a differently priced `speed` request.
- [ ] Add `presets/anthropic.json` with per-model tier knowledge from documented facts only; keep access-controlled/account-specific support unknown.
- [ ] Inspect `usage.service_tier` and `usage.speed` separately. Response tier names such as `standard`, `priority`, and `batch` are not request enum values.
- [ ] Test native serialization, authentication routing, model IDs, blocked/fallback cases, and restore the allowlist entry and README only after verification.

## Restore Google Gemini and Vertex AI support

Pi provider IDs are `google` and `google-vertex`; APIs are `google-generative-ai` and `google-vertex`. The current Pi adapters use GenerateContent, not Gemini Interactions.

- [ ] Implement GenerateContent SDK `config.serviceTier` injection and verify the serialized request for both Gemini and Vertex. A top-level `service_tier` property is not sufficient.
- [ ] Define API-specific request values and model/account eligibility. GenerateContent's `serviceTier` enum differs from Interactions' `service_tier` enum.
- [ ] If supporting Interactions, add a distinct integration with its documented `standard`, `flex`, `priority`, and `deferred` values; do not apply `deferred` to GenerateContent by assumption.
- [ ] Inspect the served tier via documented response fields/headers and distinguish requested tiers from fallbacks.
- [ ] Add model-specific presets, mocked serialization/probe tests, and guard tests before restoring either provider/API route and updating README.

## Restore AWS Bedrock support

Pi provider ID is `amazon-bedrock`; its API is `bedrock-converse-stream`.

- [ ] Inject the Converse/ConverseStream SDK field `serviceTier: { type: "..." }` rather than top-level `service_tier`, and verify serialization without live calls.
- [ ] If adding InvokeModel support, implement its separate `X-Amzn-Bedrock-Service-Tier` header path instead of reusing the Converse shape.
- [ ] Use Bedrock-specific `default`, `flex`, `priority`, and `reserved` candidates. Reserved capacity and model/account eligibility must not be inferred.
- [ ] Check the served tier, SDK streaming responses, IAM/bearer routing, and unsupported/fallback cases in mocked tests.
- [ ] Add model-specific documentation-based presets and restore the allowlist entry and README only after verification.

## Shared prerequisites for expanding support

- [ ] Separate package eligibility, request acceptance, and evidence that the requested tier was actually applied. SDK/server field stripping must not yield a positive support decision.
- [ ] Use provider/API-specific probe candidates and completeness rules instead of a universal OpenAI-oriented tier cycle.
- [x] Make invalid or missing configured tiers fail closed without an implicit `priority`; normalize invalid overrides to off without reviving lower-scope tiers, preserving model keys, unrelated valid settings, and support records.
- [ ] Match stored support-map provider/model/API evidence to the current route before using it; treat changed API routes as unknown rather than reusing previous support decisions.
- [ ] Keep previously blocked providers' old acceptance-only probe records unknown until they have appropriate evidence when support is restored.
- [ ] Test commands/aliases, completions, prompt gating, manual config, model switching during a prompt/probe, refresh/unset-all, and request routing. Recheck the resolved provider/API before any nested probe request.
- [ ] Keep verification mocked/offline by default. Live model calls, account probes, and paid benchmarks require fresh explicit authorization.

## Other tier-aware routes

- [ ] Consider model-specific presets for allowed xAI, OpenRouter, and Groq routes; consider Groq's missing `on_demand` and `performance` request values without inferring enterprise access.
- [ ] Evaluate other documented providers (for example Databricks) individually, with verified provider IDs, request shapes, tier candidates, and served-tier evidence before adding them to the allowlist.
