import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAP, MapFileError, ensureMap, mapSupportsTier, mapSupportState, markTierProbeResults, markTierUnsupported, migrateMapToCurrent, putRoute, readMap, routeEntry, writeMap } from "./support-map.ts";
import { type RouteIdentity } from "./service-tiers.ts";
import { type ProbeTierObservation } from "./probe-evidence.ts";

const responses: RouteIdentity = { provider: "openai", id: "gpt-5.5", api: "openai-responses" };
const completions: RouteIdentity = { ...responses, api: "openai-completions" };
const key = "openai/gpt-5.5";
const timestamp = "2026-10-12T04:33:41Z";
function oldRecord(extra: Record<string, unknown> = {}) {
  return { ...responses, determined: true, tiers: ["priority"], source: "manual", updatedAt: timestamp, ...extra };
}
function oldMap(extra: Record<string, unknown> = {}) { return { version: 2, entries: { [key]: oldRecord(extra) } }; }
function withMap(contents: string, action: (path: string, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "pst-support-v3-"));
  const path = join(dir, "pi-provider-service-tier-map.json");
  writeFileSync(path, contents);
  try { action(path, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const verified: ProbeTierObservation = { result: "supported", kind: "verified", payloadPrepared: true, requestCompleted: true, servedTier: "priority", updatedAt: timestamp };

test("v1, v2, versionless and incomplete metadata migrate forward without guessing API or dropping unrelated fields", () => {
  for (const version of [undefined, 1, 2, "two", 0]) {
    const original = { version, note: "retained", entries: {
      [key]: oldRecord({ source: "manual", tiers: ["priority", "priority", "unknown-tier"], updatedAt: 42 }),
      "openai/without-api": { provider: "openai", id: "without-api", tiers: ["priority"], source: "probe", extra: true },
      "openai/malformed": null,
      "invalid-key": { keep: "exactly" },
    } };
    const snapshot = JSON.stringify(original);
    const map = migrateMapToCurrent(original);
    assert.equal(map.version, 3);
    assert.equal(map.note, "retained");
    assert.deepEqual(routeEntry(map, responses)?.tiers, ["priority"]);
    assert.deepEqual(routeEntry(map, responses)?.preservedFields, { tiers: ["priority", "priority", "unknown-tier"], updatedAt: 42 });
    assert.deepEqual(map.entries?.["openai/without-api"].legacy, [original.entries["openai/without-api"]]);
    assert.deepEqual(map.entries?.["openai/malformed"].legacy, [null]);
    assert.deepEqual(map.preserved?.["invalid-key"], { keep: "exactly" });
    assert.equal(routeEntry(map, { ...responses, id: "without-api" }), undefined);
    assert.equal(JSON.stringify(original), snapshot);
    assert.deepEqual(migrateMapToCurrent(map), map);
  }
});

test("missing containers, non-object roots and malformed route records are preserved rather than failing migration", () => {
  for (const input of [null, [], 12, "text", { entries: null }, { entries: [] }, { entries: "bad" }]) {
    const map = migrateMapToCurrent(input);
    assert.equal(map.version, 3);
    assert.deepEqual(map.entries, {});
    assert.ok(map.preserved);
    assert.deepEqual(migrateMapToCurrent(map), map);
  }
  const map = migrateMapToCurrent({ version: 3, entries: { [key]: { routes: { "openai-responses": null, "": oldRecord() }, legacy: "old" } } });
  assert.equal(routeEntry(map, responses), undefined);
  assert.equal(map.entries?.[key].legacy?.length, 3);
  assert.deepEqual(migrateMapToCurrent(map), map);
});

test("provider/model/API mismatches are quarantined, not adopted as evidence or rejected as a whole file", () => {
  for (const wrong of [oldRecord({ provider: "xai" }), oldRecord({ id: "other-model" }), oldRecord({ api: "openai-completions" })]) {
    const map = migrateMapToCurrent({ version: 3, entries: { [key]: { routes: { "openai-responses": wrong } } } });
    assert.equal(routeEntry(map, responses), undefined);
    assert.deepEqual(map.entries?.[key].legacy, [{ api: "openai-responses", record: wrong }]);
  }
});

test("normalized-key collisions and prototype-shaped data are retained without pollution", () => {
  const map = migrateMapToCurrent(JSON.parse(`{"version":2,"entries":{"${key}":${JSON.stringify(oldRecord())}," openai / gpt-5.5 ":${JSON.stringify(oldRecord({ extra: true }))},"__proto__":{"polluted":true}}}`));
  assert.equal(map.entries?.[key].legacy?.length, 1);
  assert.deepEqual(map.preserved?.["__proto__"], { polluted: true });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("API scopes are checked for positives, negatives and all record writers, and unrelated API slots survive", () => {
  const a = migrateMapToCurrent(oldMap());
  assert.equal(mapSupportsTier(a, key, "priority", responses), true);
  assert.equal(mapSupportState(a, key, "priority", responses), "manual");
  assert.equal(mapSupportsTier(a, key, "priority", completions), false);
  assert.equal(mapSupportsTier(a, key, "priority"), false);
  assert.equal(mapSupportState(a, key, "priority", completions), "unknown");
  const b = markTierProbeResults(a, key, { priority: verified }, completions);
  assert.deepEqual(b.entries?.[key].routes[responses.api!], a.entries?.[key].routes[responses.api!]);
  assert.equal(mapSupportState(b, key, "priority", completions), "verified");
  const c = markTierUnsupported(b, key, "priority", "Invalid service_tier", completions);
  assert.deepEqual(c.entries?.[key].routes[responses.api!], a.entries?.[key].routes[responses.api!]);
  assert.equal(mapSupportsTier(c, key, "priority", completions), false);
  assert.equal(mapSupportsTier(c, key, "priority", responses), true);
  assert.deepEqual(markTierUnsupported(c, key, "priority"), c);
});

test("old acceptance-only probe records are not promoted even if old optional fields resemble new proof", () => {
  const input = oldMap({ source: "probe", evidence: { priority: verified }, observations: { priority: verified } });
  const map = migrateMapToCurrent(input);
  assert.equal(mapSupportsTier(map, key, "priority", responses), false);
  assert.equal(mapSupportState(map, key, "priority", responses), "unknown");
  assert.equal(routeEntry(map, responses)?.evidence?.priority?.kind, "legacy");
  assert.ok(routeEntry(map, responses)?.previousEvidence);
  assert.deepEqual(routeEntry(map, responses)?.tiers, ["priority"]);
});

test("unverifiable proof and unknown source metadata normalize to unknown without causing failure", () => {
  for (const badEvidence of [{ ...verified, payloadPrepared: false }, { ...verified, servedTier: "default" }, { kind: "verified" }, "broken"]) {
    const map = putRoute(DEFAULT_MAP, oldRecord({ source: "probe", evidence: { priority: badEvidence } }) as never);
    assert.equal(mapSupportsTier(map, key, "priority", responses), false);
  }
  const badSource = migrateMapToCurrent(oldMap({ source: "proeb" }));
  assert.equal(mapSupportsTier(badSource, key, "priority", responses), false);
  assert.equal(routeEntry(badSource, responses)?.preservedFields && (routeEntry(badSource, responses)!.preservedFields as Record<string, unknown>).source, "proeb");
});

test("completion/fallback observations do not manufacture support or erase manual/verified facts", () => {
  const completion: ProbeTierObservation = { result: "unknown", kind: "request-completed", payloadPrepared: true, requestCompleted: true, updatedAt: timestamp };
  let map = markTierProbeResults(DEFAULT_MAP, key, { priority: completion }, responses);
  assert.equal(mapSupportsTier(map, key, "priority", responses), false);
  assert.equal(mapSupportState(map, key, "priority", responses), "request-completed");
  map = markTierProbeResults(migrateMapToCurrent(oldMap()), key, { priority: completion }, responses);
  assert.equal(mapSupportsTier(map, key, "priority", responses), true);
  assert.equal(mapSupportState(map, key, "priority", responses), "request-completed");
  const fallback: ProbeTierObservation = { ...completion, kind: "fallback", servedTier: "default" };
  map = markTierProbeResults(map, key, { priority: fallback }, responses);
  assert.equal(mapSupportState(map, key, "priority", responses), "fallback");
  assert.equal(routeEntry(map, responses)?.evidence?.priority?.kind, "manual");
  assert.equal(routeEntry(map, responses)?.unsupportedTiers?.includes("priority") ?? false, false);
});

test("unknown or malformed fields do not prevent a real clean migration, and the original bytes are backed up", () => {
  const original = JSON.stringify({ ...oldMap({ updatedAt: null, source: "typo" }), extra: { retain: true } }, null, 1);
  withMap(original, (path, dir) => {
    const map = ensureMap(path);
    assert.equal(map.version, 3);
    assert.equal(readFileSync(`${path}.v2.backup`, "utf8"), original);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 3);
    const bytes = readFileSync(path, "utf8");
    assert.deepEqual(ensureMap(path), map);
    assert.equal(readFileSync(path, "utf8"), bytes);
    assert.ok(readdirSync(dir).every((file) => !file.endsWith(".tmp")));
  });
});

test("an existing optional backup is not a migration failure and is never overwritten", () => {
  withMap(JSON.stringify(oldMap()), (path) => {
    writeFileSync(`${path}.v2.backup`, "prior-backup");
    ensureMap(path);
    assert.equal(readFileSync(`${path}.v2.backup`, "utf8"), "prior-backup");
    assert.equal(readMap(path)?.version, 3);
  });
});

test("support-map symlinks remain symlinks while the target is safely upgraded", () => {
  withMap(JSON.stringify(oldMap()), (path, dir) => {
    const link = join(dir, "alias.json");
    symlinkSync(path, link);
    ensureMap(link);
    assert.equal(readlinkSync(link), path);
    assert.equal(readMap(path)?.version, 3);
  });
});

test("unreadable, broken JSON and unsupported future files cannot be reset or overwritten", () => {
  for (const original of ["{ private-content: broken", JSON.stringify({ version: 4, entries: { private: true } }), JSON.stringify({ version: "4", entries: { private: true } })]) {
    withMap(original, (path) => {
      for (const action of [() => readMap(path), () => ensureMap(path), () => writeMap(path, DEFAULT_MAP)]) {
        assert.throws(action, (error: unknown) => error instanceof MapFileError && !error.message.includes("private-content"));
        assert.equal(readFileSync(path, "utf8"), original);
      }
    });
  }
  withMap(JSON.stringify(oldMap()), (_path, dir) => {
    const link = join(dir, "dangling.json");
    symlinkSync(join(dir, "absent.json"), link);
    assert.throws(() => ensureMap(link), MapFileError);
    assert.equal(readlinkSync(link), join(dir, "absent.json"));
    assert.equal(existsSync(join(dir, "absent.json")), false);
    assert.throws(() => ensureMap(dir), MapFileError);
  });
});

test("a genuine atomic replacement failure preserves original bytes and removes temporary files", () => {
  withMap(JSON.stringify(oldMap()), (path, dir) => {
    const original = readFileSync(path, "utf8");
    const patch = mock.method(fs, "renameSync", () => { throw Object.assign(new Error("fake disk error"), { code: "EIO" }); });
    syncBuiltinESMExports();
    try {
      assert.throws(() => ensureMap(path), MapFileError);
      assert.equal(readFileSync(path, "utf8"), original);
      assert.ok(readdirSync(dir).every((file) => !file.endsWith(".tmp")));
    } finally { patch.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(ensureMap(path).version, 3);
  });
});

test("optional backup failure warns but does not reject an otherwise safe normal upgrade", () => {
  withMap(JSON.stringify(oldMap()), (path) => {
    const originalWrite = fs.writeFileSync;
    const warnings: string[] = [];
    const warning = mock.method(console, "warn", (message: string) => warnings.push(message));
    const patch = mock.method(fs, "writeFileSync", ((target: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(target).endsWith(".v2.backup")) throw Object.assign(new Error("optional backup unavailable"), { code: "EACCES" });
      return Reflect.apply(originalWrite, fs, [target, ...args]);
    }) as typeof fs.writeFileSync);
    syncBuiltinESMExports();
    try {
      assert.equal(ensureMap(path).version, 3);
      assert.equal(mapSupportState(readMap(path), key, "priority", responses), "manual");
      assert.equal(warnings.length, 1);
    } finally { patch.mock.restore(); warning.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("a second session completing the identical normalized upgrade does not cause a false failure", () => {
  withMap(JSON.stringify(oldMap()), (path) => {
    const migrated = migrateMapToCurrent(oldMap());
    const originalWrite = fs.writeFileSync;
    const patch = mock.method(fs, "writeFileSync", ((target: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      const result = Reflect.apply(originalWrite, fs, [target, ...args]);
      if (String(target).endsWith(".tmp")) originalWrite(path, JSON.stringify(migrated));
      return result;
    }) as typeof fs.writeFileSync);
    syncBuiltinESMExports();
    try {
      assert.deepEqual(ensureMap(path), migrated);
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), migrated);
    } finally { patch.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("a concurrent writer is detected before replacement rather than silently overwritten", () => {
  withMap(JSON.stringify(oldMap()), (path) => {
    const replacement = JSON.stringify({ ...oldMap(), concurrent: true });
    const originalWrite = fs.writeFileSync;
    const patch = mock.method(fs, "writeFileSync", ((target: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      const result = Reflect.apply(originalWrite, fs, [target, ...args]);
      if (String(target).endsWith(".tmp")) originalWrite(path, replacement);
      return result;
    }) as typeof fs.writeFileSync);
    syncBuiltinESMExports();
    try {
      assert.throws(() => ensureMap(path), (error: unknown) => error instanceof MapFileError && error.reason === "changed");
      assert.equal(readFileSync(path, "utf8"), replacement);
    } finally { patch.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(ensureMap(path).concurrent, true);
  });
});
