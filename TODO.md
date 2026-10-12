# TODO

## Support the Anthropic provider

Pi provider id is `anthropic` for both OAuth (Claude Pro/Max via `/login`) and API key (`ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`), so keys are `anthropic/<model-id>` either way. API: `anthropic-messages`, `baseUrl: https://api.anthropic.com`.

Upstream: `service_tier` only accepts `auto` and `standard_only`; Priority Tier is closed to new commitments; fast mode uses `speed: "fast"` instead.

- [ ] Add `presets/anthropic.json` with per-model tier knowledge (documented facts only).
- [ ] Map tiers: `standard_only` is not in `SERVICE_TIERS` — record OpenAI-style tiers in `unsupportedTiers`, or extend `SERVICE_TIERS`.
- [ ] Decide: send configured tier as-is (likely errors), or translate `priority` to `speed: "fast"` for this provider.
- [ ] Add unit tests for the preset entries and `anthropic/<model-id>` key resolution.
- [ ] Update README "Provider support" and "Bundled presets".

## Other documented tier-aware providers

- [ ] Consider presets for xAI, Google Gemini API, Google Vertex AI, OpenRouter, AWS Bedrock.
