import test from "node:test";
import assert from "node:assert/strict";
import { ModelRegistry, ModelRuntime, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model, Api, CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { currentAuthMode, currentSupportScope, isKnownAuthMode, sameSupportScope, type AuthMode, type SupportScope } from "./auth-scope.ts";
import { DEFAULT_MAP, mapSupportState, mapSupportsTier, markTierProbeResults, markTierSupported, markTierUnsupported, markTierUserMarked, migrateMapToCurrent, putRoute, routeEntry, type ServiceTierMapEntry } from "./support-map.ts";

const model = { provider: "openai", id: "gpt-5.5", api: "openai-responses" } as Model<Api>;
const apiKey: SupportScope = { ...model, authMode: "api_key" };
const oauth: SupportScope = { ...model, authMode: "oauth" };
const key = "openai/gpt-5.5";
const verified = { result: "supported" as const, kind: "verified" as const, payloadPrepared: true, requestCompleted: true, servedTier: "priority", updatedAt: "fixture" };
function entry(scope: SupportScope, extra: Record<string, unknown> = {}): ServiceTierMapEntry {
  return { ...scope, determined: true, tiers: ["priority"], source: "manual", updatedAt: "fixture", ...extra };
}
function registry(mode: AuthMode, source = "stored", configured = true): ExtensionContext["modelRegistry"] {
  return { hasConfiguredAuth: () => configured, isUsingOAuth: () => mode === "oauth", getProviderAuthStatus: () => ({ configured, source }),
    getProviderAuth: () => assert.fail("Auth detection must not resolve credentials"),
    getApiKeyAndHeaders: () => assert.fail("Auth detection must not read keys or headers"),
    refresh: () => assert.fail("Auth detection must not refresh or discover providers"),
  } as never;
}

test("auth scope reads only non-secret Pi metadata and includes the exact provider/model/API", () => {
  for (const mode of ["oauth", "api_key"] as const) {
    const ctx = { model, modelRegistry: registry(mode) };
    assert.equal(currentAuthMode(ctx.modelRegistry, model), mode);
    assert.deepEqual(currentSupportScope(ctx), { provider: model.provider, id: model.id, api: model.api, authMode: mode });
  }
  assert.equal(currentSupportScope({ model: undefined, modelRegistry: registry("api_key") }), undefined);
  for (const source of ["stored", "runtime", "environment", "models_json_key", "models_json_command"]) assert.equal(currentAuthMode(registry("api_key", source), model), "api_key");
});

test("false OAuth flags, absent/inconsistent metadata, unsupported sources and metadata errors remain unknown", () => {
  for (const source of ["fallback", "", "future-source"]) assert.equal(currentAuthMode(registry("api_key", source), model), "unknown");
  assert.equal(currentAuthMode(registry("oauth", "stored", false), model), "unknown");
  assert.equal(currentAuthMode({ isUsingOAuth: () => false } as never, model), "unknown");
  for (const malformed of [undefined, null, "false", 0]) {
    assert.equal(currentAuthMode({ ...registry("api_key"), isUsingOAuth: () => malformed } as never, model), "unknown");
  }
  for (const method of ["hasConfiguredAuth", "isUsingOAuth", "getProviderAuthStatus"]) {
    const broken = { ...registry("api_key"), [method]: () => { throw new Error("private fixture, never expose"); } };
    assert.equal(currentAuthMode(broken as never, model), "unknown");
  }
  assert.equal(isKnownAuthMode("unknown"), false);
  assert.equal(sameSupportScope(apiKey, oauth), false);
  assert.equal(sameSupportScope(apiKey, { ...apiKey, authMode: "unknown" }), false);
  assert.equal(sameSupportScope({ ...apiKey, authMode: "unknown" }, { ...apiKey, authMode: "unknown" }), false);
  assert.equal(sameSupportScope(apiKey, { ...apiKey, api: "openai-completions" }), false);
  assert.equal(sameSupportScope(apiKey, { ...apiKey }), true);
});

test("actual Pi 1.1.0 registry metadata distinguishes runtime API-key overrides from stored OAuth without network", async () => {
  const savedFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Live network forbidden"); };
  try {
    const fakeOAuth: OAuthCredential = { type: "oauth", access: "fixture-access-not-real", refresh: "fixture-refresh-not-real", expires: Date.now() + 3600000 };
    const credentials: CredentialStore = {
      read: async (provider) => provider === "openai" ? fakeOAuth : undefined,
      list: async () => [{ providerId: "openai", type: "oauth" }],
      modify: async () => assert.fail("Metadata checks must not refresh credentials"),
      delete: async () => assert.fail("Metadata checks must not remove credentials"),
    };
    const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    const models = new ModelRegistry(runtime);
    assert.equal(currentAuthMode(models, model), "unknown");
    await runtime.setRuntimeApiKey("openai", "sk-test-not-real");
    assert.equal(currentAuthMode(models, model), "api_key");
    await runtime.removeRuntimeApiKey("openai");
    assert.equal(currentAuthMode(models, model), "oauth");
    assert.equal(requests, 0);
  } finally { globalThis.fetch = savedFetch; }
});

for (const version of [1, 2, 3]) {
  test(`v${version} historical manual/probe/user-mark records retain history without adopting current authentication`, () => {
    for (const source of ["manual", "probe", "user-mark"] as const) {
      const historical = entry(oauth, { source, evidence: { priority: verified }, observations: { priority: verified }, note: "keep", authMode: undefined });
      const input = { version, entries: { [key]: version === 3 ? { routes: { [model.api]: historical } } : historical } };
      const before = JSON.stringify(input);
      const map = migrateMapToCurrent(input);
      const unknown = map.entries![key].routes[model.api].auth.unknown!;
      assert.equal(unknown.authMode, "unknown");
      assert.equal(unknown.source, source);
      assert.deepEqual(unknown.tiers, ["priority"]);
      assert.equal(unknown.note, "keep");
      assert.equal(routeEntry(map, oauth), undefined);
      assert.equal(routeEntry(map, apiKey), undefined);
      assert.equal(mapSupportsTier(map, key, "priority", oauth), false);
      assert.equal(mapSupportState(map, key, "priority", apiKey), "unknown");
      assert.deepEqual(migrateMapToCurrent(map), map);
      assert.equal(JSON.stringify(input), before);
    }
  });
}

test("optional authentication-like fields on old records never assign historical facts to a login", () => {
  const old = entry(oauth, { evidence: { priority: verified } });
  const map = migrateMapToCurrent({ version: 3, entries: { [key]: { routes: { [model.api]: old } } } });
  assert.equal(routeEntry(map, oauth), undefined);
  assert.equal(map.entries![key].routes[model.api].auth.unknown?.authMode, "unknown");
  assert.equal((map.entries![key].routes[model.api].auth.unknown?.preservedFields as Record<string, unknown>).authMode, "oauth");
});

test("every writer and evidence consumer requires an explicit matching known authentication mode", () => {
  let map = putRoute(DEFAULT_MAP, entry(oauth));
  const original = routeEntry(map, oauth)!;
  assert.equal(mapSupportsTier(map, key, "priority", oauth), true);
  assert.equal(mapSupportsTier(map, key, "priority", apiKey), false);
  assert.equal(routeEntry(map, model), undefined);
  map = markTierProbeResults(map, key, { priority: verified }, apiKey);
  assert.equal(mapSupportState(map, key, "priority", apiKey), "verified");
  assert.deepEqual(routeEntry(map, oauth), original);
  map = markTierUnsupported(map, key, "priority", "Invalid service_tier", apiKey);
  assert.equal(mapSupportsTier(map, key, "priority", apiKey), false);
  assert.equal(mapSupportsTier(map, key, "priority", oauth), true);
  map = markTierSupported(map, key, "flex", apiKey);
  assert.equal(mapSupportState(map, key, "flex", apiKey), "manual");
  assert.equal(mapSupportsTier(map, key, "flex", oauth), false);
  map = markTierUserMarked(map, key, "ultrafast", apiKey);
  assert.equal(routeEntry(map, apiKey)?.source, "user-mark");
  assert.deepEqual(routeEntry(map, oauth), original);
  for (const unknown of [model, { ...model, authMode: "unknown" as const }]) {
    assert.deepEqual(markTierProbeResults(map, key, { priority: verified }, unknown), map);
    assert.deepEqual(markTierSupported(map, key, "priority", unknown), map);
    assert.deepEqual(markTierUnsupported(map, key, "priority", undefined, unknown), map);
    assert.deepEqual(markTierUserMarked(map, key, "priority", unknown), map);
  }
});

test("known auth slots coexist with old unknown and unrelated API records without fallback or overwrite", () => {
  const old = entry({ ...model, authMode: undefined }, { observations: { priority: verified } });
  let map = migrateMapToCurrent({ version: 3, entries: { [key]: { note: "keep", routes: { [model.api]: old } } } });
  const original = map.entries![key].routes[model.api].auth.unknown;
  map = putRoute(map, entry(apiKey));
  map = putRoute(map, entry(oauth, { tiers: ["default"] }));
  map = putRoute(map, entry({ ...apiKey, api: "openai-completions" }));
  assert.deepEqual(map.entries![key].routes[model.api].auth.unknown, original);
  assert.equal(map.entries![key].note, "keep");
  assert.equal(mapSupportsTier(map, key, "priority", apiKey), true);
  assert.equal(mapSupportsTier(map, key, "priority", oauth), false);
  assert.equal(mapSupportsTier(map, key, "default", oauth), true);
  assert.deepEqual(migrateMapToCurrent(map), map);
});

test("auth-container mismatches, unknown mode names and prototype-shaped slots are quarantined without pollution", () => {
  const input = { version: 3, entries: { [key]: { routes: { [model.api]: { auth: {
    oauth: entry(apiKey), future: entry(oauth),
  } } } } } };
  const map = migrateMapToCurrent(input);
  assert.equal(routeEntry(map, oauth), undefined);
  assert.equal(map.entries![key].legacy?.length, 2);
  assert.deepEqual(migrateMapToCurrent(map), map);
  const hostile = JSON.parse(`{"version":3,"entries":{"${key}":{"routes":{"__proto__":{"auth":{"__proto__":{"polluted":true}}}}}}}`);
  const safe = migrateMapToCurrent(hostile);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(migrateMapToCurrent(safe), safe);
});
