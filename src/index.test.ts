import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  SERVICE_TIERS,
  UNKNOWN_MODEL_BEHAVIORS,
  _test,
  buildPresetMapEntry,
  configPaths,
  ensureConfig,
  ensureMap,
  isServiceTier,
  isUnsupportedServiceTierError,
  isUnknownModelBehavior,
  mapSupportsTier,
  mapSupportState,
  markTierProbeResults,
  markTierUnsupported,
  markTierSupported,
  mergeConfigs,
  modelKey,
  parseModelKey,
  presetTiersForModel,
  readConfig,
  readMap,
  resolveEffectiveConfig,
  resolveTierForModel,
  setScopedEntry,
  setScopedUnknownModelBehavior,
  writeConfig,
  writeMap,
  type ConfigFile,
  type ServiceTierMapFile,
} from "./index.ts";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import piServiceTier from "./index.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-provider-service-tier-"));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const openAIModel = {
  provider: "openai",
  id: "gpt-5.5",
  api: "openai-responses",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
} as never;

const codexModel = {
  provider: "openai-codex",
  id: "gpt-5.5",
  api: "openai-codex-responses",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
} as never;

const ultrafastModel = {
  ...openAIModel as object,
  provider: "openai",
  id: "gpt-6-astra",
  api: "openai-responses",
} as never;

const DOCUMENTED_GPT_55_TIERS = ["priority", "flex", "default", "auto", "fast"];

// Models without bundled presets remain useful fixtures for unknown-provider behavior.
const opencodeQwenModel = {
  provider: "opencode-go",
  id: "qwen3.5-plus",
  api: "openai-completions",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
} as never;

const opencodeMinimaxModel = {
  provider: "opencode-go",
  id: "minimax-m2.5",
  api: "anthropic-messages",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
} as never;

function createExtensionHarness(cwd: string, home: string, model: never = openAIModel, available: never[] = [openAIModel]) {
  const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> | void }>();
  const handlers = new Map<string, (event: never, ctx: never) => Promise<unknown> | unknown>();
  const notifications: Array<{ message: string; type?: string }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const selections: string[] = [];
  const prompts: string[] = [];
  const ctx = {
    cwd,
    model,
    modelRegistry: {
      getAvailable: () => available,
    },
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
      setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
      addAutocompleteProvider: () => undefined,
      select: async (message: string) => {
        prompts.push(message);
        return selections.shift();
      },
    },
  } as never;
  const pi = {
    registerCommand: (name: string, options: { handler: (args: string, ctx: never) => Promise<void> | void }) => {
      commands.set(name, options);
    },
    on: (name: string, handler: (event: never, ctx: never) => Promise<unknown> | unknown) => {
      handlers.set(name, handler);
    },
  } as never;
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  piServiceTier(pi);
  return {
    commands,
    handlers,
    ctx,
    notifications,
    statuses,
    selections,
    prompts,
    restore: () => {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    },
  };
}

test("recognizes known service tiers", () => {
  for (const tier of SERVICE_TIERS) assert.equal(isServiceTier(tier), true);
  assert.equal(isServiceTier("fast"), true);
  assert.equal(isServiceTier("ultrafast"), true);
  assert.equal(isServiceTier("turbo"), false);
  for (const behavior of UNKNOWN_MODEL_BEHAVIORS) assert.equal(isUnknownModelBehavior(behavior), true);
  assert.equal(isUnknownModelBehavior("prompt"), false);
});

test("parses and formats provider/model keys", () => {
  assert.deepEqual(parseModelKey("openai/gpt-5.5"), { provider: "openai", id: "gpt-5.5" });
  assert.equal(parseModelKey("openai"), undefined);
  assert.equal(modelKey(openAIModel), "openai/gpt-5.5");
});

test("creates default config and map files", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    ensureConfig(paths.project);
    ensureConfig(paths.user);
    ensureMap(paths.map);
    assert.equal(existsSync(paths.project), true);
    assert.equal(existsSync(paths.user), true);
    assert.equal(existsSync(paths.map), true);
    assert.equal(readConfig(paths.project)?.version, 2);
    assert.equal(readMap(paths.map)?.version, 2);
    assert.deepEqual(readConfig(paths.project)?.entries, {});
    assert.deepEqual(readMap(paths.map)?.entries, {});
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("ignores malformed JSON and invalid entries", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.user), { recursive: true });
    writeFileSync(paths.user, "{ bad json", "utf8");
    assert.equal(readConfig(paths.user), undefined);

    writeFileSync(
      paths.user,
      JSON.stringify({
        aggressiveProbe: true,
        unknownModelBehavior: "turbo",
        entries: { "bad": { active: true }, "openai/gpt-5.5": { active: true, serviceTier: "turbo" } },
      }),
      "utf8",
    );
    const config = readConfig(paths.user);
    assert.equal(config?.unknownModelBehavior, undefined);
    assert.deepEqual(config?.entries, { "openai/gpt-5.5": { active: true } });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("fast and ultrafast survive config and support-map round trips", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    for (const tier of ["fast", "ultrafast"] as const) {
      setScopedEntry(paths, "project", "openai/gpt-6-astra", { active: true, serviceTier: tier });
      assert.equal(readConfig(paths.project)?.entries?.["openai/gpt-6-astra"].serviceTier, tier);
    }
    writeMap(paths.map, { entries: { "openai/gpt-6-astra": buildPresetMapEntry(ultrafastModel) } });
    const map = readMap(paths.map);
    assert.equal(mapSupportsTier(map, "openai/gpt-6-astra", "fast"), true);
    assert.equal(mapSupportsTier(map, "openai/gpt-6-astra", "ultrafast"), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("merges user and project config by provider/model key", () => {
  const paths = configPaths("/repo", "/home/user");
  const userConfig: ConfigFile = {
    unknownModelBehavior: "auto-probe",
    entries: {
      "openai/gpt-5.5": { active: true, serviceTier: "flex" },
      "openai/gpt-4.1": { active: true, serviceTier: "priority" },
    },
  };
  const projectConfig: ConfigFile = {
    entries: {
      "openai/gpt-5.5": { active: false },
    },
  };
  const effective = mergeConfigs(userConfig, projectConfig, paths);
  assert.equal(effective.unknownModelBehavior, "auto-probe");
  assert.deepEqual(effective.entries["openai/gpt-5.5"], { active: false, serviceTier: "flex" });
  assert.deepEqual(effective.entries["openai/gpt-4.1"], { active: true, serviceTier: "priority" });
});

test("project unknown behavior overrides user unknown behavior", () => {
  const paths = configPaths("/repo", "/home/user");
  assert.equal(
    mergeConfigs({ unknownModelBehavior: "auto-probe" }, { unknownModelBehavior: "leave-unknown" }, paths)
      .unknownModelBehavior,
    "leave-unknown",
  );
});

test("setScopedEntry writes provider/model entries", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    setScopedEntry(paths, "project", "openai/gpt-5.5", { active: true, serviceTier: "priority" });
    assert.deepEqual(readConfig(paths.project)?.entries?.["openai/gpt-5.5"], { active: true, serviceTier: "priority" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("setScopedUnknownModelBehavior writes unknown behavior without dropping entries", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    setScopedEntry(paths, "project", "openai/gpt-5.5", { active: true, serviceTier: "priority" });
    setScopedUnknownModelBehavior(paths, "project", "auto-probe");
    const config = readConfig(paths.project);
    assert.equal(config?.unknownModelBehavior, "auto-probe");
    assert.deepEqual(config?.entries?.["openai/gpt-5.5"], { active: true, serviceTier: "priority" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolves effective config from files", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    writeConfig(paths.user, { entries: { "openai/gpt-5.5": { active: true, serviceTier: "priority" } } });
    writeConfig(paths.project, { entries: { "openai/gpt-5.5": { serviceTier: "flex" } } });
    const effective = resolveEffectiveConfig(cwd, home);
    assert.deepEqual(effective.entries["openai/gpt-5.5"], { active: true, serviceTier: "flex" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("migrates config writes to v2 and drops legacy aggressiveProbe", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.user), { recursive: true });
    writeFileSync(
      paths.user,
      JSON.stringify({ version: 1, aggressiveProbe: true, entries: { "openai/gpt-5.5": { active: true, serviceTier: "priority" } } }),
      "utf8",
    );
    const config = readConfig(paths.user);
    assert.equal(config?.version, 2);
    assert.equal(config?.unknownModelBehavior, undefined);
    const rawBeforeStartup = JSON.parse(readFileSync(paths.user, "utf8")) as Record<string, unknown>;
    assert.equal(rawBeforeStartup.version, 1);
    assert.equal(rawBeforeStartup.aggressiveProbe, true);
    _test.migrateStartupFiles(paths);
    const rawAfterStartup = JSON.parse(readFileSync(paths.user, "utf8")) as Record<string, unknown>;
    assert.equal(rawAfterStartup.version, 2);
    assert.equal("aggressiveProbe" in rawAfterStartup, false);
    writeConfig(paths.user, config ?? {});
    const written = readConfig(paths.user);
    assert.equal(written?.version, 2);
    assert.equal(written?.unknownModelBehavior, undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("migrates v1 map by renaming supported to determined and preserving unknown entries", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.map), { recursive: true });
    writeFileSync(
      paths.map,
      JSON.stringify({
        version: 1,
        entries: {
          "openai/gpt-5.5": buildPresetMapEntry(openAIModel),
          "openai/gpt-legacy": {
            provider: "openai",
            id: "gpt-legacy",
            api: "openai-responses",
            supported: true,
            tiers: ["priority"],
            source: "preset",
            updatedAt: new Date().toISOString(),
          },
          "openai/gpt-old": {
            provider: "openai",
            id: "gpt-old",
            determined: false,
            tiers: [],
            source: "error",
            updatedAt: new Date().toISOString(),
          },
        },
      }),
      "utf8",
    );
    const map = readMap(paths.map);
    assert.equal(map?.version, 2);
    assert.equal(Boolean(map?.entries?.["openai/gpt-5.5"]), true);
    assert.equal(map?.entries?.["openai/gpt-legacy"].determined, true);
    assert.equal("supported" in (map?.entries?.["openai/gpt-legacy"] ?? {}), false);
    assert.equal(map?.entries?.["openai/gpt-old"].determined, false);
    assert.equal(map?.entries?.["openai/gpt-old"].source, "error");
    const rawBeforeStartup = JSON.parse(readFileSync(paths.map, "utf8")) as { version?: number; entries?: Record<string, Record<string, unknown>> };
    assert.equal(rawBeforeStartup.version, 1);
    assert.equal(rawBeforeStartup.entries?.["openai/gpt-legacy"]?.supported, true);
    _test.migrateStartupFiles(paths);
    const rawAfterStartup = JSON.parse(readFileSync(paths.map, "utf8")) as { version?: number; entries?: Record<string, Record<string, unknown>> };
    assert.equal(rawAfterStartup.version, 2);
    assert.equal(rawAfterStartup.entries?.["openai/gpt-legacy"]?.determined, true);
    assert.equal("supported" in (rawAfterStartup.entries?.["openai/gpt-legacy"] ?? {}), false);
    assert.equal(rawAfterStartup.entries?.["openai/gpt-old"]?.determined, false);
    assert.equal(rawAfterStartup.entries?.["openai/gpt-old"]?.source, "error");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("uses model-specific OpenAI presets and a separate legacy copy without provider-wide fallbacks", () => {
  assert.deepEqual(presetTiersForModel(openAIModel), DOCUMENTED_GPT_55_TIERS);
  assert.deepEqual(presetTiersForModel(codexModel), DOCUMENTED_GPT_55_TIERS);
  assert.deepEqual(presetTiersForModel(ultrafastModel), [...DOCUMENTED_GPT_55_TIERS, "ultrafast"]);
  assert.deepEqual(presetTiersForModel(opencodeQwenModel), []);
  assert.deepEqual(presetTiersForModel({ provider: "openai", id: "unverified-model", api: "openai-responses" } as never), []);
  assert.deepEqual(presetTiersForModel({ provider: "openai-codex", id: "unverified-model", api: "openai-codex-responses" } as never), []);
  assert.deepEqual(presetTiersForModel({ provider: "openai", id: "gpt-5.5", api: "openai-completions" } as never), []);
  assert.deepEqual(presetTiersForModel(opencodeMinimaxModel), []);
  assert.deepEqual(presetTiersForModel({ provider: "anthropic", api: "anthropic-messages" } as never), []);

  const entry = buildPresetMapEntry(codexModel);
  assert.equal(entry.determined, true);
  assert.equal(entry.source, "preset");
  assert.deepEqual(entry.tiers, DOCUMENTED_GPT_55_TIERS);
  assert.equal(entry.unsupportedTiers, undefined);

  const minimaxEntry = buildPresetMapEntry(opencodeMinimaxModel);
  assert.equal(minimaxEntry.determined, false);
  assert.deepEqual(minimaxEntry.tiers, []);
});

test("bundled presets have equivalent initial support with distinct provider/API identities", () => {
  const openai = JSON.parse(readFileSync(new URL("../presets/openai.json", import.meta.url), "utf8")) as ServiceTierMapFile;
  const codex = JSON.parse(readFileSync(new URL("../presets/openai-codex.json", import.meta.url), "utf8")) as ServiceTierMapFile;
  assert.equal(openai.version, 2);
  assert.equal(codex.version, 2);
  assert.ok(Object.keys(openai.entries ?? {}).length > 0);
  assert.equal(Object.keys(openai.entries ?? {}).length, Object.keys(codex.entries ?? {}).length);
  for (const [key, entry] of Object.entries(openai.entries ?? {})) {
    assert.equal(key, `openai/${entry.id}`);
    assert.equal(entry.provider, "openai");
    assert.equal(entry.api, "openai-responses");
    assert.equal(entry.source, "preset");
    assert.equal(entry.tiers.every(isServiceTier), true);
    assert.equal(new Set(entry.tiers).size, entry.tiers.length);
    assert.equal(entry.unsupportedTiers, undefined);
    assert.deepEqual(codex.entries?.[`openai-codex/${entry.id}`], {
      ...entry, provider: "openai-codex", api: "openai-codex-responses",
    });
  }
  assert.deepEqual(
    Object.values(openai.entries ?? {}).filter((entry) => entry.tiers.includes("ultrafast")).map((entry) => entry.id).sort(),
    ["gpt-6-astra", "gpt-6.1-sol"],
  );
  assert.equal(existsSync(new URL("../presets/opencode-go.json", import.meta.url)), false);
});

test("presets do not infer account-dependent or absent tiers and return defensive copies", () => {
  const sol = buildPresetMapEntry({ provider: "openai", id: "gpt-5.6-sol", api: "openai-responses" } as never);
  assert.equal(sol.tiers.includes("ultrafast"), false);
  assert.equal(sol.unsupportedTiers?.includes("ultrafast") ?? false, false);
  assert.equal(buildPresetMapEntry(openAIModel).tiers.includes("scale"), false);
  const gpt41 = presetTiersForModel({ provider: "openai", id: "gpt-4.1", api: "openai-responses" } as never);
  assert.deepEqual(gpt41, ["priority", "default", "auto", "fast"]);
  const tiers = presetTiersForModel(openAIModel);
  tiers.splice(0);
  assert.deepEqual(presetTiersForModel(openAIModel), DOCUMENTED_GPT_55_TIERS);
  const entry = buildPresetMapEntry(codexModel);
  entry.tiers.splice(0);
  assert.deepEqual(buildPresetMapEntry(codexModel).tiers, DOCUMENTED_GPT_55_TIERS);
});

test("injects only when active and map-supported", () => {
  const paths = configPaths("/repo", "/home/user");
  const config = mergeConfigs(
    { entries: { "openai/gpt-5.5": { active: true, serviceTier: "priority" } } },
    undefined,
    paths,
  );
  const map = { entries: { "openai/gpt-5.5": buildPresetMapEntry(openAIModel) } };
  assert.equal(resolveTierForModel(config, map, openAIModel), "priority");
  assert.equal(mapSupportsTier(map, "openai/gpt-5.5", "priority"), true);

  const offConfig = mergeConfigs({ entries: { "openai/gpt-5.5": { active: false, serviceTier: "priority" } } }, undefined, paths);
  assert.equal(resolveTierForModel(offConfig, map, openAIModel), undefined);

  const unsupportedConfig = mergeConfigs({ entries: { "openai/gpt-5.5": { active: true, serviceTier: "flex" } } }, undefined, paths);
  const priorityOnlyEntry = buildPresetMapEntry(openAIModel);
  priorityOnlyEntry.tiers = ["priority"];
  priorityOnlyEntry.determined = true;
  const codexMap = { entries: { "openai/gpt-5.5": priorityOnlyEntry } };
  assert.equal(resolveTierForModel(unsupportedConfig, codexMap, openAIModel), undefined);
});

test("status text omits provider/model key", () => {
  const previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const paths = configPaths("/repo", "/home/user");
    const config = mergeConfigs({ entries: { "openai/gpt-5.5": { active: true, serviceTier: "priority" } } }, undefined, paths);
    const map = { entries: { "openai/gpt-5.5": buildPresetMapEntry(openAIModel) } };
    assert.equal(_test.statusText(config, map, openAIModel), "service_tier: ⚡ priority");
    assert.equal(_test.statusText(config, { entries: {} }, openAIModel), "service_tier: ⚡ priority unknown");
    const flexConfig = mergeConfigs({ entries: { "openai/gpt-5.5": { active: true, serviceTier: "flex" } } }, undefined, paths);
    assert.equal(_test.statusText(flexConfig, map, openAIModel), "service_tier: ● flex");
    const offConfig = mergeConfigs({ entries: { "openai/gpt-5.5": { active: false, serviceTier: "priority" } } }, undefined, paths);
    assert.equal(_test.statusText(offConfig, map, openAIModel), "service_tier ○ off");
    const unsetConfig = mergeConfigs(undefined, undefined, paths);
    assert.equal(_test.statusText(unsetConfig, map, openAIModel), "service_tier ○ off");
  } finally {
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
  }
});

test("status text does not yellow-highlight off or unknown states", () => {
  const paths = configPaths("/repo", "/home/user");
  const offConfig = mergeConfigs(undefined, undefined, paths);
  assert.equal(_test.statusText(offConfig, { entries: {} }, openAIModel), "service_tier ○ off");
  const unknownConfig = mergeConfigs({ entries: { "openai/gpt-5.5": { active: true, serviceTier: "priority" } } }, undefined, paths);
  assert.equal(_test.statusText(unknownConfig, { entries: {} }, openAIModel), "service_tier: ⚡ priority unknown");
});

test("payload helper adds top-level service_tier", () => {
  assert.deepEqual(_test.payloadWithServiceTier({ model: "x" }, "priority"), { model: "x", service_tier: "priority" });
  assert.equal(_test.payloadWithServiceTier(null, "priority"), undefined);
});

test("detects unsupported service_tier errors and updates map without retry state", () => {
  assert.equal(isUnsupportedServiceTierError("Unknown parameter: service_tier"), true);
  assert.equal(isUnsupportedServiceTierError("service_tier is not supported by this model"), true);
  assert.equal(isUnsupportedServiceTierError("rate limit"), false);

  const map = { entries: { "openai/gpt-5.5": buildPresetMapEntry(openAIModel) } };
  const next = markTierUnsupported(map, "openai/gpt-5.5", "priority", "service_tier unsupported");
  assert.equal(next.entries?.["openai/gpt-5.5"].tiers.includes("priority"), false);
  assert.equal(next.entries?.["openai/gpt-5.5"].unsupportedTiers?.includes("priority"), true);
  assert.equal(mapSupportState(next, "openai/gpt-5.5", "priority"), "unknown");
  assert.equal(mapSupportState({ entries: {} }, "openai/gpt-5.5", "priority"), "unknown");
});

test("marks auto-probe once success as supported", () => {
  const map = { entries: { "openai/gpt-5.5": markTierUnsupported({ entries: {} }, "openai/gpt-5.5", "priority").entries?.["openai/gpt-5.5"]! } };
  const next = markTierSupported(map, "openai/gpt-5.5", "priority", openAIModel);
  assert.equal(next.entries?.["openai/gpt-5.5"].determined, false);
  assert.deepEqual(next.entries?.["openai/gpt-5.5"].tiers, ["priority"]);
  assert.equal(next.entries?.["openai/gpt-5.5"].unsupportedTiers?.includes("priority") ?? false, false);
});

test("marks auto-probe results with complete probe metadata", () => {
  const presetMap = { entries: { "openai/gpt-5.5": buildPresetMapEntry(openAIModel) } };
  const next = markTierProbeResults(
    presetMap,
    "openai/gpt-5.5",
    { priority: "supported", flex: "unsupported", default: "supported", auto: "unsupported", scale: "unsupported", fast: "unsupported", ultrafast: "unsupported" },
    openAIModel,
    "probe rejected: flex, auto, scale",
  );
  assert.equal(next.entries?.["openai/gpt-5.5"].provider, "openai");
  assert.equal(next.entries?.["openai/gpt-5.5"].id, "gpt-5.5");
  assert.equal(next.entries?.["openai/gpt-5.5"].api, "openai-responses");
  assert.equal(next.entries?.["openai/gpt-5.5"].source, "probe");
  assert.equal(next.entries?.["openai/gpt-5.5"].error, "probe rejected: flex, auto, scale");
  assert.equal(next.entries?.["openai/gpt-5.5"].determined, true);
  assert.deepEqual(next.entries?.["openai/gpt-5.5"].tiers, ["priority", "default"]);
  assert.deepEqual(next.entries?.["openai/gpt-5.5"].unsupportedTiers, ["flex", "auto", "scale", "fast", "ultrafast"]);
});

test("default probe uses Pi's configured model registry with a raw Context and tier payload hook", async () => {
  let calls = 0;
  let payload: unknown;
  const originalPayload = { model: "gpt-6-astra", service_tier: "default" };
  const ctx = {
    modelRegistry: {
      getApiKeyAndHeaders: () => { throw new Error("Probe must not resolve request auth twice"); },
      streamSimple(model: unknown, context: { messages: Array<{ role: string; content: string }> }, options: SimpleStreamOptions) {
        calls++;
        assert.equal(model, ultrafastModel);
        assert.equal(context.messages[0].role, "user");
        assert.equal(context.messages[0].content, "Reply OK.");
        assert.equal(options.maxTokens, 1);
        assert.equal(options.signal?.aborted, false);
        assert.equal(options.apiKey, undefined);
        assert.equal(options.headers, undefined);
        return (async function* () {
          payload = await options.onPayload?.(originalPayload, ultrafastModel);
          yield { type: "done" };
        })();
      },
    },
  } as never;
  assert.equal(await _test.defaultProbeTier(ultrafastModel, "ultrafast", ctx), "supported");
  assert.equal(calls, 1);
  assert.deepEqual(payload, { model: "gpt-6-astra", service_tier: "ultrafast" });
  assert.deepEqual(originalPayload, { model: "gpt-6-astra", service_tier: "default" });
});

test("default probe classifies provider errors and incomplete streams without retrying", async () => {
  for (const [errorMessage, expected] of [
    ["Invalid service_tier: ultrafast", "unsupported"],
    ["Unauthorized", "unknown"],
    ["Rate limit exceeded", "unknown"],
    [undefined, "unknown"],
  ] as const) {
    let calls = 0;
    const ctx = {
      modelRegistry: {
        streamSimple: () => {
          calls++;
          return (async function* () {
            if (errorMessage) yield { type: "error", error: { errorMessage } };
          })();
        },
      },
    } as never;
    assert.equal(await _test.defaultProbeTier(ultrafastModel, "ultrafast", ctx), expected);
    assert.equal(calls, 1);
  }
  const ctx = { modelRegistry: { streamSimple: () => { throw new Error("Unknown provider"); } } } as never;
  assert.equal(await _test.defaultProbeTier(ultrafastModel, "fast", ctx), "unknown");
});

test("unknown behavior defaults to ask", () => {
  const effective = mergeConfigs(undefined, undefined, configPaths("/repo", "/home/user"));
  assert.equal(effective.unknownModelBehavior, "ask");
});

test("tier argument completions include fast and ultrafast", () => {
  assert.deepEqual(_test.tierCompletions("u"), [{ value: "ultrafast", label: "ultrafast" }]);
  assert.deepEqual(_test.tierCompletions("fa"), [{ value: "fast", label: "fast" }]);
  assert.equal(_test.tierCompletions("turbo"), null);
});

test("unknown behavior command exports completions", () => {
  assert.equal(_test.COMMAND_UNKNOWN_BEHAVIOR, "service-tier-unknown-behavior");
  assert.deepEqual(_test.unknownBehaviorCompletions("a"), [
    { value: "ask", label: "ask" },
    { value: "auto-probe", label: "auto-probe" },
  ]);
  assert.deepEqual(_test.unknownBehaviorCompletions("l"), [{ value: "leave-unknown", label: "leave-unknown" }]);
});

test("can persist map entries", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    writeMap(paths.map, { entries: { "openai/gpt-5.5": buildPresetMapEntry(openAIModel) } });
    assert.equal(readMap(paths.map)?.entries?.["openai/gpt-5.5"].determined, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto-seeds missing current-model map entry from presets", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    const seeded = _test.seedPresetMapEntryIfMissing(paths.map, { entries: {} }, codexModel);
    assert.deepEqual(seeded.entries?.["openai-codex/gpt-5.5"].tiers, DOCUMENTED_GPT_55_TIERS);
    assert.equal(readMap(paths.map)?.entries?.["openai-codex/gpt-5.5"].determined, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("registers new commands and omits removed commands", () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  try {
    assert.equal(harness.commands.has("service-tier-fast-project"), true);
    assert.equal(harness.commands.has("service-tier-fast-user"), true);
    assert.equal(harness.commands.has("fast-project"), true);
    assert.equal(harness.commands.has("fast-user"), true);
    assert.equal(harness.commands.has("service-tier-refresh-support"), true);
    assert.equal(harness.commands.has("service-tier-refresh-support-all"), true);
    assert.equal(harness.commands.has("service-tier-unset-support"), true);
    assert.equal(harness.commands.has("service-tier-unset-support-all"), true);
    assert.equal(harness.commands.has("service-tier-unknown-behavior"), true);
    assert.equal(harness.commands.has("service-tier-build-map"), false);
    assert.equal(harness.commands.has("service-tier-build-map-all"), false);
    assert.equal(harness.commands.has("service-tier-aggressive-probe"), false);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

for (const tier of ["fast", "ultrafast"] as const) {
  test(`${tier} commands persist and inject the selected value without mutating payloads`, async () => {
    const cwd = tempDir();
    const home = tempDir();
    const harness = createExtensionHarness(cwd, home, ultrafastModel);
    try {
      const paths = configPaths(cwd, home);
      await harness.commands.get("service-tier-project")?.handler(tier, harness.ctx);
      assert.equal(readConfig(paths.project)?.entries?.["openai/gpt-6-astra"].serviceTier, tier);
      assert.equal(harness.prompts.length, 0);
      assert.ok(harness.statuses.at(-1)?.value?.includes(`⚡ ${tier}`));
      const original = { model: "gpt-6-astra", service_tier: "default" };
      const payload = await harness.handlers.get("before_provider_request")?.({ payload: original } as never, harness.ctx);
      assert.deepEqual(payload, { model: "gpt-6-astra", service_tier: tier });
      assert.deepEqual(original, { model: "gpt-6-astra", service_tier: "default" });
      await harness.commands.get("service-tier-project")?.handler("off", harness.ctx);
      assert.equal(await harness.handlers.get("before_provider_request")?.({ payload: original } as never, harness.ctx), undefined);
    } finally {
      harness.restore();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test("session start does not seed presets passively", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, codexModel);
  try {
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    const paths = configPaths(cwd, home);
    assert.deepEqual(readMap(paths.map)?.entries, {});
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("session start refreshes OpenAI knowledge but preserves stored removed-provider and probe entries", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.map), { recursive: true });
    writeFileSync(
      paths.map,
      JSON.stringify({
        version: 1,
        entries: {
          "openai/gpt-5.5": {
            provider: "openai",
            id: "gpt-5.5",
            api: "openai-responses",
            supported: false,
            tiers: [],
            source: "error",
            updatedAt: new Date().toISOString(),
          },
          "opencode-go/qwen3.5-plus": {
            provider: "opencode-go",
            id: "qwen3.5-plus",
            api: "openai-completions",
            determined: true,
            tiers: ["priority", "default"],
            source: "preset",
            updatedAt: new Date().toISOString(),
          },
          "openai-codex/gpt-5.5": {
            provider: "openai-codex",
            id: "gpt-5.5",
            api: "openai-codex-responses",
            determined: true,
            tiers: ["priority", "default"],
            unsupportedTiers: ["flex", "auto", "scale"],
            source: "probe",
            updatedAt: new Date().toISOString(),
          },
          "opencode-go/minimax-m2.5": {
            provider: "opencode-go",
            id: "minimax-m2.5",
            api: "anthropic-messages",
            determined: false,
            tiers: [],
            unsupportedTiers: ["flex"],
            source: "user-mark",
            updatedAt: new Date().toISOString(),
          },
        },
      }),
      "utf8",
    );
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    const map = JSON.parse(readFileSync(paths.map, "utf8")) as { entries: Record<string, Record<string, unknown>> };
    assert.equal(map.entries["openai/gpt-5.5"]?.source, "preset");
    assert.equal(map.entries["openai/gpt-5.5"]?.determined, true);
    assert.deepEqual(map.entries["openai/gpt-5.5"]?.tiers, DOCUMENTED_GPT_55_TIERS);
    assert.equal("supported" in (map.entries["openai/gpt-5.5"] ?? {}), false);
    assert.equal(map.entries["opencode-go/qwen3.5-plus"]?.source, "preset");
    assert.deepEqual(map.entries["opencode-go/qwen3.5-plus"]?.tiers, ["priority", "default"]);
    assert.equal(map.entries["opencode-go/minimax-m2.5"]?.source, "user-mark");
    assert.equal(map.entries["opencode-go/minimax-m2.5"]?.determined, false);
    assert.equal(map.entries["openai-codex/gpt-5.5"]?.source, "probe");
    assert.deepEqual(map.entries["openai-codex/gpt-5.5"]?.tiers, ["priority", "default"]);
    assert.deepEqual(map.entries["openai-codex/gpt-5.5"]?.unsupportedTiers, ["flex", "auto", "scale"]);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("fast command seeds preset support explicitly", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, codexModel);
  try {
    await harness.commands.get("service-tier-fast-user")?.handler("on", harness.ctx);
    const paths = configPaths(cwd, home);
    assert.deepEqual(readConfig(paths.user)?.entries?.["openai-codex/gpt-5.5"], { active: true, serviceTier: "priority" });
    assert.deepEqual(readMap(paths.map)?.entries?.["openai-codex/gpt-5.5"].tiers, DOCUMENTED_GPT_55_TIERS);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("tier changes always refresh preset support before evaluating unknown support", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, codexModel);
  try {
    const paths = configPaths(cwd, home);
    const staleEntry = buildPresetMapEntry(codexModel);
    staleEntry.tiers = ["priority", "default", "ultrafast"];
    staleEntry.determined = true;
    writeMap(paths.map, { entries: { "openai-codex/gpt-5.5": staleEntry } });
    harness.selections.push("Leave unknown once");
    await harness.commands.get("service-tier-project")?.handler("ultrafast", harness.ctx);
    const map = readMap(paths.map);
    assert.deepEqual(map?.entries?.["openai-codex/gpt-5.5"].tiers, DOCUMENTED_GPT_55_TIERS);
    assert.equal(map?.entries?.["openai-codex/gpt-5.5"].source, "user-mark");
    assert.equal(mapSupportsTier(map, "openai-codex/gpt-5.5", "priority"), true);
    assert.equal(harness.prompts.length, 1);
    assert.equal(harness.notifications.some(({ message }) => message.includes("is not supported")), false);
    await harness.commands.get("service-tier-project")?.handler("ultrafast", harness.ctx);
    assert.equal(harness.prompts.length, 1);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("tier commands preserve probe map entries when requested tier is known", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "opencode-go/minimax-m2.5";
    writeMap(paths.map, markTierProbeResults({ entries: {} }, key, { priority: "supported", flex: "supported", default: "supported", auto: "supported", scale: "supported", fast: "supported", ultrafast: "supported" }, opencodeMinimaxModel));
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    const entry = readMap(paths.map)?.entries?.[key];
    assert.equal(entry?.source, "probe");
    assert.deepEqual(entry?.tiers, [...SERVICE_TIERS]);
    const payload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "minimax-m2.5" } } as never, harness.ctx);
    assert.deepEqual(payload, { model: "minimax-m2.5", service_tier: "flex" });
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("fast commands preserve probe map entries when priority is known", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "opencode-go/minimax-m2.5";
    writeMap(paths.map, markTierProbeResults({ entries: {} }, key, { priority: "supported", flex: "unsupported", default: "unsupported", auto: "unsupported", scale: "unsupported", fast: "unsupported", ultrafast: "unsupported" }, opencodeMinimaxModel));
    await harness.commands.get("fast-project")?.handler("on", harness.ctx);
    const entry = readMap(paths.map)?.entries?.[key];
    assert.equal(entry?.source, "probe");
    assert.deepEqual(entry?.tiers, ["priority"]);
    assert.deepEqual(entry?.unsupportedTiers, ["flex", "default", "auto", "scale", "fast", "ultrafast"]);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("probe-known unsupported tiers do not ask again", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "opencode-go/minimax-m2.5";
    writeMap(paths.map, markTierProbeResults({ entries: {} }, key, { priority: "supported", flex: "unsupported", default: "supported", auto: "unsupported", scale: "unsupported", fast: "unsupported", ultrafast: "unsupported" }, opencodeMinimaxModel));
    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    const entry = readMap(paths.map)?.entries?.[key];
    assert.equal(entry?.source, "probe");
    assert.deepEqual(entry?.tiers, ["priority", "default"]);
    assert.deepEqual(entry?.unsupportedTiers, ["flex", "auto", "scale", "fast", "ultrafast"]);
    assert.deepEqual(harness.selections, ["Auto-probe once"]);
    assert.equal(
      harness.notifications.some(({ message }) => message.includes("is not supported")),
      true,
    );
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("leave unknown choices write user-mark entries for undetermined presets", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "opencode-go/minimax-m2.5";
    harness.selections.push("Leave unknown once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    let entry = readMap(paths.map)?.entries?.[key];
    assert.equal(entry?.source, "user-mark");
    assert.equal(entry?.determined, false);
    assert.deepEqual(entry?.tiers, []);
    assert.equal(entry?.unsupportedTiers, undefined);

    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    entry = readMap(paths.map)?.entries?.[key];
    assert.equal(entry?.source, "user-mark");
    assert.deepEqual(harness.selections, ["Auto-probe once"]);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("leave unknown and do not ask again writes user-mark and unknown behavior", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "opencode-go/minimax-m2.5";
    harness.selections.push("Always leave unknown");
    await harness.commands.get("service-tier-project")?.handler("scale", harness.ctx);
    const entry = readMap(paths.map)?.entries?.[key];
    assert.equal(entry?.source, "user-mark");
    assert.equal(entry?.determined, false);
    assert.equal(entry?.unsupportedTiers, undefined);
    assert.equal(readConfig(paths.user)?.unknownModelBehavior, "leave-unknown");
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("refresh and unset support commands write preset then make support unknown", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, codexModel);
  try {
    const paths = configPaths(cwd, home);
    await harness.commands.get("service-tier-refresh-support")?.handler("", harness.ctx);
    assert.equal(readMap(paths.map)?.entries?.["openai-codex/gpt-5.5"].determined, true);
    await harness.commands.get("service-tier-unset-support")?.handler("", harness.ctx);
    assert.equal(readMap(paths.map)?.entries?.["openai-codex/gpt-5.5"], undefined);
    await harness.commands.get("service-tier-refresh-support-all")?.handler("", harness.ctx);
    assert.equal(readMap(paths.map)?.entries?.["openai/gpt-5.5"].determined, true);
    await harness.commands.get("service-tier-unset-support-all")?.handler("", harness.ctx);
    assert.deepEqual(readMap(paths.map)?.entries, {});
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("unknown behavior command persists to user config", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  try {
    const paths = configPaths(cwd, home);
    await harness.commands.get("service-tier-unknown-behavior")?.handler("auto-probe", harness.ctx);
    assert.equal(readConfig(paths.user)?.unknownModelBehavior, "auto-probe");
    assert.equal(readConfig(paths.project), undefined);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("ask flow runs auto-probe once probe immediately and persists success", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  const probedTiers: string[] = [];
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier) => {
    probedTiers.push(tier);
    return "supported";
  });
  try {
    const paths = configPaths(cwd, home);
    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    assert.equal(harness.prompts.length, 1);
    assert.match(harness.prompts[0], /\n\nAuto-probe sends low-token probe requests/);
    assert.match(harness.prompts[0], /low-token probe requests/);
    assert.match(harness.prompts[0], /may consume provider tokens/);
    await _test.waitForAutoProbesForTest();
    const entry = readMap(paths.map)?.entries?.["opencode-go/minimax-m2.5"];
    assert.deepEqual(probedTiers, [...SERVICE_TIERS]);
    assert.equal(entry?.provider, "opencode-go");
    assert.equal(entry?.id, "minimax-m2.5");
    assert.equal(entry?.api, "anthropic-messages");
    assert.equal(entry?.source, "probe");
    assert.equal(entry?.determined, true);
    assert.deepEqual(entry?.tiers, [...SERVICE_TIERS]);
    assert.equal(entry?.unsupportedTiers, undefined);
    assert.equal(
      harness.notifications.some(({ message }) => message.includes("auto-probe started")),
      true,
    );
    const secondPayload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "minimax-m2.5" } } as never, harness.ctx);
    assert.deepEqual(secondPayload, { model: "minimax-m2.5", service_tier: "flex" });
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto-probe does not block configured request injection", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  const firstProbe = deferred<"supported">();
  const probedTiers: string[] = [];
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier) => {
    probedTiers.push(tier);
    if (tier === "priority") await firstProbe.promise;
    return "supported";
  });
  try {
    const paths = configPaths(cwd, home);
    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    assert.deepEqual(probedTiers, ["priority"]);
    assert.equal(readMap(paths.map)?.entries?.["opencode-go/minimax-m2.5"]?.source, "preset");

    const payload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "minimax-m2.5" } } as never, harness.ctx);
    assert.deepEqual(payload, { model: "minimax-m2.5", service_tier: "flex" });

    firstProbe.resolve("supported");
    await _test.waitForAutoProbesForTest();
    const entry = readMap(paths.map)?.entries?.["opencode-go/minimax-m2.5"];
    assert.equal(entry?.source, "probe");
    assert.deepEqual(entry?.tiers, [...SERVICE_TIERS]);
  } finally {
    firstProbe.resolve("supported");
    await _test.waitForAutoProbesForTest();
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto-probe shows and clears probing status", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  const restoreProbe = _test.setProbeTierForTest(async () => "supported");
  try {
    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await _test.waitForAutoProbesForTest();
    assert.equal(
      harness.statuses.some(({ value }) => value?.includes("service_tier") && value.includes("probing flex")),
      true,
    );
    assert.equal(harness.statuses.at(-1)?.value?.includes("probing flex"), false);
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto-probe behavior probes all tiers even when selected tier is preset-supported", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, codexModel);
  const probedTiers: string[] = [];
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier) => {
    probedTiers.push(tier);
    return tier === "priority" || tier === "default" ? "supported" : "unsupported";
  });
  try {
    const paths = configPaths(cwd, home);
    await harness.commands.get("service-tier-unknown-behavior")?.handler("auto-probe", harness.ctx);
    await harness.commands.get("service-tier-project")?.handler("priority", harness.ctx);
    await _test.waitForAutoProbesForTest();
    const entry = readMap(paths.map)?.entries?.["openai-codex/gpt-5.5"];
    assert.deepEqual(probedTiers, [...SERVICE_TIERS]);
    assert.equal(entry?.source, "probe");
    assert.deepEqual(entry?.tiers, ["priority", "default"]);
    assert.deepEqual(entry?.unsupportedTiers, ["flex", "auto", "scale", "fast", "ultrafast"]);
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto-probe leaves map unchanged when any tier is unknown", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier) => (tier === "auto" ? "unknown" : "supported"));
  try {
    const paths = configPaths(cwd, home);
    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await _test.waitForAutoProbesForTest();
    const entry = readMap(paths.map)?.entries?.["opencode-go/minimax-m2.5"];
    assert.equal(entry?.source, "preset");
    assert.equal(entry?.determined, false);
    assert.deepEqual(entry?.tiers, []);
    assert.equal(
      harness.notifications.some(({ message }) => message.includes("did not determine auto")),
      true,
    );
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("ask flow always auto-probe probes immediately and keeps auto-probe behavior", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, opencodeMinimaxModel);
  const probedTiers: string[] = [];
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier) => {
    probedTiers.push(tier);
    return "unsupported";
  });
  try {
    const paths = configPaths(cwd, home);
    harness.selections.push("Always auto-probe");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await _test.waitForAutoProbesForTest();
    assert.equal(readConfig(paths.user)?.unknownModelBehavior, "auto-probe");
    const entry = readMap(paths.map)?.entries?.["opencode-go/minimax-m2.5"];
    assert.deepEqual(probedTiers, [...SERVICE_TIERS]);
    assert.equal(entry?.provider, "opencode-go");
    assert.equal(entry?.id, "minimax-m2.5");
    assert.equal(entry?.api, "anthropic-messages");
    assert.equal(entry?.source, "probe");
    assert.equal(entry?.determined, true);
    assert.deepEqual(entry?.tiers, []);
    assert.deepEqual(entry?.unsupportedTiers, [...SERVICE_TIERS]);
    assert.equal(entry?.error, `service_tier auto-probe rejected: ${SERVICE_TIERS.join(", ")}`);
    assert.equal(
      harness.notifications.some(({ message }) => message.includes("auto-probe started")),
      true,
    );
    const payload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "gpt-5.5" } } as never, harness.ctx);
    assert.deepEqual(payload, { model: "gpt-5.5", service_tier: "flex" });
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("unsupported errors update map without retry", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  try {
    const paths = configPaths(cwd, home);
    writeConfig(paths.user, { entries: { "openai/gpt-5.5": { active: true, serviceTier: "priority" } } });
    writeMap(paths.map, { entries: {} });
    const payload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "gpt-5.5" } } as never, harness.ctx);
    assert.deepEqual(payload, { model: "gpt-5.5", service_tier: "priority" });
    await harness.handlers.get("message_end")?.(
      { message: { role: "assistant", errorMessage: "service_tier is not supported by this model" } } as never,
      harness.ctx,
    );
    assert.equal(readMap(paths.map)?.entries?.["openai/gpt-5.5"].unsupportedTiers?.includes("priority"), true);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("configured request-time injection does not persist support on success", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  try {
    const paths = configPaths(cwd, home);
    writeConfig(paths.user, { entries: { "openai/gpt-5.5": { active: true, serviceTier: "priority" } } });
    writeMap(paths.map, { entries: {} });
    const payload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "gpt-5.5" } } as never, harness.ctx);
    assert.deepEqual(payload, { model: "gpt-5.5", service_tier: "priority" });
    await harness.handlers.get("message_end")?.({ message: { role: "assistant" } } as never, harness.ctx);
    assert.equal(readMap(paths.map)?.entries?.["openai/gpt-5.5"], undefined);
    assert.equal(
      harness.notifications.some(({ message }) => message.includes("auto-probe injection started")),
      false,
    );
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
