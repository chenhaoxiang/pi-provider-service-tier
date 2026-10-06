# AGENTS.md

Before changing this repository, agentic AI assistants must read and follow:

- [`AGENTIC_AI_CHECKLIST.md`](./AGENTIC_AI_CHECKLIST.md)

That checklist contains the repo-specific rules for Pi/pi.dev extension fitness, modularity, reuse, extensibility, verification, and safe agent workflow.

## Fork release and documentation map

- `main` is our maintained integration/release branch; `upstream-main` mirrors only luxmargos/pi-provider-service-tier main. Use PRs and regular merges; preserve fork Fast behavior. The upstream remote is read-only and main-only.
- Every `<community-version>-fork.<revision>` is published as a stable GitHub Release with a tarball, exact-source manifest and SHA-256 checksums; no upstream npm publication.
- `README.md` / `README.zh-CN.md`: default English and complete Chinese installation, Fast/persistent controls, billing/probe warnings and configuration.
- `docs/releasing.md`: branch/version/release contract and provider-free verification.

Quick reminders:

- Keep this package compatible with Pi extension/package conventions.
- Prefer small, auditable changes.
- For source changes, run the relevant checks listed in `AGENTIC_AI_CHECKLIST.md` before handoff.
