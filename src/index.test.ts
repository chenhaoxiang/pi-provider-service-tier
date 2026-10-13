import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SERVICE_TIERS,
  UNKNOWN_MODEL_BEHAVIORS,
  _test,
  ConfigFileError,
  buildPresetMapEntry,
  configPaths,
  ensureConfig,
  ensureMap,
  isServiceTier,
  isServiceTierModelSupported,
  isServiceTierProviderSupported,
  configuredTierForModel,
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
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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

// Stored entries for removed providers are retained, but their runtime features are blocked.
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

const unknownRouterModel = {
  ...openAIModel as object,
  provider: "openrouter",
  id: "unverified-model",
  api: "openai-completions",
} as never;

const blockedModels = [
  { provider: "anthropic", api: "anthropic-messages" },
  { provider: "google", api: "google-generative-ai" },
  { provider: "google-vertex", api: "google-vertex" },
  { provider: "amazon-bedrock", api: "bedrock-converse-stream" },
  { provider: "bedrock", api: "openai-completions" },
  { provider: "gemini", api: "openai-completions" },
  { provider: "anthropic", api: "openai-responses" },
  { provider: "openai", api: "anthropic-messages" },
  { provider: "openai", api: "google-generative-ai" },
  { provider: "openai", api: "bedrock-converse-stream" },
  { provider: "custom-provider", api: "openai-completions" },
  { provider: "constructor", api: "openai-completions" },
].map((identity) => ({ ...openAIModel as object, ...identity, id: "blocked-model" } as never));
blockedModels.push(opencodeQwenModel, opencodeMinimaxModel);

function createExtensionHarness(cwd: string, home: string, model: never = openAIModel, available: never[] = [openAIModel]) {
  type Command = {
    handler: (args: string, ctx: never) => Promise<void> | void;
    getArgumentCompletions?: (prefix: string) => unknown;
  };
  const commands = new Map<string, Command>();
  const shortcuts = new Map<string, { handler: (ctx: never) => Promise<void> | void }>();
  const autocompleteProviders: Array<Parameters<ExtensionContext["ui"]["addAutocompleteProvider"]>[0]> = [];
  const handlers = new Map<string, (event: never, ctx: never) => Promise<unknown> | unknown>();
  const notifications: Array<{ message: string; type?: string }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const selections: string[] = [];
  const prompts: string[] = [];
  const branch: Array<{ type: string; customType?: string; data?: unknown }> = [];
  const ctx = {
    cwd,
    model,
    sessionManager: {
      getBranch: () => branch,
    },
    modelRegistry: {
      getAvailable: () => available,
    },
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
      setStatus: (key: string, value: string | undefined) => statuses.push({ key, value }),
      addAutocompleteProvider: (factory: typeof autocompleteProviders[number]) => autocompleteProviders.push(factory),
      select: async (message: string) => {
        prompts.push(message);
        return selections.shift();
      },
    },
  } as never;
  const pi = {
    appendEntry: (customType: string, data: unknown) => {
      branch.push({ type: "custom", customType, data });
    },
    registerCommand: (name: string, options: Command) => {
      commands.set(name, options);
    },
    registerShortcut: (name: string, options: { handler: (ctx: never) => Promise<void> | void }) => {
      shortcuts.set(name, options);
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
    shortcuts,
    handlers,
    ctx,
    notifications,
    statuses,
    selections,
    prompts,
    branch,
    autocompleteProviders,
    setModel: (next: never) => { (ctx as { model: never }).model = next; },
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

test("rejects malformed JSON while normalizing invalid per-model entries", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.user), { recursive: true });
    writeFileSync(paths.user, "{ bad json", "utf8");
    assert.throws(() => readConfig(paths.user), ConfigFileError);

    writeFileSync(
      paths.user,
      JSON.stringify({
        aggressiveProbe: true,
        entries: { "bad": { active: true }, "openai/gpt-5.5": { active: true, serviceTier: "turbo" } },
      }),
      "utf8",
    );
    const config = readConfig(paths.user);
    assert.equal(config?.unknownModelBehavior, undefined);
    assert.deepEqual(config?.entries, { "openai/gpt-5.5": { active: false } });
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

test("active entries without any configured tier stay off without an implicit priority", () => {
  const paths = configPaths("/repo", "/home/user");
  const key = modelKey(openAIModel)!;
  const activeOnly = { entries: { [key]: { active: true } } };
  for (const [user, project] of [[activeOnly, undefined], [undefined, activeOnly], [activeOnly, activeOnly]]) {
    const config = mergeConfigs(user, project, paths);
    assert.deepEqual(config.entries[key], { active: false });
    assert.equal(configuredTierForModel(config, openAIModel), undefined);
    assert.equal(_test.statusText(config, { entries: {} }, openAIModel), "service_tier ○ off");
  }
});

test("invalid explicit tiers disable entries instead of defaulting or reviving user tiers", () => {
  const paths = configPaths("/repo", "/home/user");
  const key = modelKey(openAIModel)!;
  const validUser = { entries: { [key]: { active: true, serviceTier: "flex" as const } } };
  for (const serviceTier of ["fleex", "off", "standard_only", "PRIORITY", "", null, undefined, 0, true, [], {}]) {
    const invalid = { entries: { [key]: { active: true, serviceTier } } } as unknown as ConfigFile;
    assert.deepEqual(mergeConfigs(invalid, undefined, paths).entries[key], { active: false });
    const overridden = mergeConfigs(validUser, invalid, paths);
    assert.deepEqual(overridden.entries[key], { active: false, serviceTier: "flex" });
    assert.equal(configuredTierForModel(overridden, openAIModel), undefined);
  }
});

test("malformed project entries and active flags cannot revive enabled user settings", () => {
  const paths = configPaths("/repo", "/home/user");
  const key = modelKey(openAIModel)!;
  const user = { entries: { [key]: { active: true, serviceTier: "priority" as const } } };
  for (const entry of [null, undefined, true, 7, "priority", [], ...[null, "true", 1, [], {}].map((active) => ({ active, serviceTier: "flex" }))]) {
    const project = { entries: { [key]: entry } } as unknown as ConfigFile;
    const config = mergeConfigs(user, project, paths);
    assert.equal(config.entries[key].active, false);
    assert.equal(configuredTierForModel(config, openAIModel), undefined);
  }
});

test("partial scope overrides can still inherit an explicitly configured valid tier", () => {
  const paths = configPaths("/repo", "/home/user");
  const key = modelKey(openAIModel)!;
  for (const serviceTier of SERVICE_TIERS) {
    const user = { entries: { [key]: { active: false, serviceTier } } };
    const project = { entries: { [key]: { active: true } } };
    const config = mergeConfigs(user, project, paths);
    assert.deepEqual(config.entries[key], { active: true, serviceTier });
    assert.equal(configuredTierForModel(config, openAIModel), serviceTier);
  }
});

test("tier lookup and status reject missing or invalid tiers even without config normalization", () => {
  const key = modelKey(openAIModel)!;
  const base = mergeConfigs(undefined, undefined, configPaths("/repo", "/home/user"));
  for (const serviceTier of [undefined, "fleex", "", null, 0, true, [], {}]) {
    const config = { ...base, entries: { [key]: { active: true, serviceTier } } } as unknown as typeof base;
    assert.equal(configuredTierForModel(config, openAIModel), undefined);
    assert.equal(_test.statusText(config, { entries: {} }, openAIModel), "service_tier ○ off");
  }
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
    assert.equal(harness.commands.has("fast"), true);
    assert.equal(harness.commands.has("service-tier-fast-session"), true);
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

test("session-local fast command is branch-scoped and GPT/API gated", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const gptModel = { provider: "codex-local", id: "gpt-6.1-sol", api: "openai-responses" } as never;
  const harness = createExtensionHarness(cwd, home, gptModel);
  try {
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    assert.equal(harness.commands.has("fast"), true);
    await harness.commands.get("fast")?.handler("on", harness.ctx);
    assert.equal(harness.branch.at(-1)?.data && (harness.branch.at(-1)?.data as { active: boolean }).active, true);

    const payload = await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-6.1-sol", input: [] } } as never,
      harness.ctx,
    );
    assert.deepEqual(payload, { model: "gpt-6.1-sol", input: [], service_tier: "priority" });

    await harness.commands.get("fast")?.handler("off", harness.ctx);
    const offPayload = await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-6.1-sol", input: [], service_tier: "priority" } } as never,
      harness.ctx,
    );
    assert.deepEqual(offPayload, { model: "gpt-6.1-sol", input: [] });

    (harness.ctx as { model: unknown }).model = { provider: "codex-local", id: "kimi-k3", api: "openai-responses" };
    const beforeCount = harness.branch.length;
    await harness.commands.get("fast")?.handler("on", harness.ctx);
    assert.equal(harness.branch.length, beforeCount);
    assert.equal(harness.notifications.at(-1)?.type, "error");
    assert.match(harness.notifications.at(-1)?.message ?? "", /blocked/);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("unsupported session Fast request auto-disables the current session", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const gptModel = { provider: "codex-local", id: "gpt-6.1-sol", api: "openai-responses" } as never;
  const harness = createExtensionHarness(cwd, home, gptModel);
  try {
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    await harness.commands.get("fast")?.handler("on", harness.ctx);
    await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-6.1-sol", input: [] } } as never,
      harness.ctx,
    );
    await harness.handlers.get("message_end")?.(
      { message: { role: "assistant", errorMessage: "service_tier is not supported by this model" } } as never,
      harness.ctx,
    );
    const state = harness.branch.at(-1)?.data as { active: boolean; reason?: string };
    assert.equal(state.active, false);
    assert.equal(state.reason, "unsupported");
    await harness.handlers.get("turn_end")?.({ outcome: "error", messageEntryId: "assistant-error" } as never, harness.ctx);
    const continuation = await harness.handlers.get("agent_before_settle")?.({ outcome: "error" } as never, harness.ctx) as
      | { continue?: boolean; entries?: Array<{ type: string; targetId?: string }> }
      | undefined;
    assert.equal(continuation?.continue, true);
    assert.deepEqual(continuation?.entries, [{ type: "context_edit", targetId: "assistant-error", replacement: null }]);
    assert.match(harness.notifications.at(-1)?.message ?? "", /降级|重试/);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("session tree restores the latest branch fast state", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const gptModel = { provider: "codex-local", id: "gpt-6.1-sol", api: "openai-responses" } as never;
  const harness = createExtensionHarness(cwd, home, gptModel);
  try {
    harness.branch.push({ type: "custom", customType: "pi-provider-service-tier:session-fast", data: { version: 1, active: true, override: true } });
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    const payload = await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-6.1-sol", input: [] } } as never,
      harness.ctx,
    );
    assert.equal((payload as { service_tier?: string }).service_tier, "priority");
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "openrouter/unverified-model";
    writeMap(paths.map, markTierProbeResults({ entries: {} }, key, { priority: "supported", flex: "supported", default: "supported", auto: "supported", scale: "supported", fast: "supported", ultrafast: "supported" }, unknownRouterModel));
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    const entry = readMap(paths.map)?.entries?.[key];
    assert.equal(entry?.source, "probe");
    assert.deepEqual(entry?.tiers, [...SERVICE_TIERS]);
    const payload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "unverified-model" } } as never, harness.ctx);
    assert.deepEqual(payload, { model: "unverified-model", service_tier: "flex" });
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("fast commands preserve probe map entries when priority is known", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "openrouter/unverified-model";
    writeMap(paths.map, markTierProbeResults({ entries: {} }, key, { priority: "supported", flex: "unsupported", default: "unsupported", auto: "unsupported", scale: "unsupported", fast: "unsupported", ultrafast: "unsupported" }, unknownRouterModel));
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "openrouter/unverified-model";
    writeMap(paths.map, markTierProbeResults({ entries: {} }, key, { priority: "supported", flex: "unsupported", default: "supported", auto: "unsupported", scale: "unsupported", fast: "unsupported", ultrafast: "unsupported" }, unknownRouterModel));
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "openrouter/unverified-model";
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  try {
    const paths = configPaths(cwd, home);
    const key = "openrouter/unverified-model";
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
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
    const entry = readMap(paths.map)?.entries?.["openrouter/unverified-model"];
    assert.deepEqual(probedTiers, [...SERVICE_TIERS]);
    assert.equal(entry?.provider, "openrouter");
    assert.equal(entry?.id, "unverified-model");
    assert.equal(entry?.api, "openai-completions");
    assert.equal(entry?.source, "probe");
    assert.equal(entry?.determined, true);
    assert.deepEqual(entry?.tiers, [...SERVICE_TIERS]);
    assert.equal(entry?.unsupportedTiers, undefined);
    assert.equal(
      harness.notifications.some(({ message }) => message.includes("auto-probe started")),
      true,
    );
    const secondPayload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "unverified-model" } } as never, harness.ctx);
    assert.deepEqual(secondPayload, { model: "unverified-model", service_tier: "flex" });
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
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
    assert.equal(readMap(paths.map)?.entries?.["openrouter/unverified-model"]?.source, "preset");

    const payload = await harness.handlers.get("before_provider_request")?.({ payload: { model: "unverified-model" } } as never, harness.ctx);
    assert.deepEqual(payload, { model: "unverified-model", service_tier: "flex" });

    firstProbe.resolve("supported");
    await _test.waitForAutoProbesForTest();
    const entry = readMap(paths.map)?.entries?.["openrouter/unverified-model"];
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier) => (tier === "auto" ? "unknown" : "supported"));
  try {
    const paths = configPaths(cwd, home);
    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await _test.waitForAutoProbesForTest();
    const entry = readMap(paths.map)?.entries?.["openrouter/unverified-model"];
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
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
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
    const entry = readMap(paths.map)?.entries?.["openrouter/unverified-model"];
    assert.deepEqual(probedTiers, [...SERVICE_TIERS]);
    assert.equal(entry?.provider, "openrouter");
    assert.equal(entry?.id, "unverified-model");
    assert.equal(entry?.api, "openai-completions");
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

test("off requests clear previous injection tracking and cannot mark other payloads unsupported", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  try {
    const paths = configPaths(cwd, home);
    const key = modelKey(openAIModel)!;
    writeConfig(paths.user, { entries: { [key]: { active: true, serviceTier: "priority" } } });
    writeMap(paths.map, { entries: { [key]: buildPresetMapEntry(openAIModel) } });
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    assert.deepEqual(await harness.handlers.get("before_provider_request")?.({ payload: {} } as never, harness.ctx), { service_tier: "priority" });
    writeFileSync(paths.user, JSON.stringify({ version: 2, entries: { [key]: { active: true, serviceTier: "fleex" } } }));
    await harness.commands.get("service-tier-user")?.handler("status", harness.ctx);
    const payload = { service_tier: "default" };
    assert.equal(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), undefined);
    assert.deepEqual(payload, { service_tier: "default" });
    const before = readFileSync(paths.map, "utf8");
    await harness.handlers.get("message_end")?.({ message: { role: "assistant", errorMessage: "Invalid service_tier" } } as never, harness.ctx);
    assert.equal(readFileSync(paths.map, "utf8"), before);
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


test("service-tier eligibility is fail-closed and provider/API-specific", () => {
  for (const [provider, apis] of [
    ["openai", ["openai-responses", "openai-completions"]],
    ["openai-codex", ["openai-codex-responses"]],
    ["openrouter", ["openai-completions", "openai-responses", "anthropic-messages"]],
    ["xai", ["openai-completions", "openai-responses"]],
    ["groq", ["openai-completions"]],
  ] as const) {
    assert.equal(isServiceTierProviderSupported(provider), true);
    for (const api of apis) assert.equal(isServiceTierModelSupported({ provider, api }), true);
    assert.equal(isServiceTierModelSupported({ provider }), false);
    assert.equal(isServiceTierModelSupported({ provider, api: "unknown-api" }), false);
  }
  assert.equal(isServiceTierModelSupported(undefined), false);
  for (const model of blockedModels) assert.equal(isServiceTierModelSupported(model), false);
});

for (const model of blockedModels) {
  const identity = model as { provider: string; id: string; api: string };
  test(`blocks all service-tier interactions for ${identity.provider}/${identity.api}, preserving manual settings`, async () => {
    for (const behavior of UNKNOWN_MODEL_BEHAVIORS) {
      const cwd = tempDir();
      const home = tempDir();
      const harness = createExtensionHarness(cwd, home, model);
      let probes = 0;
      let registryCalls = 0;
      const restoreProbe = _test.setProbeTierForTest(async () => { probes++; return "supported"; });
      try {
        const paths = configPaths(cwd, home);
        const key = modelKey(model)!;
        writeConfig(paths.user, { unknownModelBehavior: behavior, entries: { [key]: { active: true, serviceTier: "priority" } } });
        writeConfig(paths.project, { entries: { [key]: { active: true, serviceTier: "ultrafast" } } });
        writeMap(paths.map, { entries: { [key]: {
          ...buildPresetMapEntry(model), determined: true, tiers: [...SERVICE_TIERS], source: "probe",
        } } });
        const before = [paths.user, paths.project, paths.map].map((path) => readFileSync(path, "utf8"));
        await harness.handlers.get("session_start")?.({} as never, harness.ctx);
        for (const command of harness.commands.values()) {
          assert.equal(command.getArgumentCompletions?.(""), command.getArgumentCompletions ? null : undefined);
          for (const arg of ["", "on", "off", "status", "priority", "auto-probe"]) await command.handler(arg, harness.ctx);
        }
        const config = resolveEffectiveConfig(cwd, home);
        assert.equal(configuredTierForModel(config, model), undefined);
        assert.equal(resolveTierForModel(config, readMap(paths.map)!, model), undefined);
        assert.equal(mapSupportsTier(readMap(paths.map), key, "priority"), false);
        assert.equal(_test.statusText(config, readMap(paths.map)!, model), undefined);
        const original = { model: identity.id, service_tier: "default" };
        assert.equal(await harness.handlers.get("before_provider_request")?.({ payload: original } as never, harness.ctx), undefined);
        assert.deepEqual(original, { model: identity.id, service_tier: "default" });
        await harness.handlers.get("message_end")?.({ message: { role: "assistant", errorMessage: "Invalid service_tier" } } as never, harness.ctx);
        assert.equal(await _test.runAutoProbeForCurrentTier(harness.ctx, key, "priority"), "unknown");
        const probeCtx = { modelRegistry: { streamSimple: () => { registryCalls++; throw new Error("Must not resolve a blocked provider"); } } } as never;
        assert.equal(await _test.defaultProbeTier(model, "priority", probeCtx), "unknown");
        const map = readMap(paths.map)!;
        assert.equal(_test.seedPresetMapEntryIfMissing(paths.map, map, model), map);
        assert.equal(_test.refreshPresetMapEntry(paths.map, map, model, "priority"), map);
        await _test.waitForAutoProbesForTest();
        assert.equal(probes, 0);
        assert.equal(registryCalls, 0);
        assert.equal(harness.prompts.length, 0);
        assert.ok(harness.statuses.every(({ value }) => value === undefined));
        assert.ok(harness.notifications.every(({ message, type }) => message.includes("blocked") && type === "error"));
        assert.deepEqual([paths.user, paths.project, paths.map].map((path) => readFileSync(path, "utf8")), before);
      } finally {
        restoreProbe();
        harness.restore();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    }
  });
}

test("blocked startup and commands do not create config or support-map files", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, blockedModels[0]);
  try {
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    for (const command of harness.commands.values()) await command.handler("on", harness.ctx);
    await harness.handlers.get("before_provider_request")?.({ payload: {} } as never, harness.ctx);
    const paths = configPaths(cwd, home);
    const emptyMap = { entries: {} };
    assert.equal(_test.seedPresetMapEntryIfMissing(paths.map, emptyMap, blockedModels[0]), emptyMap);
    assert.equal(_test.refreshPresetMapEntry(paths.map, emptyMap, blockedModels[0], "priority"), emptyMap);
    for (const path of [paths.user, paths.project, paths.map]) assert.equal(existsSync(path), false);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("refresh-all and unset-all skip blocked routes and preserve their stored records", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, openAIModel, [openAIModel, unknownRouterModel, ...blockedModels]);
  try {
    const paths = configPaths(cwd, home);
    const retained = buildPresetMapEntry(blockedModels[0]);
    writeMap(paths.map, { entries: { [modelKey(blockedModels[0])!]: retained } });
    await harness.commands.get("service-tier-refresh-support-all")?.handler("", harness.ctx);
    const refreshed = readMap(paths.map)!;
    assert.deepEqual(Object.keys(refreshed.entries!).sort(), [modelKey(openAIModel)!, modelKey(unknownRouterModel)!, modelKey(blockedModels[0])!].sort());
    assert.deepEqual(refreshed.entries?.[modelKey(blockedModels[0])!], retained);
    await harness.commands.get("service-tier-unset-support-all")?.handler("", harness.ctx);
    assert.deepEqual(readMap(paths.map)?.entries, { [modelKey(blockedModels[0])!]: retained });
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("model changes hide blocked UI and restore supported commands and completions", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, blockedModels[0]);
  try {
    const paths = configPaths(cwd, home);
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    const command = harness.commands.get("service-tier-project")!;
    const editor = harness.autocompleteProviders[0]({
      getSuggestions: async () => null,
      applyCompletion: () => ({ lines: [], cursorLine: 0, cursorCol: 0 }),
    });
    const line = "/service-tier-project u";
    const options = { signal: new AbortController().signal };
    assert.equal(command.getArgumentCompletions?.("u"), null);
    assert.equal(await editor.getSuggestions([line], 0, line.length, options), null);
    harness.setModel(ultrafastModel);
    await harness.handlers.get("model_select")?.({} as never, harness.ctx);
    assert.deepEqual(command.getArgumentCompletions?.("u"), [{ value: "ultrafast", label: "ultrafast" }]);
    assert.deepEqual(await editor.getSuggestions([line], 0, line.length, options), { items: [{ value: "ultrafast", label: "ultrafast" }], prefix: "u" });
    await command.handler("ultrafast", harness.ctx);
    assert.equal(readConfig(paths.project)?.entries?.[modelKey(ultrafastModel)!].serviceTier, "ultrafast");
    const before = readFileSync(paths.project, "utf8");
    harness.setModel(blockedModels[0]);
    await harness.handlers.get("model_select")?.({} as never, harness.ctx);
    assert.equal(command.getArgumentCompletions?.("u"), null);
    assert.equal(await editor.getSuggestions([line], 0, line.length, options), null);
    assert.equal(harness.statuses.at(-1)?.value, undefined);
    await command.handler("priority", harness.ctx);
    assert.equal(readFileSync(paths.project, "utf8"), before);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("auto-probe stops without writing results when the selection changes to a blocked route", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  const first = deferred<"supported">();
  const calls: string[] = [];
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier) => { calls.push(tier); return first.promise; });
  try {
    const paths = configPaths(cwd, home);
    harness.selections.push("Auto-probe once");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    const before = readFileSync(paths.map, "utf8");
    harness.setModel(blockedModels[0]);
    await harness.handlers.get("model_select")?.({} as never, harness.ctx);
    first.resolve("supported");
    await _test.waitForAutoProbesForTest();
    assert.deepEqual(calls, ["priority"]);
    assert.equal(readFileSync(paths.map, "utf8"), before);
    assert.equal(harness.statuses.at(-1)?.value, undefined);
    assert.equal(harness.notifications.some(({ message }) => message.includes("auto-probe completed")), false);
  } finally {
    first.resolve("supported");
    await _test.waitForAutoProbesForTest();
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("probe payload hooks abort a resolved blocked route before a provider request", async () => {
  let signal: AbortSignal | undefined;
  const ctx = { modelRegistry: { streamSimple: (_model: unknown, _context: unknown, options: SimpleStreamOptions) => {
    signal = options.signal;
    return (async function* () {
      await options.onPayload?.({}, blockedModels[0]);
      assert.fail("A blocked route must not proceed to its SDK request");
      yield { type: "done" };
    })();
  } } } as never;
  assert.equal(await _test.defaultProbeTier(openAIModel, "priority", ctx), "unknown");
  assert.equal(signal?.aborted, true);
});

test("an outstanding support prompt cannot start a probe or change global behavior after a blocked model is selected", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  let probes = 0;
  const restoreProbe = _test.setProbeTierForTest(async () => { probes++; return "supported"; });
  try {
    const ctx = harness.ctx as ExtensionContext;
    ctx.ui.select = async () => {
      harness.setModel(blockedModels[0]);
      await harness.handlers.get("model_select")?.({} as never, harness.ctx);
      return "Always auto-probe";
    };
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await _test.waitForAutoProbesForTest();
    assert.equal(probes, 0);
    assert.equal(readConfig(configPaths(cwd, home).user), undefined);
    assert.equal(readMap(configPaths(cwd, home).map)?.entries?.[modelKey(unknownRouterModel)!].source, "preset");
    assert.equal(harness.statuses.at(-1)?.value, undefined);
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("config migration and unrelated writes do not synthesize tiers or reactivate invalid overrides", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    const key = modelKey(openAIModel)!;
    const retainedKey = modelKey(ultrafastModel)!;
    const retained = { active: true, serviceTier: "ultrafast" as const };
    writeConfig(paths.user, { entries: { [key]: { active: true, serviceTier: "flex" }, [retainedKey]: retained } });
    mkdirSync(dirname(paths.project), { recursive: true });
    for (const version of [1, 2]) {
      writeFileSync(paths.project, JSON.stringify({ version, entries: { [key]: { active: true, serviceTier: "fleex" } } }));
      assert.equal(configuredTierForModel(resolveEffectiveConfig(cwd, home), openAIModel), undefined);
      _test.migrateStartupFiles(paths);
      assert.deepEqual(JSON.parse(readFileSync(paths.project, "utf8")).entries[key], { active: false });
      setScopedUnknownModelBehavior(paths, "project", "auto-probe");
      const config = resolveEffectiveConfig(cwd, home);
      assert.equal(configuredTierForModel(config, openAIModel), undefined);
      assert.deepEqual(config.entries[retainedKey], retained);
    }
    writeFileSync(paths.project, JSON.stringify({ version: 1, entries: { [retainedKey]: { active: true } } }));
    _test.migrateStartupFiles(paths);
    assert.deepEqual(JSON.parse(readFileSync(paths.project, "utf8")).entries[retainedKey], { active: true });
    const withoutUser = mergeConfigs(undefined, readConfig(paths.project), paths);
    assert.deepEqual(withoutUser.entries[retainedKey], { active: false });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("missing and invalid manual tiers stay off through startup, status, hooks, and support maintenance", async () => {
  const key = modelKey(openAIModel)!;
  const cases = [
    { scope: "user", entry: { active: true } },
    { scope: "project", entry: { active: true } },
    ...["fleex", "off", "standard_only", "", null, 0, true, [], {}].flatMap((serviceTier) => [
      { scope: "user", entry: { active: true, serviceTier } },
      { scope: "project", entry: { active: true, serviceTier }, validUser: true },
    ]),
  ];
  for (const scenario of cases) {
    const cwd = tempDir();
    const home = tempDir();
    const harness = createExtensionHarness(cwd, home);
    let probes = 0;
    const restoreProbe = _test.setProbeTierForTest(async () => { probes++; return "supported"; });
    try {
      const paths = configPaths(cwd, home);
      const validUser = "validUser" in scenario && scenario.validUser;
      const userEntry = scenario.scope === "user" ? scenario.entry : validUser ? { active: true, serviceTier: "flex" } : undefined;
      const rawUser = { version: 2, unknownModelBehavior: "auto-probe", entries: userEntry ? { [key]: userEntry } : {} };
      mkdirSync(dirname(paths.user), { recursive: true });
      writeFileSync(paths.user, JSON.stringify(rawUser));
      if (scenario.scope === "project") {
        mkdirSync(dirname(paths.project), { recursive: true });
        writeFileSync(paths.project, JSON.stringify({ version: 2, entries: { [key]: scenario.entry } }));
      }
      writeMap(paths.map, { entries: { [key]: buildPresetMapEntry(openAIModel) } });
      await harness.handlers.get("session_start")?.({} as never, harness.ctx);
      const config = resolveEffectiveConfig(cwd, home);
      assert.equal(config.entries[key].active, false);
      assert.equal(configuredTierForModel(config, openAIModel), undefined);
      for (const payload of [{ model: "gpt-5.5" }, { model: "gpt-5.5", service_tier: "default" }]) {
        const original = { ...payload };
        assert.equal(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), undefined);
        assert.deepEqual(payload, original);
      }
      for (const command of ["service-tier-project", "service-tier-user", "fast-project", "fast-user"]) {
        await harness.commands.get(command)?.handler("status", harness.ctx);
      }
      await harness.commands.get("service-tier-refresh-support")?.handler("", harness.ctx);
      await harness.commands.get("service-tier-refresh-support-all")?.handler("", harness.ctx);
      await _test.waitForAutoProbesForTest();
      assert.equal(probes, 0);
      assert.equal(harness.prompts.length, 0);
      // The fork additionally publishes its session-local Fast status under a distinct key.
      assert.ok(harness.statuses.filter(({ key }) => key === _test.STATUS_KEY).every(({ value }) => value === "service_tier ○ off"));
      const statuses = harness.notifications.filter(({ message }) => message.includes("effective:"));
      assert.equal(statuses.length, 4);
      assert.ok(statuses.every(({ message }) => message.includes("effective: off")));
    } finally {
      restoreProbe();
      harness.restore();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("fast commands explicitly select priority and recover from invalid or missing tiers", async () => {
  const key = modelKey(openAIModel)!;
  for (const command of ["service-tier-fast-project", "service-tier-fast-user", "fast-project", "fast-user"]) {
    for (const entry of [{ active: true }, { active: true, serviceTier: "fleex" }]) {
      const cwd = tempDir();
      const home = tempDir();
      const harness = createExtensionHarness(cwd, home);
      try {
        const paths = configPaths(cwd, home);
        const path = command.endsWith("project") ? paths.project : paths.user;
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ version: 2, unknownModelBehavior: "leave-unknown", entries: { [key]: entry } }));
        await harness.handlers.get("session_start")?.({} as never, harness.ctx);
        await harness.commands.get(command)?.handler("", harness.ctx);
        assert.deepEqual(readConfig(path)?.entries?.[key], { active: true, serviceTier: "priority" });
        const payload = { model: "gpt-5.5" };
        assert.deepEqual(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), { ...payload, service_tier: "priority" });
        assert.deepEqual(payload, { model: "gpt-5.5" });
      } finally {
        harness.restore();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    }
  }
});

test("explicit tier commands repair invalid overrides without dropping unrelated entries", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  try {
    const paths = configPaths(cwd, home);
    const key = modelKey(openAIModel)!;
    const retainedKey = modelKey(ultrafastModel)!;
    const retained = { active: true, serviceTier: "ultrafast" as const };
    writeConfig(paths.user, { entries: { [key]: { active: true, serviceTier: "priority" } } });
    mkdirSync(dirname(paths.project), { recursive: true });
    writeFileSync(paths.project, JSON.stringify({ version: 2, entries: { [key]: { active: true, serviceTier: "fleex" }, [retainedKey]: retained } }));
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    assert.deepEqual(readConfig(paths.project)?.entries, { [key]: { active: true, serviceTier: "flex" }, [retainedKey]: retained });
    assert.deepEqual(await harness.handlers.get("before_provider_request")?.({ payload: {} } as never, harness.ctx), { service_tier: "flex" });
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("whole-scope JSON/schema errors are distinct from missing files and cannot fall back or be overwritten", () => {
  const cwd = tempDir();
  const home = tempDir();
  const paths = configPaths(cwd, home);
  const key = modelKey(openAIModel)!;
  const valid: ConfigFile = { version: 1, entries: { [key]: { active: true, serviceTier: "priority" } } };
  const invalidContents = [
    '{ "private-marker": "do-not-log", broken json',
    ...[null, [], true, 7, "text", { entries: [] }, { entries: null }, { entries: "bad" },
      { version: 3, entries: {} }, { version: "2", entries: {} }, { version: 0 },
      { unknownModelBehavior: "turbo", entries: {} }].map((value) => JSON.stringify(value)),
  ];
  try {
    assert.equal(readConfig(paths.user), undefined);
    writeConfig(paths.user, valid);
    assert.equal(configuredTierForModel(resolveEffectiveConfig(cwd, home), openAIModel), "priority");
    ensureConfig(paths.project);
    assert.equal(configuredTierForModel(resolveEffectiveConfig(cwd, home), openAIModel), "priority");

    for (const scope of ["project", "user"] as const) {
      const other = scope === "project" ? "user" : "project";
      for (const contents of invalidContents) {
        writeFileSync(paths[other], JSON.stringify(valid));
        writeFileSync(paths[scope], contents);
        const beforeOther = readFileSync(paths[other], "utf8");
        assert.throws(() => readConfig(paths[scope]), (error: unknown) =>
          error instanceof ConfigFileError && !error.message.includes("do-not-log"));
        const effective = resolveEffectiveConfig(cwd, home);
        assert.equal(effective.configIssues?.length, 1);
        assert.equal(effective.configIssues?.[0].path, paths[scope]);
        assert.equal(configuredTierForModel(effective, openAIModel), undefined);
        assert.equal(_test.statusText(effective, {}, openAIModel), "service_tier ○ off (config error)");
        for (const action of [
          () => ensureConfig(paths[scope]),
          () => writeConfig(paths[scope], valid),
          () => setScopedEntry(paths, scope, key, { active: false }),
          () => setScopedEntry(paths, other, key, { active: true, serviceTier: "flex" }),
          () => setScopedUnknownModelBehavior(paths, other, "auto-probe"),
          () => _test.migrateStartupFiles(paths),
        ]) assert.throws(action, ConfigFileError);
        assert.equal(readFileSync(paths[scope], "utf8"), contents);
        assert.equal(readFileSync(paths[other], "utf8"), beforeOther);
        assert.equal(existsSync(paths.map), false);
      }
    }
    const direct = mergeConfigs(valid as ConfigFile, { entries: [] } as never, paths);
    assert.equal(configuredTierForModel(direct, openAIModel), undefined);
    assert.equal(direct.configIssues?.[0].reason, "schema");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("unreadable configs and dangling symlinks are errors, not opportunities to create defaults", () => {
  const cwd = tempDir();
  const home = tempDir();
  const paths = configPaths(cwd, home);
  const missingTarget = join(cwd, "missing-config-target.json");
  try {
    writeConfig(paths.user, { entries: { [modelKey(openAIModel)!]: { active: true, serviceTier: "priority" } } });
    mkdirSync(paths.project, { recursive: true });
    assert.throws(() => ensureConfig(paths.project), (error: unknown) => error instanceof ConfigFileError && error.issue.reason === "read");
    assert.equal(configuredTierForModel(resolveEffectiveConfig(cwd, home), openAIModel), undefined);
    rmSync(paths.project, { recursive: true });
    symlinkSync(missingTarget, paths.project);
    assert.throws(() => ensureConfig(paths.project), ConfigFileError);
    assert.throws(() => writeConfig(paths.project, {}), ConfigFileError);
    assert.equal(resolveEffectiveConfig(cwd, home).configIssues?.[0].reason, "read");
    assert.equal(readlinkSync(paths.project), missingTarget);
    assert.equal(existsSync(missingTarget), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("config errors suspend lifecycle, commands, request injection and support writes without changing originals", async () => {
  for (const scope of ["project", "user"] as const) {
    for (const contents of ["{ bad json", JSON.stringify({ version: 2, entries: [] })]) {
      const cwd = tempDir();
      const home = tempDir();
      const harness = createExtensionHarness(cwd, home);
      const paths = configPaths(cwd, home);
      let probes = 0;
      let availableCalls = 0;
      const restoreProbe = _test.setProbeTierForTest(async () => { probes++; return "supported"; });
      try {
        for (const path of [paths.user, paths.project]) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, JSON.stringify({ version: 1, unknownModelBehavior: "auto-probe", entries: {
            [modelKey(openAIModel)!]: { active: true, serviceTier: "priority" },
          } }));
        }
        writeFileSync(paths[scope], contents);
        writeMap(paths.map, { entries: { [modelKey(openAIModel)!]: { ...buildPresetMapEntry(openAIModel), source: "probe" } } });
        const before = [paths.user, paths.project, paths.map].map((path) => readFileSync(path, "utf8"));
        (harness.ctx as ExtensionContext).modelRegistry.getAvailable = () => { availableCalls++; return []; };
        await harness.handlers.get("session_start")?.({} as never, harness.ctx);
        await harness.handlers.get("model_select")?.({} as never, harness.ctx);
        for (const command of harness.commands.values()) {
          for (const arg of ["status", "off", "priority", "auto-probe"]) await command.handler(arg, harness.ctx);
        }
        const original = { model: "gpt-5.5", service_tier: "default" };
        assert.equal(await harness.handlers.get("before_provider_request")?.({ payload: original } as never, harness.ctx), undefined);
        assert.deepEqual(original, { model: "gpt-5.5", service_tier: "default" });
        await harness.handlers.get("message_end")?.({ message: { role: "assistant", errorMessage: "Invalid service_tier" } } as never, harness.ctx);
        await _test.waitForAutoProbesForTest();
        assert.equal(probes, 0);
        assert.equal(availableCalls, 0);
        assert.equal(harness.prompts.length, 0);
        assert.equal(harness.notifications.filter(({ type }) => type === "error").length, 1);
        assert.ok(harness.notifications.some(({ message }) => message.includes(paths[scope])));
        assert.equal(harness.statuses.at(-1)?.value, "service_tier ○ off (config error)");
        assert.deepEqual([paths.user, paths.project, paths.map].map((path) => readFileSync(path, "utf8")), before);
      } finally {
        restoreProbe();
        harness.restore();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    }
  }
});

test("config errors introduced after injection invalidate cached tiers and preserve support evidence until external repair", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  const paths = configPaths(cwd, home);
  const key = modelKey(openAIModel)!;
  try {
    writeConfig(paths.user, { entries: { [key]: { active: true, serviceTier: "priority" } } });
    await harness.handlers.get("session_start")?.({} as never, harness.ctx);
    const payload = { model: "gpt-5.5" };
    assert.deepEqual(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), { ...payload, service_tier: "priority" });
    mkdirSync(dirname(paths.project), { recursive: true });
    writeFileSync(paths.project, "{ broken");
    const beforeMap = readFileSync(paths.map, "utf8");
    // No status command or reload occurs between the edit and the request/error.
    await harness.handlers.get("message_end")?.({ message: { role: "assistant", errorMessage: "Invalid service_tier" } } as never, harness.ctx);
    assert.equal(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), undefined);
    assert.equal(readFileSync(paths.map, "utf8"), beforeMap);
    assert.equal(readFileSync(paths.project, "utf8"), "{ broken");
    writeFileSync(paths.project, JSON.stringify({ version: 2, entries: { [key]: { active: true, serviceTier: "flex" } } }));
    assert.deepEqual(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), { ...payload, service_tier: "flex" });
    assert.ok(harness.statuses.at(-1)?.value?.includes("flex"));
    assert.equal(harness.statuses.at(-1)?.value?.includes("off"), false);
    writeFileSync(paths.project, JSON.stringify({ entries: { [key]: { active: false } } }));
    assert.equal(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), undefined);
    assert.equal(harness.statuses.at(-1)?.value, "service_tier ○ off");
    writeFileSync(paths.project, JSON.stringify({ entries: { [key]: { active: true, serviceTier: "ultrafast" } } }));
    assert.deepEqual(await harness.handlers.get("before_provider_request")?.({ payload } as never, harness.ctx), { ...payload, service_tier: "ultrafast" });
    assert.ok(harness.statuses.at(-1)?.value?.includes("ultrafast"));
    assert.deepEqual(payload, { model: "gpt-5.5" });
    assert.equal(harness.prompts.length, 0);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

async function expectAutoProbesToSettle(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      _test.waitForAutoProbesForTest(),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Cancelled probes did not settle")), 1500); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test("off reaches the real probe implementation's SDK signal and blocks late payload hooks", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home);
  const entered = deferred<void>();
  const release = deferred<void>();
  let sdkSignal: AbortSignal | undefined;
  let payloadHook: SimpleStreamOptions["onPayload"];
  let streams = 0;
  try {
    const paths = configPaths(cwd, home);
    setScopedUnknownModelBehavior(paths, "user", "auto-probe");
    (harness.ctx as ExtensionContext).modelRegistry.streamSimple = (model, _context, options = {}) => {
      streams++;
      sdkSignal = options.signal;
      payloadHook = options.onPayload;
      return (async function* () {
        assert.deepEqual(await payloadHook?.({}, model), { service_tier: "priority" });
        entered.resolve();
        await release.promise;
        yield { type: "done" };
      })() as never;
    };
    await harness.commands.get("service-tier-project")?.handler("priority", harness.ctx);
    await entered.promise;
    const beforeMap = readFileSync(paths.map, "utf8");
    await harness.commands.get("service-tier-project")?.handler("off", harness.ctx);
    assert.equal(sdkSignal?.aborted, true);
    await expectAutoProbesToSettle();
    await assert.rejects(async () => payloadHook?.({}, openAIModel), /probe cancelled/);
    assert.equal(streams, 1);
    assert.equal(readFileSync(paths.map, "utf8"), beforeMap);
    release.resolve();
    await Promise.resolve();
    assert.equal(readFileSync(paths.map, "utf8"), beforeMap);
    assert.equal(harness.notifications.some(({ message }) => message.includes("auto-probe completed")), false);
  } finally {
    release.resolve();
    await _test.waitForAutoProbesForTest();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("default probes forward cancellation to the registry signal and close non-cooperative streams promptly", async () => {
  const parent = new AbortController();
  const next = deferred<never>();
  let registrySignal: AbortSignal | undefined;
  let closed = false;
  const ctx = { modelRegistry: { streamSimple: (_model: unknown, _context: unknown, options: SimpleStreamOptions) => {
    registrySignal = options.signal;
    return { [Symbol.asyncIterator]: () => ({ next: () => next.promise, return: async () => { closed = true; return { done: true }; } }) };
  } } } as never;
  const probe = _test.defaultProbeTier(openAIModel, "priority", ctx, parent.signal);
  try {
    assert.equal(registrySignal?.aborted, false);
    parent.abort();
    assert.equal(registrySignal?.aborted, true);
    assert.equal(await probe, "unknown");
    assert.equal(closed, true);
    assert.equal(getEventListeners(parent.signal, "abort").length, 0);
    assert.equal(getEventListeners(registrySignal!, "abort").length, 0);
  } finally {
    parent.abort();
    next.resolve({ done: true } as never);
    await probe;
  }
  const aborted = new AbortController();
  aborted.abort();
  const noCalls = { modelRegistry: { streamSimple: () => assert.fail("Already cancelled probes must not open a stream") } } as never;
  assert.equal(await _test.defaultProbeTier(openAIModel, "priority", noCalls, aborted.signal), "unknown");
});

test("all tier/fast off commands and fast-off toggles cancel pending probes without waiting for or saving late results", async () => {
  const cases = [
    ...["service-tier-project", "service-tier-user", "service-tier-fast-project", "service-tier-fast-user", "fast-project", "fast-user"]
      .map((command) => ({ command, arg: "off" })),
    { command: "fast-project", arg: "" },
    { command: "service-tier-fast-user", arg: "" },
  ];
  for (const { command, arg } of cases) {
    const cwd = tempDir();
    const home = tempDir();
    // This fork restricts priority/Fast to GPT IDs; keep the upstream cancellation assertion on an unknown GPT route.
    const model = { ...unknownRouterModel as object, id: "gpt-unverified-model" } as never;
    const harness = createExtensionHarness(cwd, home, model);
    const first = deferred<"supported">();
    const calls: string[] = [];
    let signal: AbortSignal | undefined;
    const restoreProbe = _test.setProbeTierForTest(async (_model, tier, _ctx, currentSignal) => {
      calls.push(tier); signal = currentSignal; return first.promise;
    });
    try {
      const paths = configPaths(cwd, home);
      const scope = command.endsWith("project") ? "project" : "user";
      setScopedUnknownModelBehavior(paths, "user", "auto-probe");
      await harness.commands.get(`service-tier-${scope}`)?.handler("priority", harness.ctx);
      assert.deepEqual(calls, ["priority"]);
      const beforeMap = readFileSync(paths.map, "utf8");
      await harness.commands.get(command)?.handler(arg, harness.ctx);
      assert.equal(signal?.aborted, true, command);
      await expectAutoProbesToSettle();
      assert.deepEqual(calls, ["priority"]);
      assert.equal(getEventListeners(signal!, "abort").length, 0);
      assert.equal(readFileSync(paths.map, "utf8"), beforeMap);
      assert.equal(harness.statuses.at(-1)?.value, "service_tier ○ off");
      assert.equal(await harness.handlers.get("before_provider_request")?.({ payload: {} } as never, harness.ctx), undefined);
      first.resolve("supported");
      await Promise.resolve();
      assert.equal(readFileSync(paths.map, "utf8"), beforeMap);
      assert.equal(harness.notifications.some(({ message }) => message.includes("auto-probe completed")), false);
    } finally {
      first.resolve("supported");
      await _test.waitForAutoProbesForTest();
      restoreProbe();
      harness.restore();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("off then on creates a new probe without allowing the cancelled cycle to resume or replace its status", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  const first = deferred<"supported">();
  const second = deferred<"unsupported">();
  const signals: Array<AbortSignal | undefined> = [];
  let cycle = 0;
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier, _ctx, signal) => {
    if (tier === "priority") { cycle++; signals.push(signal); }
    return cycle === 1 ? first.promise : second.promise;
  });
  try {
    const paths = configPaths(cwd, home);
    setScopedUnknownModelBehavior(paths, "user", "auto-probe");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await harness.commands.get("service-tier-project")?.handler("off", harness.ctx);
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    const before = readFileSync(paths.map, "utf8");
    assert.equal(signals[0]?.aborted, true);
    assert.equal(signals[1]?.aborted, false);
    first.resolve("supported");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(readFileSync(paths.map, "utf8"), before);
    assert.ok(harness.statuses.at(-1)?.value?.includes("probing"));
    second.resolve("unsupported");
    await expectAutoProbesToSettle();
    assert.equal(cycle, 2);
    assert.deepEqual(readMap(paths.map)?.entries?.[modelKey(unknownRouterModel)!].tiers, []);
    assert.deepEqual(readMap(paths.map)?.entries?.[modelKey(unknownRouterModel)!].unsupportedTiers, [...SERVICE_TIERS]);
    assert.equal(harness.notifications.filter(({ message }) => message.includes("auto-probe completed")).length, 1);
  } finally {
    first.resolve("supported");
    second.resolve("unsupported");
    await _test.waitForAutoProbesForTest();
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("debug off does not disable a configured tier or cancel its probe", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  const first = deferred<"supported">();
  let signal: AbortSignal | undefined;
  const restoreProbe = _test.setProbeTierForTest(async (_model, _tier, _ctx, currentSignal) => { signal = currentSignal; return first.promise; });
  try {
    const paths = configPaths(cwd, home);
    setScopedUnknownModelBehavior(paths, "user", "auto-probe");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await harness.commands.get("service-tier-debug")?.handler("off", harness.ctx);
    assert.equal(signal?.aborted, false);
    assert.equal(configuredTierForModel(resolveEffectiveConfig(cwd, home), unknownRouterModel), "flex");
    first.resolve("supported");
    await expectAutoProbesToSettle();
    assert.equal(harness.notifications.some(({ message }) => message.includes("auto-probe completed")), true);
  } finally {
    first.resolve("supported");
    await _test.waitForAutoProbesForTest();
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("manual off and whole-config errors abort a pending probe via its guard without a command or reload", async () => {
  for (const invalid of [false, true]) {
    const cwd = tempDir();
    const home = tempDir();
    const harness = createExtensionHarness(cwd, home, unknownRouterModel);
    const first = deferred<"supported">();
    const calls: string[] = [];
    let signal: AbortSignal | undefined;
    const restoreProbe = _test.setProbeTierForTest(async (_model, tier, _ctx, currentSignal) => {
      calls.push(tier); signal = currentSignal; return first.promise;
    });
    try {
      const paths = configPaths(cwd, home);
      setScopedUnknownModelBehavior(paths, "user", "auto-probe");
      await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
      const beforeMap = readFileSync(paths.map, "utf8");
      if (invalid) writeFileSync(paths.project, "{ broken");
      else setScopedEntry(paths, "project", modelKey(unknownRouterModel)!, { active: false });
      await expectAutoProbesToSettle();
      assert.equal(signal?.aborted, true);
      assert.deepEqual(calls, ["priority"]);
      assert.equal(readFileSync(paths.map, "utf8"), beforeMap);
      assert.equal(harness.statuses.at(-1)?.value, invalid ? "service_tier ○ off (config error)" : "service_tier ○ off");
      if (invalid) assert.equal(readFileSync(paths.project, "utf8"), "{ broken");
    } finally {
      first.resolve("supported");
      await _test.waitForAutoProbesForTest();
      restoreProbe();
      harness.restore();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("off prevents the next probe even when the current mock returns supported immediately", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  const paths = configPaths(cwd, home);
  const key = modelKey(unknownRouterModel)!;
  const calls: string[] = [];
  let signal: AbortSignal | undefined;
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier, _ctx, currentSignal) => {
    calls.push(tier); signal = currentSignal;
    setScopedEntry(paths, "project", key, { active: false });
    return "supported";
  });
  try {
    setScopedUnknownModelBehavior(paths, "user", "auto-probe");
    await harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
    await expectAutoProbesToSettle();
    assert.deepEqual(calls, ["priority"]);
    assert.equal(signal?.aborted, true);
    assert.equal(readMap(paths.map)?.entries?.[key].source, "preset");
    assert.equal(harness.notifications.some(({ message }) => message.includes("auto-probe completed")), false);
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("an off command invalidates outstanding probe prompts even if the tier is later reactivated", async () => {
  for (const reactivate of [false, true]) {
    const cwd = tempDir();
    const home = tempDir();
    const harness = createExtensionHarness(cwd, home, unknownRouterModel);
    const prompt = deferred<void>();
    const choice = deferred<string>();
    let probes = 0;
    const restoreProbe = _test.setProbeTierForTest(async () => { probes++; return "supported"; });
    let enable: Promise<void> | void = undefined;
    try {
      const ctx = harness.ctx as ExtensionContext;
      ctx.ui.select = async () => { prompt.resolve(); return choice.promise; };
      enable = harness.commands.get("service-tier-project")?.handler("flex", harness.ctx);
      await prompt.promise;
      await harness.commands.get("fast-project")?.handler("off", harness.ctx);
      const paths = configPaths(cwd, home);
      if (reactivate) setScopedEntry(paths, "project", modelKey(unknownRouterModel)!, { active: true, serviceTier: "flex" });
      const before = readFileSync(paths.map, "utf8");
      choice.resolve("Always auto-probe");
      await enable;
      await expectAutoProbesToSettle();
      assert.equal(probes, 0);
      assert.equal(readConfig(paths.user)?.unknownModelBehavior, undefined);
      assert.equal(readFileSync(paths.map, "utf8"), before);
    } finally {
      choice.resolve("Always auto-probe");
      await enable;
      await _test.waitForAutoProbesForTest();
      restoreProbe();
      harness.restore();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("shutdown cancels only its extension instance and cannot restore stale status or save late probe results", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const firstHarness = createExtensionHarness(cwd, home, unknownRouterModel);
  const secondHarness = createExtensionHarness(cwd, home, unknownRouterModel);
  const first = deferred<"supported">();
  const second = deferred<"supported">();
  const calls = new Map<unknown, string[]>();
  const signals = new Map<unknown, AbortSignal | undefined>();
  const restoreProbe = _test.setProbeTierForTest(async (_model, tier, ctx, signal) => {
    calls.set(ctx, [...calls.get(ctx) ?? [], tier]);
    signals.set(ctx, signal);
    return ctx === firstHarness.ctx ? first.promise : second.promise;
  });
  try {
    const paths = configPaths(cwd, home);
    setScopedUnknownModelBehavior(paths, "user", "auto-probe");
    await firstHarness.commands.get("service-tier-project")?.handler("flex", firstHarness.ctx);
    await secondHarness.commands.get("service-tier-project")?.handler("flex", secondHarness.ctx);
    await firstHarness.handlers.get("session_shutdown")?.({} as never, firstHarness.ctx);
    assert.equal(signals.get(firstHarness.ctx)?.aborted, true);
    assert.equal(signals.get(secondHarness.ctx)?.aborted, false);
    first.resolve("supported");
    second.resolve("supported");
    await expectAutoProbesToSettle();
    assert.deepEqual(calls.get(firstHarness.ctx), ["priority"]);
    assert.deepEqual(calls.get(secondHarness.ctx), [...SERVICE_TIERS]);
    assert.equal(firstHarness.statuses.at(-1)?.value, undefined);
    assert.equal(await firstHarness.handlers.get("before_provider_request")?.({ payload: {} } as never, firstHarness.ctx), undefined);
    assert.equal(firstHarness.notifications.some(({ message }) => message.includes("auto-probe completed")), false);
    assert.equal(secondHarness.notifications.some(({ message }) => message.includes("auto-probe completed")), true);
  } finally {
    first.resolve("supported");
    second.resolve("supported");
    await _test.waitForAutoProbesForTest();
    restoreProbe();
    secondHarness.restore();
    firstHarness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("non-GPT priority commands refuse configuration and paid probes", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, unknownRouterModel);
  let probes = 0;
  const restoreProbe = _test.setProbeTierForTest(async () => { probes++; return "supported"; });
  try {
    setScopedUnknownModelBehavior(configPaths(cwd, home), "user", "auto-probe");
    for (const scope of ["project", "user"]) {
      await harness.commands.get(`service-tier-${scope}`)?.handler("priority", harness.ctx);
      assert.equal(readConfig(configPaths(cwd, home)[scope as "project" | "user"])?.entries?.[modelKey(unknownRouterModel)!], undefined);
    }
    await _test.waitForAutoProbesForTest();
    assert.equal(probes, 0);
    assert.equal(harness.prompts.length, 0);
    assert.ok(harness.notifications.some(({ message }) => message.includes("仅支持 GPT")));
  } finally {
    restoreProbe();
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("Ctrl+Alt+F registers and toggles session Fast without changing persisted config", async () => {
  const cwd = tempDir();
  const home = tempDir();
  const harness = createExtensionHarness(cwd, home, openAIModel);
  try {
    const shortcut = harness.shortcuts.get("ctrl+alt+f");
    assert.ok(shortcut);
    await shortcut.handler(harness.ctx);
    assert.equal((harness.branch.at(-1)?.data as { active: boolean }).active, true);
    await shortcut.handler(harness.ctx);
    assert.equal((harness.branch.at(-1)?.data as { active: boolean }).active, false);
    assert.equal(readConfig(configPaths(cwd, home).project), undefined);
    assert.equal(readConfig(configPaths(cwd, home).user), undefined);
  } finally {
    harness.restore();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("benchmark rejects blocked providers and model-key overrides before starting Pi", () => {
  const temp = tempDir();
  try {
    for (const overrides of [
      { PST_BENCH_MODEL: "anthropic/blocked-model" },
      { PST_BENCH_MODEL: "google/blocked-model" },
      { PST_BENCH_MODEL: "google-vertex/blocked-model" },
      { PST_BENCH_MODEL: "amazon-bedrock/blocked-model" },
      { PST_BENCH_MODEL: "custom-provider/blocked-model" },
      { PST_BENCH_MODEL: "anthropic/blocked-model", PST_BENCH_MODEL_KEY: "openai/gpt-5.5" },
      { PST_BENCH_MODEL: "openai/gpt-5.5", PST_BENCH_MODEL_KEY: "anthropic/blocked-model" },
      { PST_BENCH_MODEL: "openai/gpt-5.5", PST_BENCH_PROVIDER: "anthropic" },
    ]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/benchmark-service-tier.mjs", import.meta.url))], {
        encoding: "utf8", timeout: 15_000,
        env: {
          ...process.env, HOME: temp, PI_CODING_AGENT_DIR: temp,
          PST_BENCH_PI_BIN: join(temp, "must-not-start-pi"),
          PST_BENCH_MODEL_KEY: "", PST_BENCH_PROVIDER: "", PST_BENCH_TIER: "priority",
          ...overrides,
        },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /benchmarking is blocked for unsupported provider/);
      assert.equal(result.stdout, "");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
