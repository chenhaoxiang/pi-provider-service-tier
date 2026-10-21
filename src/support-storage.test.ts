import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configPaths, _test, resolveEffectiveConfig } from "./index.ts";
import { MapFileError, markTierSupported, migrateMapToCurrent, readMap, writeMap } from "./support-map.ts";
import { ensureSupportStorage } from "./support-storage.ts";
import { removeLegacyPresetData } from "./legacy-presets.ts";

const model = { provider: "openai", id: "gpt-review", api: "openai-responses", authMode: "api_key" as const };
const key = "openai/gpt-review";
const record = { ...model, determined: true, tiers: ["priority"], source: "manual", updatedAt: "fixture" };
const legacy = { version: 2, entries: { [key]: record } };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pst-storage-"));
  return { dir, paths: { map: join(dir, "map-v3.json"), legacyMap: join(dir, "map.json") }, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test("schema generations own distinct support files", () => {
  const paths = configPaths("/project", "/home");
  assert.ok(paths.map.endsWith("pi-provider-service-tier-map-v3.json"));
  assert.ok(paths.legacyMap?.endsWith("pi-provider-service-tier-map.json"));
  assert.notEqual(paths.map, paths.legacyMap);
});

test("imports legacy data once without changing bytes or assigning historical authentication", () => {
  const f = fixture();
  try {
    const bytes = JSON.stringify(legacy, null, 4);
    writeFileSync(f.paths.legacyMap, bytes);
    const initial = ensureSupportStorage(f.paths);
    assert.equal(initial.version, 3);
    assert.deepEqual(initial.entries?.[key].routes[model.api].auth.unknown?.tiers, ["priority"]);
    assert.equal(initial.entries?.[key].routes[model.api].auth.api_key, undefined);
    assert.equal(readFileSync(f.paths.legacyMap, "utf8"), bytes);
    assert.deepEqual(readdirSync(f.dir).sort(), ["map-v3.json", "map.json"]);
  } finally { f.close(); }
});

test("legacy writes and package-selection downgrade cannot overwrite isolated new facts", () => {
  const f = fixture();
  try {
    writeFileSync(f.paths.legacyMap, JSON.stringify(legacy));
    ensureSupportStorage(f.paths);
    writeMap(f.paths.map, markTierSupported(readMap(f.paths.map), key, "flex", model));
    const newBytes = readFileSync(f.paths.map, "utf8");
    // A genuine legacy writer continues replacing only its own path, including resets.
    for (const old of [{ version: 2, entries: {} }, legacy]) {
      writeFileSync(f.paths.legacyMap, JSON.stringify(old));
      ensureSupportStorage(f.paths);
      assert.equal(readFileSync(f.paths.map, "utf8"), newBytes);
    }
    assert.deepEqual(readMap(f.paths.map)?.entries?.[key].routes[model.api].auth.api_key?.tiers, ["flex"]);
  } finally { f.close(); }
});

test("a preexisting v3 legacy-path map is imported with API/auth records intact", () => {
  const f = fixture();
  try {
    const map = markTierSupported({}, key, "priority", model);
    const bytes = JSON.stringify(map);
    writeFileSync(f.paths.legacyMap, bytes);
    assert.deepEqual(ensureSupportStorage(f.paths), map);
    assert.equal(readFileSync(f.paths.legacyMap, "utf8"), bytes);
  } finally { f.close(); }
});

test("bad legacy data is retained and does not leave an empty canonical file masking recovery", () => {
  const f = fixture();
  try {
    writeFileSync(f.paths.legacyMap, "{broken");
    assert.throws(() => ensureSupportStorage(f.paths), MapFileError);
    assert.deepEqual(readdirSync(f.dir), ["map.json"]);
    writeFileSync(f.paths.legacyMap, JSON.stringify(legacy));
    assert.equal(ensureSupportStorage(f.paths).version, 3);
  } finally { f.close(); }
});

test("an existing canonical store never consults later corrupt legacy data", () => {
  const f = fixture();
  try {
    ensureSupportStorage(f.paths);
    const bytes = readFileSync(f.paths.map, "utf8");
    writeFileSync(f.paths.legacyMap, "{broken");
    assert.equal(ensureSupportStorage(f.paths).version, 3);
    assert.equal(readFileSync(f.paths.map, "utf8"), bytes);
  } finally { f.close(); }
});

test("a canonical symlink to the legacy store is refused, not migrated in place", () => {
  const f = fixture();
  try {
    const bytes = JSON.stringify(legacy);
    writeFileSync(f.paths.legacyMap, bytes);
    symlinkSync(f.paths.legacyMap, f.paths.map);
    assert.throws(() => ensureSupportStorage(f.paths), MapFileError);
    assert.equal(readFileSync(f.paths.legacyMap, "utf8"), bytes);
  } finally { f.close(); }
});

for (const kind of [{ toString: "not-a-function" }, { valueOf: 0 }, null, []]) test(`malformed preset proof kinds normalize without coercion: ${JSON.stringify(kind)}`, () => {
  const input = { version: 3, entries: { [key]: { routes: { [model.api]: { auth: { api_key: { ...record, source: "preset", evidence: { priority: { kind } }, observations: { priority: { kind } } } } } } } } };
  assert.doesNotThrow(() => removeLegacyPresetData(input, "map"));
});

test("default footer never treats imported served-tier controls as terminal markup", () => {
  const map = { version: 3, entries: { [key]: { routes: { [model.api]: { auth: { api_key: { ...record, observations: { priority: { kind: "fallback", servedTier: "\u001b[31mspoof\u001b[0m" } } } } } } } } };
  const paths = configPaths("/project", "/home");
  const config = { ...resolveEffectiveConfig("/nonexistent-pst-fixture", "/nonexistent-pst-home"), paths, entries: { [key]: { active: true, serviceTier: "priority" as const } } };
  const status = _test.statusText(config, migrateMapToCurrent(map), model as never, model);
  assert.match(status ?? "", /probe-fallback→unknown/);
  assert.equal(status?.includes("\u001b"), false);
});
