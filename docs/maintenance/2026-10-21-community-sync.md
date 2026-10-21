---
doc_type: report
project: workspace
component: pi-provider-service-tier
status: active
truth_mode: maintained
created: 2026-10-21
verified: 2026-10-21
verified_by: manual
owner: chx
---

# 0.1.7-fork.3 community integration

## Exact scope

Integrate 9 community commits through `fccdf74d209d56c4ee3d9c1890e204a8b2703bff` (source version 0.1.7) into the maintained `main`; preserve previous release 0.1.7-fork.2 for rollback. Pure `upstream-main` remains a separate exact mirror. This document records source validation, not a pre-emptive release or installed-runtime claim.

Integrates exact API/auth-scoped support records, prepared/served-tier probe evidence, preset retirement, tier picker, severity/origin labels, footer templates and the light benchmark. Retains branch-local /fast and Ctrl+Alt+F, custom GPT-provider support, persistent priority GPT gating and one-time ordinary-tier continuation. New regressions prove unchanged unknown auth can safely disable session Fast after rejection without creating persistent support evidence; persistent evidence still requires a known auth scope. The upstream missing-payload-hook test uses flex, since the fork intentionally refuses non-GPT priority before a paid probe.

## Verification

`npm run check` passed: typecheck, all 233 provider-free tests and package dry-run. The unknown-auth fallback regression failed before the compatibility fix and passed afterward. Package contents include session-state plus every newly extracted module. No real provider probe or paid benchmark was run.

Independent review and exact-head CI are bound to the synchronization PR. Release assets must be built from the exact remote merge commit, include a source manifest and SHA-256 checksums, then be freshly downloaded and verified before installation. GitHub Release notes record those later outcomes; do not infer them from this source report.

## Installation boundary

The authorized rollout selects a new permanent versioned package directory only after artifact and provider-free host-loading checks. Preserve old packages and a settings backup; do not force-restart loaded parents, children or a shared broker. Disk selection does not prove existing sessions loaded the new code. Real credentials, paid queries/probes, provider settings and unrelated package declarations are not part of verification.
