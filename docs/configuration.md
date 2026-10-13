# Configuration reference

[User guide](../README.md) · [Support records and probes](support-and-probes.md)

Commands are the simplest way to change settings. This reference covers manual configuration, inheritance, validation, and recovery.

## File locations

| File | Location |
| --- | --- |
| Project settings | `<project>/.pi/extensions/pi-provider-service-tier.json` |
| User defaults | `~/.pi/agent/extensions/pi-provider-service-tier.json` |
| Shared support records | `~/.pi/agent/extensions/pi-provider-service-tier-map.json` |

Settings and support records are separate: enabling a tier changes config; presets, probes, and provider errors update support records. Support knowledge does not determine activation. See the [support-map schema](support-and-probes.md#support-map-schema).

For installations that used an older local package name, move or copy `pi-service-tier*.json` files to these filenames.

## Settings schema

Current schema version: `2`. Entries use `provider/model` keys, not bare model IDs.

```json
{
  "version": 2,
  "unknownModelBehavior": "ask",
  "entries": {
    "openai/gpt-5.5": {
      "active": true,
      "serviceTier": "priority"
    },
    "openai/gpt-6-astra": {
      "active": false,
      "serviceTier": "ultrafast"
    }
  }
}
```

- `active`: optional boolean. Only `true` enables an effective entry.
- `serviceTier`: optional `priority`, `flex`, `default`, `auto`, `scale`, `fast`, or `ultrafast`. These are selectable package values, not universal provider capabilities.
- `unknownModelBehavior`: optional `ask`, `auto-probe`, or `leave-unknown`; the default is `ask`. It controls support checking, not tier activation.

Use `active: false` to disable an entry. `"serviceTier": "off"` is not a valid tier. Fast convenience commands explicitly write `priority`; an omitted tier never supplies it implicitly.

## User/project inheritance

User settings provide defaults. Project settings override fields for matching keys; user-only entries still apply unless overridden.

For example, user config `{ "active": true, "serviceTier": "flex" }` and project config `{ "active": true }` produce an active `flex` entry. The project is inheriting a tier explicitly selected by the user, not an implicit default.

A project `{ "active": false }` disables that model even if the user default is active. A user-level off does not disable an explicit project-level on. `unknownModelBehavior` uses the same project-over-user precedence.

The effective entry requires both `active === true` and a valid merged tier. Provider/API eligibility is an additional prerequisite; saved settings cannot override the [route block](providers.md#route-eligibility).

## Invalid entries versus invalid files

| Input | Result |
| --- | --- |
| No config file | Normal inheritance from the other scope. |
| Missing tier in both scopes | Effective off. |
| Invalid explicit tier in an entry | That scope's entry becomes inactive; it cannot revive a user tier. |
| Malformed per-model entry or explicit non-boolean `active` | That entry becomes inactive. |
| Read error, invalid JSON, or invalid whole-file schema | Tier application/probes are suspended for the project, even if the other scope enables a tier. |

Whole-file errors include a non-object root, a non-object `entries` value, invalid/unsupported schema versions, and invalid unknown-behavior values. An empty object or omitted `entries` remains valid for compatibility with older/partial configs. A dangling symlink is unreadable config, not an absent file.

Per-model normalization retains valid model keys and unrelated valid entries. Whole-file errors are not normalized into empty defaults.

## Recovery and refresh

When a whole-file error occurs:

1. The status shows `service_tier ○ off (config error)`; commands/request checks identify the affected path without printing file contents.
2. Existing invalid files are preserved. Startup migration and package command writes are deferred while either settings scope has an error.
3. Repair the file manually or move it aside, then retry the command/request. A package tier command will not overwrite a broken file to repair it.

Moving a file aside makes it absent, which can restore a valid setting inherited from the other scope. Check the effective status before sending requests if you want the tier to remain off.

Config is re-read before provider requests and by ongoing probe guards. A manual off/error edit stops new tier injection and cancels an ongoing probe without requiring `/reload`. Probe cancellation cannot undo charges for a request already processed by the provider.

## Migration and file I/O

On the first allowed-route selection in a session, existing config/map files are migrated before eligible stored non-probe entries are refreshed from presets. Initialization is deferred for blocked routes and settings errors. Read paths accept valid older settings and normalize them to v2 in memory; startup/command writes persist the current schema. The old `unsupportedModelBehavior` name is accepted for migration, and obsolete `aggressiveProbe` is dropped.

Developer-facing behavior:

- `readConfig()` returns `undefined` only for an absent file; config errors throw `ConfigFileError`.
- Effective resolution carries errors in `configIssues` and returns inactive tier state instead of allowing cross-scope fallback.
- Config writes reject existing invalid files. Default-file creation is exclusive so a newly appeared file is not overwritten.
- Historical blocked-provider config/map entries are retained and cannot bypass eligibility guards.
