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
- `npm run check` passed: typecheck, 105 tests, package dry-run and zero dependency audit findings in this workspace.
- Review follow-up restored the non-GPT priority-command refusal, added no-probe and shortcut regressions, corrected both preset README tables and packed the linked maintenance report. The cancellation fixture now uses an unknown GPT route so it remains valid under the retained fork Fast restriction; its cancellation assertions are unchanged.
- No paid provider probe or benchmark was run.

Install the immutable fork release into a permanent directory and use `/reload` or restart after installation. Existing Pi sessions retain their imported extension modules until reloaded; preserve `0.1.7-fork.1` for rollback.

## Release and installed acceptance

[PR #3](https://github.com/chenhaoxiang/pi-provider-service-tier/pull/3) merged normally to `d383ff37de9d0ab2e0d406a732ff27ce639930dc`; final reviewed head `0c62cb3bf942f260b971453e6ba2068741ca80fd` has no P0/P1 findings. Typecheck, all 105 tests and 17-file pack validation were repeated at the clean exact merged source. Separate npm audit reported zero findings; this repo has no configured remote CI and no remote CI pass is invented. Report-only manual unsupported-priority/probe and docs edge notes remain in the PR review.

The immutable [v0.1.7-fork.2 release](https://github.com/chenhaoxiang/pi-provider-service-tier/releases/tag/v0.1.7-fork.2) includes package, manifest and checksums. Fresh download checksum verification passed; package SHA-256 is `0c18922cfb3e0c7b8fb2b4199904dc885a1465fb44c0e608968dba02849fa6a2`. All 17 tarball files match the permanent installed package byte-for-byte.

Settings now select `packages/pi-provider-service-tier/0.1.7-fork.2`; the previous pinned Git cache and settings backup remain for rollback. Isolated RPC under core 1.1/1.2 exposed /fast, the session alias and persistent tier commands with zero provider requests and no loader errors. SAW reports `0.1.7-fork.2` and no pending service-tier synchronization. No real tier probe, latency benchmark or active-session restart was performed; release support data is not account/service-tier delivery verification.
