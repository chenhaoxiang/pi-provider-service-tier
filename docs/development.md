# Development and verification

[User guide](../README.md) · [Configuration](configuration.md) · [Provider/API reference](providers.md) · [Benchmarking](benchmarking.md)

Follow [AGENTIC_AI_CHECKLIST.md](https://github.com/luxmargos/pi-provider-service-tier/blob/main/AGENTIC_AI_CHECKLIST.md) before changing or releasing the package. Keep task progress outside that policy file.

## Local setup

Requires Node.js `>=22.19.0`. Development references for `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` are pinned to exactly `1.1.0`. Their peers remain `"*"` because Pi supplies them at runtime; do not bundle a competing host runtime.

```bash
git clone https://github.com/luxmargos/pi-provider-service-tier.git
cd pi-provider-service-tier
npm install
npm run check
```

`npm install` is a dependency installation step, not part of offline verification of an already prepared checkout.

## Package layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Extension factory, settings validation/I/O, commands, lifecycle hooks, payload injection, probe orchestration. |
| `src/service-tiers.ts` | Shared tier values, eligibility, key parsing, and exact route identity. |
| `src/support-map.ts` | v3 support schema, tolerant migration, safe persistence, and route-scoped evidence operations. |
| `src/probe-evidence.ts` | Provider-specific candidates and served-tier parsing/comparison. |
| `src/*.test.ts` | Pure-function, mocked integration/I/O, and offline real-SDK serialization tests. |
| `src/legacy-presets.ts` | Pure retirement-only cleanup of old preset data; no support seeding or lookup. |
| `scripts/benchmark-service-tier.mjs` | Opt-in live latency comparison; not part of `npm run check`. |
| `docs/*.md` | Topic-specific user references and maintainer documentation. |

The Pi manifest loads `./src/index.ts`. The npm `files` allowlist includes the runtime source, scripts, docs, README, and CHANGELOG; no preset data. Review it whenever adding runtime modules or moving referenced documentation. Unit tests and local state are not published.

## Runtime design

- The default export receives `ExtensionAPI` and registers package commands/events. Import alone must not make model calls or write config.
- Eligibility is explicit provider **and** API identity, checked before interaction/injection and again for resolved probe requests. Native adapters require distinct serializers/candidates; see [provider contracts](providers.md#why-native-routes-remain-blocked).
- Config helpers separate normalization and effective resolution from command/UI side effects. Whole-file errors remain distinct from missing files; read-only request checks must not reset broken config.
- `before_provider_request` returns a copied payload only for an eligible, explicitly active valid tier. Otherwise it returns `undefined` and clears injection tracking. Shared payloads are not mutated or stripped of unrelated fields.
- `message_end` records recognized tier errors only for tracked extension injection, without retrying the failed request.
- Startup scans existing settings/maps for preset retirement with healthy config, including on blocked routes; notify only after an actual successful removal with the package-name prefix and OAuth/API caution. Normal default initialization waits for an eligible route. Support maintenance preserves non-preset blocked records.
- Auto Probe uses the configured model registry, not direct provider/auth resolution. Per-instance ownership, generation checks, and abort controllers prevent stale prompts/results from surviving off, model changes, or shutdown.

The support map is advisory, not an activation gate. `src/service-tiers.ts` owns shared tiers/route identity, `src/support-map.ts` owns v3 migration, persistence, and route-scoped knowledge, and `src/probe-evidence.ts` owns candidates/response semantics. SDK completion alone cannot create positive evidence. Provider metadata and a prior observation still do not prove future application or billing; see [known limitations](support-and-probes.md#known-evidence-limitations).

## Offline checks

```bash
npm run check
node --check scripts/benchmark-service-tier.mjs
git diff --check
```

`npm run check` runs:

1. `tsc --noEmit`.
2. All `src/*.test.ts` Node tests with TypeScript stripping: extension regressions, migration/I/O faults, evidence semantics, and real Pi SDK serializers using locally mocked HTTP responses; no paid model calls.
3. `npm pack --dry-run`, including documentation/publication contents.

`prepublishOnly` runs the same check, but publication is a separate explicitly authorized action.

For runtime changes, practical smoke coverage should load the TypeScript entrypoint through Pi 1.1.0's extension loader with isolated temporary config, fake UI/registry, and forbidden network access. Exercise commands/events, unchanged payloads, preset cleanup/notification idempotence, explicit/manual/Probe preservation, authentication cautions, original-file preservation, cancellation signals, late responses, and per-instance isolation. Restore temporary environment changes afterward. A mocked stream verifies local behavior, not account eligibility or served tiers.

## Interactive local loading

For a prepared checkout:

```bash
pi -e . --provider openai --model gpt-5.5
```

Or install the checkout project-locally with `pi install -l .`, then `/reload`. Do not simultaneously load the same checkout with `pi -e .`; duplicate registrations can receive numeric command suffixes. Remove the local install with `pi remove -l .`.

Loading alone does not start Auto Probe. Sending a prompt, enabling automatic probing, or running a live benchmark can make paid requests and needs explicit authorization. Keep verification offline by default; do not resume cancelled live checks implicitly.
