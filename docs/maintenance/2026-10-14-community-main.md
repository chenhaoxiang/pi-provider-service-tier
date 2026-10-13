---
doc_type: report
project: pi-provider-service-tier
status: active
truth_mode: maintained
created: 2026-10-14
updated: 2026-10-14
owner: chx
---

# Community main synchronization

## Scope and source

Integrate community `luxmargos/pi-provider-service-tier` main at `f0872a2032f43594587154393650ba6d1a46a893` into the maintained fork. The community package remains `0.1.7`; this fork release increments to `0.1.7-fork.2` because the community base did not change.

## Retained fork behavior

- Preserve session-local GPT Fast mode (`/fast`, branch state, status hint, shortcut and fail-safe fallback).
- Retain the upstream provider/API allowlist, configuration read/write fail-closed behavior, cancellation of stale probes, model-specific presets and unknown-support semantics.
- Keep the fork README/install identity and release provenance contract separate from the community npm identity.

## Validation

- `npm ci --ignore-scripts` passed.
- `npm run check` passed: typecheck, 103 tests, package dry-run and zero dependency audit findings in this workspace.
- No paid provider probe or benchmark was run.

Install the immutable fork release into a permanent directory and use `/reload` or restart after installation. Existing Pi sessions retain their imported extension modules until reloaded; preserve `0.1.7-fork.1` for rollback.
