# Support records and Auto Probe

[User guide](../README.md) · [Configuration](configuration.md) · [Provider/API reference](providers.md)

Three separate questions must not be confused:

1. **Eligibility:** does this package allow the provider/API route?
2. **Stored support:** what do documentation, probes, and errors say about the tier?
3. **Actual application:** did the server receive and serve the requested tier?

The current support map addresses the second question, with the evidence limitations below. It is not a billing or latency guarantee.

## Activation and status

On an allowed route with healthy config, an explicitly active valid tier is injected even if support is unknown or recorded as rejected. The map does not disable a tier; provider/API and config-error guards do.

Green means stored positive knowledge. `unknown` includes missing knowledge and tiers not recorded as supported; it does not mean the extension withheld the configured tier. The package does not change Pi's internal `serviceTier` cost multiplier, so Pi's displayed cost is not confirmation of provider billing.

## Support-map schema

Current schema version: `2`. The map is user-global and keyed by `provider/model`.

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

- `tiers`: positive knowledge.
- `unsupportedTiers`: optional explicit negative knowledge.
- A tier absent from both lists remains unknown. `determined: true` does not imply every unlisted/new tier is unsupported.
- `api`: the route recorded when the entry was created; current route equality is not yet fully enforced.
- `updatedAt`: record update time, not necessarily a live probe timestamp.
- `error`: optional diagnostic about rejection or an incomplete decision.

| `source` | Origin |
| --- | --- |
| `preset` | Bundled documentation-based information. |
| `probe` | A completed full probe cycle. |
| `error` | A recognized tier error from a request this extension modified. |
| `user-mark` | A choice to leave support unknown. |
| `manual` | Manually supplied/legacy information. |

A preserved user mark suppresses repeated prompts; leaving one tier unknown does not erase other confirmed knowledge. Tier/fast commands preserve probe entries when the selected tier is already known in either list. Preset refresh can intentionally replace eligible stored evidence. Blocked-route records are retained and do not bypass the runtime block.

## Support-maintenance commands

| Command | Effect |
| --- | --- |
| `/service-tier-refresh-support` | Copy the current model's bundled information. |
| `/service-tier-refresh-support-all` | Copy information for eligible routes returned by Pi's model registry. |
| `/service-tier-unset-support` | Remove the current model's stored record. |
| `/service-tier-unset-support-all` | Remove eligible stored records; preserve blocked/unresolved-API entries. |

Refresh also evaluates unknown behavior when a tier is active, so it can prompt for or start paid probes. The preset copy itself makes no model call. Unset makes no model calls and does not disable configured tiers.

## Unknown-support policy

`/service-tier-unknown-behavior` writes a user-wide policy; a project override can still take precedence.

| Policy | After explicit tier/fast or active-tier refresh commands |
| --- | --- |
| `ask` (default) | Prompt for unresolved support, unless preserved user marks or known support/rejection already cover it. |
| `auto-probe` | Start a full cycle, even when the selected tier is preset-supported. |
| `leave-unknown` | Keep unresolved knowledge without prompting. |

The prompt offers `Auto-probe once`, `Always auto-probe`, `Leave unknown once`, and `Always leave unknown`. The “always” choices persist the corresponding user policy. None of these policies turns a configured tier off. Startup/model selection and ordinary requests alone do not initiate a probe.

## Probe lifecycle

**Probes make real provider requests and can cost money.** Each cycle checks all seven package tiers, not only the tier selected for ordinary requests.

- Uses `ctx.modelRegistry.streamSimple()` for configured routing, authentication, and context normalization.
- Requests a short `Reply OK.` response with `maxTokens: 1`. OpenAI Responses clamps the output limit to at least 16 tokens, so this is not necessarily a literal one-token request.
- Applies the tier through an immutable payload hook and guards the resolved provider/API before the SDK request.
- Classifies terminal `done` as supported and recognized tier rejection as unsupported. Authentication, rate limits, setup errors, timeout, incomplete streams, and cancellation remain unknown.
- Uses a 30-second timeout per tier, runs in the background, and does not queue normal Pi requests or retry failures.
- Saves one complete probe record only if every tier is resolved and the target/config are still eligible. Unresolved or cancelled cycles do not overwrite the map with partial results.

Off commands, fast-off toggles, selected model/API changes, and shutdown signal abort to the current SDK stream and stop later tiers. During the cycle, config guards also detect manual off/error edits. Cancellation is isolated per extension instance; stale prompt choices and late results cannot restart a cancelled cycle or replace newer status. A new explicit enabling command may start a new cycle under the current policy.

SDK/server cancellation is best-effort: an already processed request may still be billed.

## Ordinary request errors

Recognized `service_tier` rejection removes the applied tier from positive knowledge, adds it to `unsupportedTiers`, and records an error. The failed request is not retried. Future requests still use an explicitly active tier until the user disables or changes it.

Requests left unchanged clear previous injection tracking. Errors from another payload, an off/error config, or a blocked route must not corrupt an earlier tier's support record.

## Known evidence limitations

- **API mismatch:** saved evidence for `openai/gpt-5.5` on `openai-responses` can be reused when the same key uses `openai-completions`, even though that API has no matching bundled preset. A route change should make the knowledge unknown; this fix is still outstanding.
- **Completion is not delivery:** a stream emitting `done` can be classified as supported even if its payload hook was never invoked. SDK/server field stripping or fallback can therefore produce an optimistic decision. Served-tier fields/headers are not verified yet.
- **Shared candidates:** probing all package values does not implement every provider's distinct request enum, account eligibility, or completeness rules.

Do not use status/probe success as evidence of actual tier delivery, pricing, or speed. Planned API-specific evidence matching, candidates, and served-tier verification are tracked in [TODO](https://github.com/luxmargos/pi-provider-service-tier/blob/main/TODO.md).
