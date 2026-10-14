# Support records and Auto Probe

[User guide](../README.md) · [Configuration](configuration.md) · [Provider/API reference](providers.md)

Keep three questions separate:

1. **Eligibility:** does this package allow the provider/API route?
2. **Support knowledge:** what do user-maintained records and request observations say for the current environment?
3. **Observed application:** did a completed probe report a processing tier consistent with its prepared request?

None establishes account eligibility for future requests, billing, or latency.

## Activation and status

On an allowed route with healthy settings, an explicitly active valid tier is sent even if support is unknown or rejected. Support records do not disable the tier.

| Status suffix | Meaning |
| --- | --- |
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
          "auth": {
            "api_key": {
              "provider": "openai",
              "id": "gpt-5.5",
              "api": "openai-responses",
              "authMode": "api_key",
              "determined": true,
              "tiers": [
                "priority"
              ],
              "source": "manual",
              "updatedAt": "2026-10-14T00:00:00Z",
              "evidence": {
                "priority": {
                  "kind": "manual",
                  "updatedAt": "2026-10-14T00:00:00Z"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

Each API contains independent `auth.oauth` and `auth.api_key` slots. `auth.unknown` preserves records whose authentication cannot be classified and is **never** a current-support lookup fallback. Every consumer/writer checks provider, model, API, and known auth-mode equality; neither Responses→Chat Completions nor OAuth→API-key reuse is allowed. Missing/unknown authentication or a different API means unknown support, without turning off a healthy explicit setting. The `authMode` field, when supplied, must match its container; conflicts are quarantined.

- `tiers` / `unsupportedTiers`: recorded lists. Their per-tier evidence determines whether a historical item is usable; a legacy positive/negative list alone is not verification.
- `evidence`: best applicable per-tier knowledge, with kinds `manual`, `verified`, `rejected`, or `legacy`. The former preset-derived `documented` grade is retired, including in routes whose source later changed to manual/probe/user-mark.
- `observations`: latest probe outcome per tier, including `request-completed` and `fallback`. These outcomes can coexist with manual or verified knowledge, but cannot create positive support themselves.
- Verified evidence requires `payloadPrepared: true`, `requestCompleted: true`, and a recognized, semantically matching `servedTier`. Rejected evidence requires a prepared request and a recognized tier error.
- `determined`: retained summary/completeness metadata, not a claim that every package tier is supported or every unlisted tier is unsupported.
- `updatedAt`: record/evidence update time; documentation timestamps are not live-call timestamps.
- `error`: optional rejection diagnostic.
- `legacy`: unassignable model records, such as missing/conflicting APIs; preserved but excluded from route decisions.
- `preserved` / `preservedFields`: unclassified structures and metadata normalized during migration; not active support evidence.

`source` records the entry's origin (`probe`, `error`, `user-mark`, or `manual`). Former `preset` records are removed during startup retirement and are not applicable support. In mixed records, preset documentation is removed without deleting manual facts or prepared Probe evidence/observations. It is not a substitute for per-tier evidence. A route-specific user mark suppresses repeated prompts; completion-only observations also suppress repeated `ask` prompts without becoming support. Switching APIs or authentication modes does not reuse either decision. The same stored user mark or completion observation applies only to its known auth slot.

## Forward migration and file safety

Readable v1/v2, already-v3 API-only records, and partial historical maps normalize to auth-separated v3 without provider calls. Old API-only manual facts, Probe evidence/observations, and user marks move to `auth.unknown`; they are retained but never assigned to today's login/key or used as current support, rejection, or prompt-suppression evidence. Optional auth-like metadata on an old flat/API-only record is not sufficient to classify it. The reader normalizes minor metadata issues and retains records it cannot classify instead of rejecting an otherwise feasible upgrade. Existing explicit APIs are used; missing APIs are **not** guessed from today's model catalog. Old positive probes remain `legacy`, not verified application; similarly named old optional proof fields are preserved without promotion.

The writer uses exclusive creation for missing maps and a same-directory temporary file plus rename for replacements, keeping symlinks intact. It checks for changes before replacement and preserves the existing file if a real read, JSON, unsupported-future-version, or write failure occurs. This check catches observed concurrent edits; it is not a cross-process lock.

Structural upgrades and normalization replacements attempt a byte-for-byte `<map-path>.v1.backup`, `.v2.backup`, or `.vlegacy.backup`. Existing backups are never overwritten and do not block upgrading. An unavailable optional backup warns but does not fail an otherwise safe replacement. These are upgrade safeguards, not downgrade conversion/recovery features. An original-byte backup may contain retired preset data; it is not loaded as support and cleanup does not delete or restore existing backups.

There is no reverse migration or old-format compatibility saving. Older package versions can overwrite v3 support records; downgrading is not supported. A support-map error leaves its data untouched and displays support as unknown, but does not disable healthy explicit tier settings. Repair or move aside the named map before retrying support maintenance.

## Support-maintenance commands

| Command | Effect |
| --- | --- |
| `/service-tier-unset-support` | Remove only the selected API/known-auth slot; preserve other modes/APIs and unknown history. |
| `/service-tier-unset-support-all` | Remove eligible known-auth slots; preserve blocked/unresolved routes and unclassified history, including `auth.unknown`. |

The former refresh commands are removed. Startup and ordinary commands do not import, seed, or update bundled knowledge. Existing preset-only records, including legacy/preserved copies, are cleaned at startup; manual records and prepared Probe evidence/observations in mixed records remain. Actual removals produce an extension-prefixed notice, not a probe.

To add knowledge manually, edit the exact provider/model/API/auth-mode slot using the `source: "manual"` example above; only record values you have confirmed for the current access method. To inspect actual reported application, explicitly choose Auto Probe after a tier command. Never fabricate `verified` evidence from documentation or completion alone.

Unsetting support does not disable configured tiers or call providers. Reissuing a tier/fast command can evaluate the chosen unknown-support policy and therefore initiate paid probing.

## Unknown-support policy

`/service-tier-unknown-behavior` writes a user-wide policy; a project override can take precedence.

| Policy | After explicit tier/fast commands |
| --- | --- |
| `ask` (default) | Prompt for unresolved support unless applicable knowledge, rejection, user marks, or completed observations already cover it. |
| `auto-probe` | Start a full candidate cycle, even when manual support is already recorded. |
| `leave-unknown` | Keep unresolved knowledge without prompting. |

Choices are `Auto-probe once`, `Always auto-probe`, `Leave unknown once`, and `Always leave unknown`; “always” persists the corresponding user policy. None turns a tier off. Migration, startup/model selection, authentication changes, and ordinary requests alone do not initiate a probe. If Pi's authentication metadata is absent, inconsistent, unsupported, or unreadable, an explicit tier command keeps support unknown and warns instead of sending a paid Probe whose scope cannot be classified.

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
- Applies an immutable payload hook and rechecks the exact resolved provider/model/API, captured authentication mode, and cancellation before sending or observing events.
- Requires terminal SDK completion, a prepared tier, and recognized matching served-tier metadata for `verified` evidence. `done` alone is unknown; a prepared completed request with no tier metadata records completion only.
- Treats recognized tier rejection as rejected. Auth/rate/setup errors, timeout, incomplete streams, and cancellation remain unknown.
- Uses a 30-second per-tier timeout, runs in the background, and requests no retries.
- Saves structured observations only after the full candidate cycle completes. A non-completed unknown result, missing payload hook, cancellation, or changed target/config stops the cycle without saving partial results. A prepared completion without tier metadata can finish a cycle, but cannot create positive support.

Off/toggle-off, selected model/API or detected auth-mode changes, shutdown, and manual off/config-error edits abort owned streams and stop subsequent tiers. Per-instance ownership prevents late results or stale prompts from restarting cancelled work. Provider cancellation is best-effort: already processed requests may be billed.

## Provider response evidence

- OpenAI Responses/Codex: terminal response `service_tier` via raw provider-stream events.
- Chat Completions on supported OpenAI/OpenRouter/xAI routes: chunk `service_tier`.
- OpenRouter Messages: `usage.service_tier` from message start/delta events, not native Anthropic request enums or `speed` alone.
- Groq: the served-tier stream contract is not established here, so successful requests remain application-unverified rather than inferring OpenAI response semantics.

Comparisons use route-specific semantics: `fast`/`priority` aliases, OpenRouter `default`/`standard`, and OpenAI `auto` with an observed actual tier. A different reported tier records fallback, not automatic non-support.

## Ordinary request errors

Recognized tier errors update only the exact route of a tracked request this extension modified. They cannot change a previous API/auth mode's record after switching routes or authentication. Auth transitions clear request tracking so a late error cannot be attributed to the new mode. Unchanged/off/error/blocked requests clear tracking. Failed requests are not retried; future requests still send an explicit tier until the user changes or disables it.

## Known evidence limitations

The payload hook proves preparation, not independently observed wire delivery. Verification relies on the provider's defined response semantics and available SDK callbacks, not independent billing/scheduling evidence. Missing, unrecognized, or conflicting metadata cannot verify a tier.

The map separates provider/model/API and **OAuth/API-key mode**, not individual accounts, workspaces, plans, or different keys within one mode. Even an identical provider/model can accept different `service_tier` values after an account, authentication, or API change. Pi's synchronous auth metadata is a runtime snapshot, not independently observed wire authentication; external auth-file edits require Pi to reload/refresh its state, and custom per-request auth/header/endpoint overrides may differ from it. The extension does not inspect tokens/keys or force auth resolution/network refresh. Detected mode changes invalidate caches, in-flight probes/prompts, and error tracking; same-mode account/key changes still require user confirmation or unsetting support before an explicitly approved fresh Probe. A past observation does not guarantee future account eligibility, authentication compatibility, routing, latency, price, or applied tier. Custom backends can omit or misreport metadata; successful completion is not a substitute. Further native-provider work is tracked in [TODO](https://github.com/luxmargos/pi-provider-service-tier/blob/main/TODO.md).
