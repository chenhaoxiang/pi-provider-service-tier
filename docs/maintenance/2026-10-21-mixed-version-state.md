---
doc_type: report
project: pi-provider-service-tier
status: active
truth_mode: maintained
created: 2026-10-21
owner: chx
---

# Mixed-version state safety — 0.1.7-fork.4

## User intent and invariants

Prefer converging long-lived Pi sessions to the latest reviewed installation, but protect the interval while old sessions still run. Messages or disk package changes do not retroactively replace old in-memory code. This change fixes the reproduced v3 support loss, malformed proof coercion and default-footer control rendering without touching real provider credentials or running paid probes.

## Schema-generation isolation

Canonical support records move to `~/.pi/agent/extensions/pi-provider-service-tier-map-v3.json`. The previous `pi-provider-service-tier-map.json` is a read-only first-initialization source. Creation publishes a fully written temporary snapshot exclusively; a concurrent initializer's already-created store wins. Existing new data is never replaced by a subsequent legacy import. A symlink/hard-link alias to the old store is refused rather than upgraded in place.

Old v2/fork.3 processes can continue writing their own old path. That is not a dual-write/merge protocol: their later records remain only in their legacy file until an explicitly reviewed reconciliation. The new canonical facts are not handed to a schema-unaware old writer. Settings remain v2 with the existing project/user filenames; this slice does not add another settings authority or change explicit tier activation.

Malformed proof kinds and tier values are type-checked instead of string-coerced during preset retirement. Unsafe saved served-tier values render `unknown` under the same name rule as the picker, including the default footer. Invalid configuration still suspends injection; a failed support-map operation still leaves healthy explicit tier settings usable.

## Recovery and rollback

Preserve both stores, package directories and original receipts. `scripts/check-support-map-rollback.mjs <target-map-file> <target-max-schema>` is read-only and refuses malformed/higher-version data before a package-selection change. It does not reverse-migrate, restore files, stop writers or claim that arbitrary old/new processes are safe. A v2 target reads the old path and must not receive a v3 file there. When the check refuses, coordinate an idle recovery window using a matching reviewed backup; do not overwrite post-upgrade facts or unrelated settings.

The local four-package rollback helper must call this check before committing settings. A new version's canonical v3 store is retained during a package-selection-only rollback, so a later return to the fixed version keeps its facts. Earlier v3-at-legacy-path packages remain a historical unsafe writer combination; this release cannot patch already-loaded code retroactively.

## Verification

Provider-free unit regressions cover distinct paths, read-only one-time import, legacy writes/resets after initialization, v3 auth preservation, bad-source recovery, alias refusal, malformed proof metadata, default-footer sanitation and rollback format refusal. The existing full check remains required. A synthetic smoke additionally imports the actual retained 0.1.7-fork.2 and fork.3 packages, alternates their writes for three cycles, and checks that the candidate canonical bytes remain unchanged; it also exercises repaired startup/request hooks and default footer. No live files or provider calls are used.

Exact-head review, final check counts, release assets, fresh-download checksums and local installation are later evidence in the PR/Release and owner-local receipts; this source report is not a prospective installed-runtime PASS.
