import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeLegacyPresetData } from "./legacy-presets.ts";
import { migrateMapToCurrent, mapSupportsTier, routeEntry } from "./support-map.ts";
import { _test, ConfigFileError, configPaths } from "./index.ts";

const model = { provider: "openai", id: "gpt-5.5", api: "openai-responses" };
const key = "openai/gpt-5.5";
const verified = { kind: "verified", payloadPrepared: true, requestCompleted: true, servedTier: "priority", updatedAt: "observed" };
const preset = { ...model, source: "preset", determined: true, tiers: ["priority", "flex"], updatedAt: "old", evidence: {
  priority: { kind: "documented", updatedAt: "old" }, flex: { kind: "documented", updatedAt: "old" },
} };

test("settings cleanup removes preset metadata at both container and entry depth without changing explicit choices", () => {
  const input = { version: 2, note: "keep", presets: { copied: true }, presetVersion: 2, unknownModelBehavior: "leave-unknown", entries: {
    [key]: { active: true, serviceTier: "priority", source: "preset", tiers: ["priority"], presetSupport: true, noteForUser: "keep" },
    "openai/other": { active: false, serviceTier: "flex", preset: { tiers: ["flex"] } },
  } };
  const snapshot = JSON.stringify(input);
  const result = removeLegacyPresetData(input, "settings");
  assert.ok(result.removed > 0);
  assert.deepEqual(result.value, { version: 2, note: "keep", unknownModelBehavior: "leave-unknown", entries: {
    [key]: { active: true, serviceTier: "priority", noteForUser: "keep" }, "openai/other": { active: false, serviceTier: "flex" },
  } });
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(removeLegacyPresetData(result.value, "settings"), { value: result.value, removed: 0 });
});

test("v1, v2 and v3 preset-only map records are removed rather than left active or archived in current data", () => {
  for (const version of [undefined, 1, 2, 3]) {
    const entry = version === 3 ? { routes: { [model.api]: preset }, legacy: [{ api: "old", record: preset }, { note: "keep" }] } : preset;
    const input = { version, note: "keep", entries: { [key]: entry } };
    const result = removeLegacyPresetData(input, "map");
    assert.ok(result.removed > 0);
    assert.equal(JSON.stringify(result.value).includes('"preset"'), false);
    const map = migrateMapToCurrent(input);
    assert.equal(routeEntry(map, model), undefined);
    assert.equal(mapSupportsTier(map, key, "priority", model), false);
    if (version === 3) assert.deepEqual(map.entries?.[key].legacy, [{ note: "keep" }]);
    assert.deepEqual(migrateMapToCurrent(map), map);
  }
});

test("mixed routes lose preset documentation but retain manual and prepared probe evidence", () => {
  const input = { version: 3, entries: { [key]: { routes: { [model.api]: {
    ...preset, tiers: ["priority", "flex", "default"], unsupportedTiers: ["scale"],
    evidence: { ...preset.evidence, priority: verified, default: { kind: "manual", updatedAt: "user" },
      scale: { kind: "rejected", payloadPrepared: true, requestCompleted: false, updatedAt: "observed" } },
    observations: { priority: verified },
  } } } } };
  const map = migrateMapToCurrent(input);
  const entry = routeEntry(map, model)!;
  assert.deepEqual(entry.tiers, ["priority", "default"]);
  assert.deepEqual(entry.unsupportedTiers, ["scale"]);
  assert.equal(entry.source, "probe");
  assert.equal(entry.evidence?.priority?.kind, "verified");
  assert.equal(entry.evidence?.default?.kind, "manual");
  assert.equal(entry.evidence?.flex, undefined);
  assert.equal(mapSupportsTier(map, key, "flex", model), false);
  assert.equal(mapSupportsTier(map, key, "priority", model), true);
  assert.deepEqual(migrateMapToCurrent(map), map);
});

test("preset documentation retained inside a later probe/user-mark record is also retired", () => {
  for (const source of ["probe", "user-mark", "error", "manual"]) {
    const map = migrateMapToCurrent({ version: 3, entries: { [key]: { routes: { [model.api]: {
      ...preset, source, evidence: { ...preset.evidence, priority: verified },
      observations: { priority: verified, auto: { kind: "request-completed", payloadPrepared: true, requestCompleted: true, updatedAt: "observed" } },
    } } } } });
    const entry = routeEntry(map, model)!;
    assert.equal(entry.evidence?.flex, undefined);
    assert.equal(entry.observations?.auto?.kind, "request-completed");
    assert.equal(entry.evidence?.priority?.kind, "verified");
    assert.equal(entry.source, source);
  }
});

test("manual facts and unrelated API/manual history are not presets", () => {
  const input = { version: 3, entries: { [key]: { routes: {
    [model.api]: preset,
    "openai-completions": { ...preset, api: "openai-completions", source: "manual", evidence: { priority: { kind: "manual", updatedAt: "user" } } },
  }, legacy: [{ source: "probe", note: "unclassified, keep" }] } } };
  const map = migrateMapToCurrent(input);
  assert.equal(routeEntry(map, model), undefined);
  assert.equal(mapSupportsTier(map, key, "priority", { ...model, api: "openai-completions" }), true);
  assert.deepEqual(map.entries?.[key].legacy, [{ source: "probe", note: "unclassified, keep" }]);
});

test("malformed preset containers and prototype-shaped metadata clean without pollution or crashes", () => {
  for (const input of [null, [], { source: "preset", entries: {} }, { version: 3, entries: { [key]: { source: "preset", routes: { [model.api]: preset } } } }, { version: "3", entries: { [key]: { routes: { [model.api]: preset } } } }]) {
    const result = removeLegacyPresetData(input, "map");
    assert.doesNotThrow(() => migrateMapToCurrent(result.value));
  }
  const input = JSON.parse('{"version":2,"presets":{},"__proto__":{"keep":true},"entries":{"openai/gpt-5.5":{"active":true,"serviceTier":"priority"}}}');
  const result = removeLegacyPresetData(input, "settings");
  assert.equal(({} as Record<string, unknown>).keep, undefined);
  assert.deepEqual((result.value as Record<string, unknown>).__proto__, { keep: true });
});

test("preset-tagged carriers do not delete independent manual/probe children", () => {
  const input = { version: 3, source: "preset", entries: { [key]: {
    source: "preset", routes: { [model.api]: preset, "openai-completions": {
      ...model, api: "openai-completions", source: "manual", determined: true, tiers: ["priority"], updatedAt: "user",
    } }, legacy: [{ source: "probe", note: "keep" }, preset],
  } } };
  const map = migrateMapToCurrent(input);
  assert.equal(routeEntry(map, model), undefined);
  assert.equal(mapSupportsTier(map, key, "priority", { ...model, api: "openai-completions" }), true);
  assert.deepEqual(map.entries?.[key].legacy, [{ source: "probe", note: "keep" }]);
  assert.equal(JSON.stringify(map).includes('"preset"'), false);
});

test("concurrent settings edits survive retirement instead of being overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "pst-preset-concurrent-"));
  const paths = { user: join(dir, "user.json"), project: join(dir, "project.json"), map: join(dir, "map.json") };
  writeFileSync(paths.user, JSON.stringify({ version: 2, presets: {}, entries: {} }));
  const changed = JSON.stringify({ version: 2, note: "concurrent edit", entries: { [key]: { active: false } } });
  const realWrite = fs.writeFileSync;
  const handle = mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    realWrite(...args);
    if (String(args[0]).includes(".service-tier-cleanup-")) realWrite(paths.user, changed);
  });
  syncBuiltinESMExports();
  try {
    let notices = 0;
    assert.throws(() => _test.removeLegacyPresetFiles(paths, () => notices++), ConfigFileError);
    assert.equal(readFileSync(paths.user, "utf8"), changed);
    assert.equal(notices, 0);
    assert.deepEqual(readdirSync(dir), ["user.json"]);
  } finally { handle.mock.restore(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});

test("settings retirement follows symlinks and is byte-idempotent once complete", () => {
  const dir = mkdtempSync(join(tmpdir(), "pst-preset-settings-"));
  const paths = { ...configPaths(dir, dir), user: join(dir, "user.json"), project: join(dir, "project.json"), map: join(dir, "map.json") };
  const target = join(dir, "target.json");
  writeFileSync(target, JSON.stringify({ version: 2, note: "keep", presets: {}, entries: { [key]: { active: true, serviceTier: "priority" } } }));
  symlinkSync(target, paths.user);
  try {
    let notices = 0;
    _test.removeLegacyPresetFiles(paths, () => notices++);
    assert.equal(notices, 1);
    assert.equal(readlinkSync(paths.user), target);
    const contents = readFileSync(target, "utf8");
    assert.equal(JSON.parse(contents).note, "keep");
    assert.equal(JSON.parse(contents).presets, undefined);
    _test.removeLegacyPresetFiles(paths, () => notices++);
    assert.equal(notices, 1);
    assert.equal(readFileSync(target, "utf8"), contents);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("failed settings cleanup leaves original bytes, no temporary file, and no removal notice", () => {
  const dir = mkdtempSync(join(tmpdir(), "pst-preset-fault-"));
  const paths = { user: join(dir, "user.json"), project: join(dir, "project.json"), map: join(dir, "map.json") };
  const original = JSON.stringify({ version: 2, presets: { note: "private fixture" }, entries: {} });
  writeFileSync(paths.user, original);
  const handle = mock.method(fs, "renameSync", () => { throw new Error("fixture write failure"); });
  syncBuiltinESMExports();
  try {
    let notices = 0;
    assert.throws(() => _test.removeLegacyPresetFiles(paths, () => notices++), ConfigFileError);
    assert.equal(readFileSync(paths.user, "utf8"), original);
    assert.deepEqual(readdirSync(dir), ["user.json"]);
    assert.equal(notices, 0);
  } finally { handle.mock.restore(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});
