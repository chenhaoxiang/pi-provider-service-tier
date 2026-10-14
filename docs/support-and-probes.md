# Support records and Auto Probe

[User guide](../README.md) · [Configuration](configuration.md) · [Provider/API reference](providers.md)

Keep three questions separate:

1. **Eligibility:** does this package allow the provider/API route?
2. **Support knowledge:** what do documentation, manual records, and request observations say?
3. **Observed application:** did a completed probe report a processing tier consistent with its prepared request?

None establishes account eligibility for future requests, billing, or latency.

## Activation and status

On an allowed route with healthy settings, an explicitly active valid tier is sent even if support is unknown or rejected. Support records do not disable the tier.

| Status suffix | Meaning |
| --- | --- |
| `documented` | Matching provider/model/API documentation records support; no live verification. |
| `manual` | Manually supplied support; not a verified probe. |
| `probe-verified` (green) | A prior completed probe prepared the tier and received matching, recognized served-tier metadata. |
| `probe-completed (tier unknown)` | A prior request completed, but tier application was not verified. |
| `probe-fallback→<tier>` | A prior request reported a different tier; not automatically an unsupported-tier decision. |
| `unknown` | No applicable positive knowledge, including unclassified historical probes. |

A prior observation concerns that request, not the next request. The package does not change Pi's internal `serviceTier` cost multiplier; Pi's displayed cost is not confirmation of provider billing.

## Support-map schema

Current schema version: **3**. The filename remains `pi-provider-service-tier-map.json`. User/project settings remain v2 and keep their existing filenames.

```json
{
  "version": 3,
  "entries": {
    "openai/gpt-5.5": {
      "routes": {
        "openai-responses": {
          "provider": "openai",
          "id": "gpt-5.5",
          "api": "openai-responses",
          "determined": true,
          "tiers": ["priority"],
          "source": "preset",
          "updatedAt": "2026-10-12T04:33:41Z",
          "evidence": {
            "priority": {
              "kind": "documented",
              "updatedAt": "2026-10-12T04:33:41Z"
            }
          }
        }
      }
    }
  }
}
```

Each API has an independent slot. Every consumer checks provider, model, and API equality; Responses evidence cannot establish Chat Completions support. A missing or different API means unknown, without turning off an explicit setting.

- `tiers` / `unsupportedTiers`: recorded lists. Their per-tier evidence determines whether a historical item is usable; a legacy positive/negative list alone is not verification.
- `evidence`: best applicable per-tier knowledge, with kinds `documented`, `manual`, `verified`, `rejected`, or `legacy`.
- `observations`: latest probe outcome per tier, including `request-completed` and `fallback`. These outcomes can coexist with older documentation or verified knowledge, but cannot create positive support themselves.
- Verified evidence requires `payloadPrepared: true`, `requestCompleted: true`, and a recognized, semantically matching `servedTier`. Rejected evidence requires a prepared request and a recognized tier error.
- `determined`: retained summary/completeness metadata, not a claim that every package tier is supported or every unlisted tier is unsupported.
- `updatedAt`: record/evidence update time; documentation timestamps are not live-call timestamps.
- `error`: optional rejection diagnostic.
- `legacy`: unassignable model records, such as missing/conflicting APIs; preserved but excluded from route decisions.
- `preserved` / `preservedFields`: unclassified structures and metadata normalized during migration; not active support evidence.

`source` records the entry's origin (`preset`, `probe`, `error`, `user-mark`, or `manual`). It is not a substitute for per-tier evidence. A route-specific user mark suppresses repeated prompts; completion-only observations also suppress repeated `ask` prompts without becoming support. Switching APIs does not reuse either decision.

## Forward migration and file safety

Readable v1/v2 and partial historical maps migrate to v3 without provider calls. The reader normalizes minor metadata issues and retains records it cannot classify instead of rejecting an otherwise feasible upgrade. Existing explicit APIs are used; missing APIs are **not** guessed from today's model catalog or presets. Old positive probes remain `legacy`, not verified application; similarly named old optional proof fields are preserved without promotion.

The writer uses exclusive creation for missing maps and a same-directory temporary file plus rename for replacements, keeping symlinks intact. It checks for changes before replacement and preserves the existing file if a real read, JSON, unsupported-future-version, or write failure occurs. This check catches observed concurrent edits; it is not a cross-process lock.

Structural upgrades attempt a byte-for-byte `<map-path>.v1.backup`, `.v2.backup`, or `.vlegacy.backup`. Existing backups are never overwritten and do not block upgrading. An unavailable optional backup warns but does not fail an otherwise safe replacement. These are upgrade safeguards, not downgrade conversion/recovery features.

There is no reverse migration or old-format compatibility saving. Older package versions can overwrite v3 support records; downgrading is not supported. A support-map error leaves its data untouched and displays support as unknown, but does not disable healthy explicit tier settings. Repair or move aside the named map before retrying support maintenance.

## Support-maintenance commands

| Command | Effect |
| --- | --- |
| `/service-tier-refresh-support` | Replace the selected provider/model/API slot with bundled information; preserve other APIs. |
| `/service-tier-refresh-support-all` | Refresh eligible routes returned by Pi's model registry. |
| `/service-tier-unset-support` | Remove only the selected API slot. |
| `/service-tier-unset-support-all` | Remove eligible API slots; preserve blocked/unresolved routes and unclassified history. |

Explicit refresh can intentionally replace evidence for the affected slot. Ordinary tier commands preserve other verified/rejected knowledge when merging documentation. Startup does not replace probe/user-mark records or verified/rejected observations with presets.

Refresh also evaluates unknown behavior for an active tier, so it can prompt or start paid probes. Copying presets and unsetting support make no model calls. Unset does not disable configured tiers.

## Unknown-support policy

`/service-tier-unknown-behavior` writes a user-wide policy; a project override can take precedence.

| Policy | After explicit tier/fast or active-tier refresh commands |
| --- | --- |
| `ask` (default) | Prompt for unresolved support unless applicable knowledge, rejection, user marks, or completed observations already cover it. |
| `auto-probe` | Start a full candidate cycle, even when the selected tier is documented. |
| `leave-unknown` | Keep unresolved knowledge without prompting. |

Choices are `Auto-probe once`, `Always auto-probe`, `Leave unknown once`, and `Always leave unknown`; “always” persists the corresponding user policy. None turns a tier off. Migration, startup/model selection, and ordinary requests alone do not initiate a probe.

## Probe lifecycle

**Probes make real provider requests and can cost money.** A cycle checks this provider/API's candidate request values, not necessarily all package values or only the configured tier:

| Provider | Candidates |
| --- | --- |
| OpenAI / legacy Codex | `priority`, `flex`, `default`, `auto`, `scale`, `fast`, `ultrafast` |
| OpenRouter | `priority`, `flex`, `default`, `fast`, `ultrafast` |
| xAI | `priority`, `default` |
| Groq | `flex`, `auto` |

Candidates are not account/model support guarantees. A selected value outside the candidate set stays unverified.

- Uses `ctx.modelRegistry.streamSimple()` for configured routing, authentication, and context normalization.
- Requests `Reply OK.` with `maxTokens: 1`; OpenAI Responses clamps this to at least 16 tokens.
- Applies an immutable payload hook and rechecks the exact resolved provider/model/API and cancellation before sending or observing events.
- Requires terminal SDK completion, a prepared tier, and recognized matching served-tier metadata for `verified` evidence. `done` alone is unknown; a prepared completed request with no tier metadata records completion only.
- Treats recognized tier rejection as rejected. Auth/rate/setup errors, timeout, incomplete streams, and cancellation remain unknown.
- Uses a 30-second per-tier timeout, runs in the background, and requests no retries.
- Saves structured observations only after the full candidate cycle completes. A non-completed unknown result, missing payload hook, cancellation, or changed target/config stops the cycle without saving partial results. A prepared completion without tier metadata can finish a cycle, but cannot create positive support.

Off/toggle-off, selected model/API changes, shutdown, and manual off/config-error edits abort owned streams and stop subsequent tiers. Per-instance ownership prevents late results or stale prompts from restarting cancelled work. Provider cancellation is best-effort: already processed requests may be billed.

## Provider response evidence

- OpenAI Responses/Codex: terminal response `service_tier` via raw provider-stream events.
- Chat Completions on supported OpenAI/OpenRouter/xAI routes: chunk `service_tier`.
- OpenRouter Messages: `usage.service_tier` from message start/delta events, not native Anthropic request enums or `speed` alone.
- Groq: the served-tier stream contract is not established here, so successful requests remain application-unverified rather than inferring OpenAI response semantics.

Comparisons use route-specific semantics: `fast`/`priority` aliases, OpenRouter `default`/`standard`, and OpenAI `auto` with an observed actual tier. A different reported tier records fallback, not automatic non-support.

## Ordinary request errors

Recognized tier errors update only the exact route of a tracked request this extension modified. They cannot change a previous API's record after switching routes. Unchanged/off/error/blocked requests clear tracking. Failed requests are not retried; future requests still send an explicit tier until the user changes or disables it.

## Known evidence limitations

The payload hook proves preparation, not independently observed wire delivery. Verification relies on the provider's defined response semantics and available SDK callbacks, not independent billing/scheduling evidence. Missing, unrecognized, or conflicting metadata cannot verify a tier.

A past observation does not guarantee future account eligibility, authentication compatibility, routing, latency, price, or applied tier. Custom backends can omit or misreport metadata; successful completion is not a substitute. Further native-provider work is tracked in [TODO](https://github.com/luxmargos/pi-provider-service-tier/blob/main/TODO.md).
