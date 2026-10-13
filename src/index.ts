import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Api, Context as ProviderContext, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PACKAGE_NAME = "pi-provider-service-tier";
const CONFIG_BASENAME = "pi-provider-service-tier.json";
const MAP_BASENAME = "pi-provider-service-tier-map.json";
const STATUS_KEY = "pi-provider-service-tier";
const STATUS_LABEL = "service_tier";
const STATUS_ICON = "⚡";
const STATUS_OFF_ICON = "○";
const STATUS_ACTIVE_ICON = "●";
const ANSI_RESET = "\u001b[0m";
const ANSI_GREEN = "\u001b[32m";
const CONFIG_VERSION = 2;
const MAP_VERSION = 2;
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_STOPPED = Symbol("probe-stopped");
const PROBE_STATUS_INTERVAL_MS = 120;
const PROBE_STATUS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const COMMAND_FAST_PROJECT = "service-tier-fast-project";
const COMMAND_FAST_USER = "service-tier-fast-user";
const COMMAND_FAST_PROJECT_ALIAS = "fast-project";
const COMMAND_FAST_USER_ALIAS = "fast-user";
const COMMAND_TIER_PROJECT = "service-tier-project";
const COMMAND_TIER_USER = "service-tier-user";
const COMMAND_REFRESH_SUPPORT = "service-tier-refresh-support";
const COMMAND_REFRESH_SUPPORT_ALL = "service-tier-refresh-support-all";
const COMMAND_UNSET_SUPPORT = "service-tier-unset-support";
const COMMAND_UNSET_SUPPORT_ALL = "service-tier-unset-support-all";
const COMMAND_UNKNOWN_BEHAVIOR = "service-tier-unknown-behavior";
const COMMAND_DEBUG = "service-tier-debug";

export const SERVICE_TIERS = ["priority", "flex", "default", "auto", "scale", "fast", "ultrafast"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];
export const UNKNOWN_MODEL_BEHAVIORS = ["ask", "auto-probe", "leave-unknown"] as const;
export type UnknownModelBehavior = (typeof UNKNOWN_MODEL_BEHAVIORS)[number];

// Package eligibility, not a guarantee of account/model-specific tier support.
// Native Anthropic, Google/Vertex, and Bedrock need separate tier/payload adapters.
const SUPPORTED_PROVIDER_APIS: Readonly<Record<string, readonly string[]>> = {
  openai: ["openai-responses", "openai-completions"],
  "openai-codex": ["openai-codex-responses"],
  openrouter: ["openai-completions", "openai-responses", "anthropic-messages"],
  xai: ["openai-completions", "openai-responses"],
  groq: ["openai-completions"],
};

type ServiceTierModelIdentity = Pick<Model<Api>, "provider"> & Partial<Pick<Model<Api>, "api">>;

export type ConfigScope = "project" | "user";
export type MapSource = "preset" | "probe" | "error" | "manual" | "user-mark";

export interface ServiceTierEntry {
  active?: boolean;
  serviceTier?: ServiceTier;
}

export interface ConfigFile {
  version?: number;
  unknownModelBehavior?: UnknownModelBehavior;
  entries?: Record<string, ServiceTierEntry>;
}

export interface ConfigIssue {
  path: string;
  reason: "read" | "json" | "schema" | "write";
}

export class ConfigFileError extends Error {
  readonly issue: ConfigIssue;

  constructor(issue: ConfigIssue) {
    super(issue.reason === "write"
      ? `Could not save service-tier config ${issue.path}. The change was not confirmed; inspect the file before retrying.`
      : `Cannot use service-tier config ${issue.path} (${issue.reason} error). Repair the file or move it aside; existing invalid files are not reset automatically.`);
    this.name = "ConfigFileError";
    this.issue = issue;
  }
}

export interface EffectiveConfig {
  unknownModelBehavior: UnknownModelBehavior;
  entries: Record<string, { active: boolean; serviceTier?: ServiceTier }>;
  paths: ConfigPaths;
  configIssues?: ConfigIssue[];
}

export interface ConfigPaths {
  project: string;
  user: string;
  map: string;
}

export interface ServiceTierMapEntry {
  provider: string;
  id: string;
  api?: string;
  determined: boolean;
  tiers: ServiceTier[];
  unsupportedTiers?: ServiceTier[];
  source: MapSource;
  updatedAt: string;
  error?: string;
}

export interface ServiceTierMapFile {
  version?: number;
  entries?: Record<string, ServiceTierMapEntry>;
}

const DEFAULT_UNKNOWN_MODEL_BEHAVIOR: UnknownModelBehavior = "ask";

const DEFAULT_CONFIG: ConfigFile = {
  version: CONFIG_VERSION,
  entries: {},
};

const DEFAULT_MAP: Required<ServiceTierMapFile> = {
  version: MAP_VERSION,
  entries: {},
};

interface LastAppliedTier {
  key: string;
  tier: ServiceTier;
  at: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isServiceTierProviderSupported(provider: string): boolean {
  return Object.hasOwn(SUPPORTED_PROVIDER_APIS, provider);
}

export function isServiceTierModelSupported(model: ServiceTierModelIdentity | undefined): boolean {
  return !!model && isServiceTierProviderSupported(model.provider) &&
    typeof model.api === "string" && SUPPORTED_PROVIDER_APIS[model.provider].includes(model.api);
}

export function isServiceTier(value: unknown): value is ServiceTier {
  return typeof value === "string" && (SERVICE_TIERS as readonly string[]).includes(value);
}

export function isUnknownModelBehavior(value: unknown): value is UnknownModelBehavior {
  return typeof value === "string" && (UNKNOWN_MODEL_BEHAVIORS as readonly string[]).includes(value);
}

function uniqueTiers(values: readonly ServiceTier[]): ServiceTier[] {
  return SERVICE_TIERS.filter((tier) => values.includes(tier));
}

function hasCompleteTierKnowledge(tiers: readonly ServiceTier[], unsupportedTiers: readonly ServiceTier[] = []): boolean {
  return SERVICE_TIERS.every((tier) => tiers.includes(tier) || unsupportedTiers.includes(tier));
}

function parseEntry(value: unknown): ServiceTierEntry | undefined {
  if (!isRecord(value)) return undefined;
  const entry: ServiceTierEntry = {};
  if (Object.hasOwn(value, "active")) entry.active = value.active === true;
  if (Object.hasOwn(value, "serviceTier")) {
    if (isServiceTier(value.serviceTier)) {
      entry.serviceTier = value.serviceTier;
    } else {
      // An explicit invalid tier must not revive a lower-scope tier after merging.
      entry.active = false;
    }
  }
  return entry;
}

function normalizeEntries(value: unknown): Record<string, ServiceTierEntry> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const entries: Record<string, ServiceTierEntry> = {};
  for (const [rawKey, rawEntry] of Object.entries(value)) {
    const key = normalizeModelKey(rawKey);
    if (key) entries[key] = parseEntry(rawEntry) ?? { active: false };
  }
  return entries;
}

function normalizeMapEntry(key: string, value: unknown): ServiceTierMapEntry | undefined {
  if (!isRecord(value)) return undefined;
  const parsed = parseModelKey(key);
  const provider = typeof value.provider === "string" && value.provider.trim() ? value.provider.trim() : parsed?.provider;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : parsed?.id;
  if (!provider || !id) return undefined;
  const tiers = Array.isArray(value.tiers) ? uniqueTiers(value.tiers.filter(isServiceTier)) : [];
  const unsupportedTiers = Array.isArray(value.unsupportedTiers)
    ? uniqueTiers(value.unsupportedTiers.filter(isServiceTier))
    : undefined;
  const source =
    value.source === "preset" ||
    value.source === "probe" ||
    value.source === "error" ||
    value.source === "manual" ||
    value.source === "user-mark"
      ? value.source
      : "manual";
  const determined =
    typeof value.determined === "boolean"
      ? value.determined
      : source === "probe"
        ? hasCompleteTierKnowledge(tiers, unsupportedTiers)
        : typeof value.supported === "boolean"
          ? value.supported
          : tiers.length > 0;
  return {
    provider,
    id,
    ...(typeof value.api === "string" ? { api: value.api } : {}),
    determined,
    tiers,
    ...(unsupportedTiers && unsupportedTiers.length > 0 ? { unsupportedTiers } : {}),
    source,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function normalizeMapEntries(value: unknown): Record<string, ServiceTierMapEntry> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const entries: Record<string, ServiceTierMapEntry> = {};
  for (const [rawKey, rawEntry] of Object.entries(value)) {
    const key = normalizeModelKey(rawKey);
    if (!key) continue;
    const entry = normalizeMapEntry(key, rawEntry);
    if (entry) entries[key] = entry;
  }
  return entries;
}

function loadBundledPresetEntries(): Record<string, ServiceTierMapEntry> {
  const presetDir = join(dirname(fileURLToPath(import.meta.url)), "..", "presets");
  if (!existsSync(presetDir)) return {};
  const entries: Record<string, ServiceTierMapEntry> = {};
  for (const file of readdirSync(presetDir).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(presetDir, file), "utf8")) as unknown;
      if (!isRecord(parsed)) continue;
      const normalized = normalizeMapEntries(parsed.entries);
      if (!normalized) continue;
      for (const [key, entry] of Object.entries(normalized)) {
        entries[key] = { ...entry, tiers: [...entry.tiers], source: "preset" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${PACKAGE_NAME}] Failed to read bundled preset ${file}: ${message}`);
    }
  }
  return entries;
}

const BUNDLED_PRESET_ENTRIES = loadBundledPresetEntries();

type PresetLookupModel = Pick<Model<Api>, "provider"> & Partial<Pick<Model<Api>, "id" | "api">>;

function bundledPresetEntryForModel(model: PresetLookupModel): ServiceTierMapEntry | undefined {
  if (!model.id || !isServiceTierModelSupported(model)) return undefined;
  const entry = BUNDLED_PRESET_ENTRIES[`${model.provider}/${model.id}`];
  if (!entry) return undefined;
  if (entry.api && entry.api !== model.api) return undefined;
  return {
    ...entry,
    provider: model.provider,
    id: model.id,
    api: model.api,
    tiers: [...entry.tiers],
    ...(entry.unsupportedTiers ? { unsupportedTiers: [...entry.unsupportedTiers] } : {}),
  };
}

export function parseModelKey(value: string): { provider: string; id: string } | undefined {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) return undefined;
  const provider = trimmed.slice(0, slash).trim();
  const id = trimmed.slice(slash + 1).trim();
  return provider && id ? { provider, id } : undefined;
}

export function normalizeModelKey(value: string): string | undefined {
  const parsed = parseModelKey(value);
  return parsed ? `${parsed.provider}/${parsed.id}` : undefined;
}

export function modelKey(model: Pick<Model<Api>, "provider" | "id"> | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

export function configPaths(cwd: string, home = homedir()): ConfigPaths {
  return {
    project: join(cwd, ".pi", "extensions", CONFIG_BASENAME),
    user: join(home, ".pi", "agent", "extensions", CONFIG_BASENAME),
    map: join(home, ".pi", "agent", "extensions", MAP_BASENAME),
  };
}

function readJsonFile(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${PACKAGE_NAME}] Failed to read ${path}: ${message}`);
    return undefined;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${PACKAGE_NAME}] Failed to write ${path}: ${message}`);
  }
}

function rawFileVersion(value: unknown): number {
  if (!isRecord(value)) return 1;
  return typeof value.version === "number" && Number.isInteger(value.version) && value.version > 0 ? value.version : 1;
}

function migrateConfigV1ToV2(value: unknown): ConfigFile {
  if (!isRecord(value)) return { ...DEFAULT_CONFIG };
  const config: ConfigFile = { version: 2 };
  const rawUnknownBehavior = value.unknownModelBehavior ?? value.unsupportedModelBehavior;
  if (isUnknownModelBehavior(rawUnknownBehavior)) config.unknownModelBehavior = rawUnknownBehavior;
  const entries = normalizeEntries(value.entries);
  if (entries !== undefined) config.entries = entries;
  return config;
}

function migrateConfigToCurrent(value: unknown): ConfigFile {
  let version = rawFileVersion(value);
  let next: unknown = value;
  while (version < CONFIG_VERSION) {
    if (version === 1) {
      next = migrateConfigV1ToV2(next);
      version = 2;
      continue;
    }
    break;
  }
  if (!isRecord(next)) return { version: CONFIG_VERSION };
  const config = migrateConfigV1ToV2(next);
  return { ...config, version: CONFIG_VERSION };
}

type ConfigReadResult =
  | { status: "missing" }
  | { status: "valid"; config: ConfigFile }
  | { status: "error"; error: ConfigFileError };

function isValidConfigContainer(value: unknown): value is ConfigFile {
  if (!isRecord(value)) return false;
  if (value.version !== undefined &&
      (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1 || value.version > CONFIG_VERSION)) return false;
  if (value.entries !== undefined && !isRecord(value.entries)) return false;
  if (value.unknownModelBehavior !== undefined && !isUnknownModelBehavior(value.unknownModelBehavior)) return false;
  if (value.unknownModelBehavior === undefined && value.unsupportedModelBehavior !== undefined &&
      !isUnknownModelBehavior(value.unsupportedModelBehavior)) return false;
  return true;
}

function readConfigResult(path: string): ConfigReadResult {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      try {
        // A dangling symlink is an existing unreadable config, not a missing file.
        lstatSync(path);
      } catch (statError) {
        if (isRecord(statError) && statError.code === "ENOENT") return { status: "missing" };
      }
    }
    return { status: "error", error: new ConfigFileError({ path, reason: "read" }) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch {
    // Parser messages can contain config values; report only the path and error category.
    return { status: "error", error: new ConfigFileError({ path, reason: "json" }) };
  }
  if (!isValidConfigContainer(parsed)) {
    return { status: "error", error: new ConfigFileError({ path, reason: "schema" }) };
  }
  return { status: "valid", config: migrateConfigToCurrent(parsed) };
}

export function readConfig(path: string): ConfigFile | undefined {
  const result = readConfigResult(path);
  if (result.status === "error") throw result.error;
  return result.status === "valid" ? result.config : undefined;
}

function saveConfigFile(path: string, config: ConfigFile, exclusive = false): void {
  const value = {
    version: CONFIG_VERSION,
    ...(config.unknownModelBehavior ? { unknownModelBehavior: config.unknownModelBehavior } : {}),
    entries: config.entries ?? {},
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: exclusive ? "wx" : "w" });
  } catch {
    throw new ConfigFileError({ path, reason: "write" });
  }
}

export function writeConfig(path: string, config: ConfigFile): void {
  const existing = readConfigResult(path);
  if (existing.status === "error") throw existing.error;
  if (!isValidConfigContainer(config)) throw new ConfigFileError({ path, reason: "schema" });
  saveConfigFile(path, config, existing.status === "missing");
}

function migrateConfigFile(path: string): ConfigFile | undefined {
  const config = readConfig(path);
  if (config) writeConfig(path, config);
  return config;
}

export function ensureConfig(path: string): ConfigFile {
  const existing = readConfig(path);
  if (existing) return existing;
  try {
    saveConfigFile(path, DEFAULT_CONFIG, true);
  } catch (error) {
    // Never overwrite a file that appeared between the read and exclusive creation.
    const appeared = readConfig(path);
    if (appeared) return appeared;
    throw error;
  }
  return { ...DEFAULT_CONFIG };
}

function migrateMapV1ToV2(value: unknown): ServiceTierMapFile {
  if (!isRecord(value)) return { ...DEFAULT_MAP };
  return { version: 2, entries: normalizeMapEntries(value.entries) ?? {} };
}

function migrateMapToCurrent(value: unknown): ServiceTierMapFile {
  let version = rawFileVersion(value);
  let next: unknown = value;
  while (version < MAP_VERSION) {
    if (version === 1) {
      next = migrateMapV1ToV2(next);
      version = 2;
      continue;
    }
    break;
  }
  if (!isRecord(next)) return { version: MAP_VERSION, entries: {} };
  if (rawFileVersion(next) < MAP_VERSION) return migrateMapV1ToV2(next);
  return { version: MAP_VERSION, entries: normalizeMapEntries(next.entries) ?? {} };
}

export function readMap(path: string): ServiceTierMapFile | undefined {
  const parsed = readJsonFile(path);
  if (parsed === undefined) return undefined;
  return migrateMapToCurrent(parsed);
}

export function writeMap(path: string, map: ServiceTierMapFile): void {
  writeJsonFile(path, {
    version: MAP_VERSION,
    entries: map.entries ?? {},
  });
}

function migrateMapFile(path: string): ServiceTierMapFile | undefined {
  if (!existsSync(path)) return undefined;
  const parsed = readJsonFile(path);
  if (parsed === undefined) return undefined;
  const migrated = migrateMapToCurrent(parsed);
  writeMap(path, migrated);
  return migrated;
}

export function ensureMap(path: string): ServiceTierMapFile {
  const existing = readMap(path);
  if (existing) return existing;
  writeMap(path, DEFAULT_MAP);
  return { ...DEFAULT_MAP };
}

export function mergeConfigs(userConfig: ConfigFile | undefined, projectConfig: ConfigFile | undefined, paths: ConfigPaths): EffectiveConfig {
  const configIssues: ConfigIssue[] = [];
  if (userConfig !== undefined && !isValidConfigContainer(userConfig)) configIssues.push({ path: paths.user, reason: "schema" });
  if (projectConfig !== undefined && !isValidConfigContainer(projectConfig)) configIssues.push({ path: paths.project, reason: "schema" });
  if (configIssues.length > 0) return { unknownModelBehavior: "leave-unknown", entries: {}, paths, configIssues };
  const userEntries = normalizeEntries(userConfig?.entries) ?? {};
  const projectEntries = normalizeEntries(projectConfig?.entries) ?? {};
  const keys = new Set([...Object.keys(userEntries), ...Object.keys(projectEntries)]);
  const entries: EffectiveConfig["entries"] = {};
  for (const key of keys) {
    const merged = { ...userEntries[key], ...projectEntries[key] };
    const serviceTier = isServiceTier(merged.serviceTier) ? merged.serviceTier : undefined;
    entries[key] = {
      active: merged.active === true && serviceTier !== undefined,
      ...(serviceTier ? { serviceTier } : {}),
    };
  }
  return {
    unknownModelBehavior:
      projectConfig?.unknownModelBehavior ?? userConfig?.unknownModelBehavior ?? DEFAULT_UNKNOWN_MODEL_BEHAVIOR,
    entries,
    paths,
  };
}

function readEffectiveConfig(paths: ConfigPaths): EffectiveConfig {
  const user = readConfigResult(paths.user);
  const project = readConfigResult(paths.project);
  const configIssues = [user, project].flatMap((result) => result.status === "error" ? [result.error.issue] : []);
  if (configIssues.length > 0) return { unknownModelBehavior: "leave-unknown", entries: {}, paths, configIssues };
  return mergeConfigs(user.status === "valid" ? user.config : undefined, project.status === "valid" ? project.config : undefined, paths);
}

function assertHealthyConfigScopes(paths: ConfigPaths): void {
  const issue = readEffectiveConfig(paths).configIssues?.[0];
  if (issue) throw new ConfigFileError(issue);
}

export function resolveEffectiveConfig(cwd: string, home = homedir()): EffectiveConfig {
  return readEffectiveConfig(configPaths(cwd, home));
}

function readScopeConfig(paths: ConfigPaths, scope: ConfigScope): ConfigFile {
  return ensureConfig(scope === "project" ? paths.project : paths.user);
}

function writeScopeConfig(paths: ConfigPaths, scope: ConfigScope, config: ConfigFile): void {
  writeConfig(scope === "project" ? paths.project : paths.user, config);
}

export function setScopedEntry(paths: ConfigPaths, scope: ConfigScope, key: string, patch: ServiceTierEntry): ConfigFile {
  assertHealthyConfigScopes(paths);
  const config = readScopeConfig(paths, scope);
  const normalized = normalizeModelKey(key);
  if (!normalized) return config;
  const entries = { ...(config.entries ?? {}) };
  entries[normalized] = { ...(entries[normalized] ?? {}), ...patch };
  const next = { ...config, entries };
  writeScopeConfig(paths, scope, next);
  return next;
}

export function setScopedUnknownModelBehavior(
  paths: ConfigPaths,
  scope: ConfigScope,
  unknownModelBehavior: UnknownModelBehavior,
): ConfigFile {
  assertHealthyConfigScopes(paths);
  const config = readScopeConfig(paths, scope);
  const next = { ...config, unknownModelBehavior };
  writeScopeConfig(paths, scope, next);
  return next;
}

export function presetTiersForModel(model: PresetLookupModel): ServiceTier[] {
  return bundledPresetEntryForModel(model)?.tiers ?? [];
}

export function buildPresetMapEntry(model: Pick<Model<Api>, "provider" | "id"> & Partial<Pick<Model<Api>, "api">>): ServiceTierMapEntry {
  const bundled = bundledPresetEntryForModel(model);
  if (bundled) return bundled;
  const tiers = presetTiersForModel(model);
  return {
    provider: model.provider,
    id: model.id,
    ...(model.api ? { api: model.api } : {}),
    determined: tiers.length > 0,
    tiers,
    source: "preset",
    updatedAt: new Date().toISOString(),
  };
}

export function mapSupportsTier(map: ServiceTierMapFile | undefined, key: string | undefined, tier: ServiceTier | undefined): boolean {
  if (!map?.entries || !key || !tier) return false;
  const entry = map.entries[key];
  if (!entry || !entry.determined || !isServiceTierModelSupported(entry)) return false;
  if (entry.unsupportedTiers?.includes(tier)) return false;
  return entry.tiers.includes(tier);
}

export function mapSupportState(
  map: ServiceTierMapFile | undefined,
  key: string | undefined,
  tier: ServiceTier | undefined,
): "supported" | "unknown" {
  if (!map?.entries || !key || !tier) return "unknown";
  const entry = map.entries[key];
  if (!entry) return "unknown";
  return mapSupportsTier(map, key, tier) ? "supported" : "unknown";
}

function probeEntryKnowsTier(entry: ServiceTierMapEntry | undefined, tier: ServiceTier | undefined): boolean {
  if (!entry || !tier || entry.source !== "probe") return false;
  return entry.tiers.includes(tier) || (entry.unsupportedTiers?.includes(tier) ?? false);
}

export function configuredTierForModel(config: EffectiveConfig, model: Model<Api> | undefined): ServiceTier | undefined {
  if (config.configIssues?.length || !isServiceTierModelSupported(model)) return undefined;
  const key = modelKey(model);
  if (!key) return undefined;
  const entry = config.entries[key];
  return entry?.active === true && isServiceTier(entry.serviceTier) ? entry.serviceTier : undefined;
}

export function resolveTierForModel(config: EffectiveConfig, map: ServiceTierMapFile, model: Model<Api> | undefined): ServiceTier | undefined {
  const key = modelKey(model);
  const tier = configuredTierForModel(config, model);
  return mapSupportsTier(map, key, tier) ? tier : undefined;
}

function payloadWithServiceTier(payload: unknown, tier: ServiceTier): unknown | undefined {
  if (!isRecord(payload)) return undefined;
  return { ...payload, service_tier: tier };
}

export function isUnsupportedServiceTierError(message: string | undefined): boolean {
  if (!message) return false;
  return /service[_\s-]?tier/i.test(message) && /unsupported|not\s+supported|invalid|unknown|unrecognized|not\s+recognized|extra_forbidden|unknown\s+parameter|unrecognized\s+request/i.test(message);
}

export function markTierUnsupported(map: ServiceTierMapFile, key: string, tier: ServiceTier, error?: string): ServiceTierMapFile {
  const parsed = parseModelKey(key);
  if (!parsed) return map;
  const entries = { ...(map.entries ?? {}) };
  const existing = entries[key];
  const tiers = uniqueTiers((existing?.tiers ?? []).filter((value) => value !== tier));
  const unsupportedTiers = uniqueTiers([...(existing?.unsupportedTiers ?? []), tier]);
  entries[key] = {
    provider: existing?.provider ?? parsed.provider,
    id: existing?.id ?? parsed.id,
    ...(existing?.api ? { api: existing.api } : {}),
    determined: false,
    tiers,
    unsupportedTiers,
    source: "error",
    updatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
  return { version: MAP_VERSION, entries };
}

export function markTierSupported(map: ServiceTierMapFile, key: string, tier: ServiceTier, model?: Pick<Model<Api>, "api">): ServiceTierMapFile {
  const parsed = parseModelKey(key);
  if (!parsed) return map;
  const entries = { ...(map.entries ?? {}) };
  const existing = entries[key];
  const tiers = uniqueTiers([...(existing?.tiers ?? []), tier]);
  const unsupportedTiers = uniqueTiers((existing?.unsupportedTiers ?? []).filter((value) => value !== tier));
  entries[key] = {
    provider: existing?.provider ?? parsed.provider,
    id: existing?.id ?? parsed.id,
    ...(model?.api || existing?.api ? { api: model?.api ?? existing?.api } : {}),
    determined: existing?.determined ?? true,
    tiers,
    ...(unsupportedTiers.length > 0 ? { unsupportedTiers } : {}),
    source: existing?.source === "preset" ? "preset" : "manual",
    updatedAt: new Date().toISOString(),
  };
  return { version: MAP_VERSION, entries };
}

export function markTierProbeResults(
  map: ServiceTierMapFile,
  key: string,
  results: Record<ServiceTier, Exclude<ProbeTierResult, "unknown">>,
  model?: Pick<Model<Api>, "provider" | "id" | "api">,
  error?: string,
): ServiceTierMapFile {
  const parsed = parseModelKey(key);
  if (!parsed) return map;
  const entries = { ...(map.entries ?? {}) };
  const existing = entries[key];
  const tiers = SERVICE_TIERS.filter((tier) => results[tier] === "supported");
  const unsupportedTiers = SERVICE_TIERS.filter((tier) => results[tier] === "unsupported");
  entries[key] = {
    provider: model?.provider ?? existing?.provider ?? parsed.provider,
    id: model?.id ?? existing?.id ?? parsed.id,
    ...(model?.api || existing?.api ? { api: model?.api ?? existing?.api } : {}),
    determined: true,
    tiers,
    ...(unsupportedTiers.length > 0 ? { unsupportedTiers } : {}),
    source: "probe",
    updatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
  return { version: MAP_VERSION, entries };
}

export function markTierUserMarked(
  map: ServiceTierMapFile,
  key: string,
  tier: ServiceTier,
  model?: Pick<Model<Api>, "provider" | "id" | "api">,
): ServiceTierMapFile {
  const parsed = parseModelKey(key);
  if (!parsed) return map;
  const entries = { ...(map.entries ?? {}) };
  const existing = entries[key];
  entries[key] = {
    provider: model?.provider ?? existing?.provider ?? parsed.provider,
    id: model?.id ?? existing?.id ?? parsed.id,
    ...(model?.api || existing?.api ? { api: model?.api ?? existing?.api } : {}),
    determined: existing?.determined ?? false,
    tiers: [...(existing?.tiers ?? [])],
    ...(existing?.unsupportedTiers && existing.unsupportedTiers.length > 0
      ? { unsupportedTiers: [...existing.unsupportedTiers] }
      : {}),
    source: "user-mark",
    updatedAt: new Date().toISOString(),
  };
  return { version: MAP_VERSION, entries };
}

function colorStatus(text: string, color?: "green"): string {
  if (!color) return text;
  if (process.env.NO_COLOR) return text;
  return `${ANSI_GREEN}${text}${ANSI_RESET}`;
}

function statusText(config: EffectiveConfig, map: ServiceTierMapFile, model: Model<Api> | undefined): string | undefined {
  if (!isServiceTierModelSupported(model)) return undefined;
  const key = modelKey(model);
  if (!key) return undefined;
  if (config.configIssues?.length) return `${STATUS_LABEL} ${STATUS_OFF_ICON} off (config error)`;
  const tier = configuredTierForModel(config, model);
  if (!tier) return colorStatus(`${STATUS_LABEL} ${STATUS_OFF_ICON} off`);
  const support = mapSupportState(map, key, tier);
  const supported = support === "supported";
  const prefix = ["priority", "fast", "ultrafast"].includes(tier) ? STATUS_ICON : STATUS_ACTIVE_ICON;
  const text = `${STATUS_LABEL}: ${prefix} ${tier}${supported ? "" : ` ${support}`}`;
  return colorStatus(text, supported ? "green" : undefined);
}

function getCwd(ctx: ExtensionContext): string {
  return ctx.cwd || process.cwd();
}

function getPaths(ctx: ExtensionContext): ConfigPaths {
  return configPaths(getCwd(ctx));
}

function seedPresetMapEntryIfMissing(path: string, map: ServiceTierMapFile, model: Model<Api> | undefined): ServiceTierMapFile {
  const key = modelKey(model);
  if (!model || !key || !isServiceTierModelSupported(model) || map.entries?.[key]) return map;
  const next = {
    version: MAP_VERSION,
    entries: { ...(map.entries ?? {}), [key]: buildPresetMapEntry(model) },
  };
  writeMap(path, next);
  return next;
}

function refreshPresetMapEntry(
  path: string,
  map: ServiceTierMapFile,
  model: Model<Api> | undefined,
  requestedTier?: ServiceTier,
): ServiceTierMapFile {
  const key = modelKey(model);
  if (!model || !key || !isServiceTierModelSupported(model)) return map;
  if (probeEntryKnowsTier(map.entries?.[key], requestedTier)) return map;
  const preset = buildPresetMapEntry(model);
  if (
    map.entries?.[key]?.source === "user-mark" &&
    (!preset.determined || (requestedTier && !preset.tiers.includes(requestedTier)))
  ) return map;
  const next = {
    version: MAP_VERSION,
    entries: { ...(map.entries ?? {}), [key]: preset },
  };
  writeMap(path, next);
  return next;
}

function refreshPresetKnowledgeForStoredEntries(path: string, map: ServiceTierMapFile): ServiceTierMapFile {
  const entries = { ...(map.entries ?? {}) };
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.source === "probe" || !isServiceTierModelSupported(entry)) continue;
    const preset = buildPresetMapEntry(entry);
    if (preset.determined) entries[key] = preset;
  }
  const next = { version: MAP_VERSION, entries };
  writeMap(path, next);
  return next;
}

function migrateStartupFiles(paths: ConfigPaths): ServiceTierMapFile {
  assertHealthyConfigScopes(paths);
  migrateConfigFile(paths.user);
  migrateConfigFile(paths.project);
  const migratedMap = migrateMapFile(paths.map);
  return migratedMap ?? ensureMap(paths.map);
}

function loadState(ctx: ExtensionContext): { config: EffectiveConfig; map: ServiceTierMapFile } {
  const paths = getPaths(ctx);
  const config = readEffectiveConfig(paths);
  const map = config.configIssues?.length ? { ...DEFAULT_MAP } : ensureMap(paths.map);
  return { config, map };
}

function updateStatus(ctx: ExtensionContext): void {
  if (!isServiceTierModelSupported(ctx.model)) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }
  const { config, map } = loadState(ctx);
  ctx.ui.setStatus(STATUS_KEY, statusText(config, map, ctx.model) ?? undefined);
}

function startProbeStatus(ctx: ExtensionContext, signal: AbortSignal, canContinue: () => boolean): {
  update: (tier: ServiceTier, index: number, total: number) => void;
  stop: () => void;
} {
  let index = 0;
  let label = "probing";
  const render = () => {
    if (signal.aborted || !canContinue()) return;
    const frame = PROBE_STATUS_FRAMES[index % PROBE_STATUS_FRAMES.length];
    ctx.ui.setStatus(STATUS_KEY, colorStatus(`${STATUS_LABEL} ${frame} ${label}`));
    index += 1;
  };
  render();
  const timer = setInterval(render, PROBE_STATUS_INTERVAL_MS);
  return {
    update: (tier, tierIndex, total) => {
      label = `probing ${tier} ${tierIndex}/${total}`;
      render();
    },
    stop: () => {
      clearInterval(timer);
      // Off/model/shutdown handlers own the new status; cancelled work must not replace it.
      if (!signal.aborted) updateStatus(ctx);
    },
  };
}

type ProbeTierResult = "supported" | "unsupported" | "unknown";
type ProbeTierFunction = (model: Model<Api>, tier: ServiceTier, ctx: ExtensionCommandContext, signal?: AbortSignal) => Promise<ProbeTierResult>;

function probeAbortResult(signal: AbortSignal): { promise: Promise<typeof PROBE_STOPPED>; dispose: () => void } {
  let onAbort!: () => void;
  const promise = new Promise<typeof PROBE_STOPPED>((resolve) => {
    onAbort = () => resolve(PROBE_STOPPED);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

function isActiveProbeTarget(ctx: ExtensionContext, key: string, api: string): boolean {
  try {
    return isServiceTierModelSupported(ctx.model) && modelKey(ctx.model) === key && ctx.model?.api === api &&
      configuredTierForModel(readEffectiveConfig(getPaths(ctx)), ctx.model) !== undefined;
  } catch {
    return false;
  }
}

async function defaultProbeTier(model: Model<Api>, tier: ServiceTier, ctx: ExtensionCommandContext, signal?: AbortSignal): Promise<ProbeTierResult> {
  if (signal?.aborted || !isServiceTierModelSupported(model)) return "unknown";
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const cancelled = probeAbortResult(controller.signal);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closeIterator: (() => void) | undefined;
  try {
    const context: ProviderContext = {
      messages: [{ role: "user", content: "Reply OK.", timestamp: Date.now() }],
    };
    const options: SimpleStreamOptions = {
      maxTokens: 1,
      signal: controller.signal,
      onPayload: (payload, requestModel) => {
        if (controller.signal.aborted || (signal && !isActiveProbeTarget(ctx, modelKey(model)!, model.api))) {
          controller.abort();
          throw new Error("Service-tier probe cancelled.");
        }
        if (!isServiceTierModelSupported(requestModel)) {
          controller.abort();
          throw new Error("Blocked provider/API for service-tier probing.");
        }
        return payloadWithServiceTier(payload, tier) ?? payload;
      },
    };
    timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    // Pi 1.1.0 resolves configured provider/auth routing and normalizes Context here.
    const iterator = ctx.modelRegistry.streamSimple(model, context, options)[Symbol.asyncIterator]();
    closeIterator = () => {
      // Closing a cancelled/non-cooperative stream is best-effort and must not delay cancellation.
      try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Already stopped. */ }
    };

    while (true) {
      const next = await Promise.race([iterator.next(), cancelled.promise]);
      if (controller.signal.aborted || next === PROBE_STOPPED) return "unknown";
      if (next.done) return "unknown";
      const event = next.value;
      if (event.type === "done") return "supported";
      if (event.type === "error") {
        return isUnsupportedServiceTierError(event.error.errorMessage) ? "unsupported" : "unknown";
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return "unknown";
    const message = error instanceof Error ? error.message : String(error);
    return isUnsupportedServiceTierError(message) ? "unsupported" : "unknown";
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    cancelled.dispose();
    if (controller.signal.aborted) closeIterator?.();
  }
}

interface ProbeOwner {
  generation: number;
  closed: boolean;
}

interface ActiveProbeRun {
  owner: ProbeOwner;
  key: string;
  controller: AbortController;
}

let probeTier: ProbeTierFunction = defaultProbeTier;
const activeAutoProbes = new Set<Promise<ProbeTierResult>>();
const probeOwners = new WeakMap<ExtensionContext, ProbeOwner>();
const activeProbeRuns = new Set<ActiveProbeRun>();

function probeOwnerForContext(ctx: ExtensionContext): ProbeOwner {
  let owner = probeOwners.get(ctx);
  if (!owner) {
    owner = { generation: 0, closed: false };
    probeOwners.set(ctx, owner);
  }
  return owner;
}

function cancelAutoProbes(ctx: ExtensionContext, key?: string): void {
  const owner = probeOwnerForContext(ctx);
  owner.generation += 1; // Also invalidates an outstanding support prompt.
  for (const run of activeProbeRuns) {
    if (run.owner === owner && (!key || run.key === key)) run.controller.abort();
  }
}

function setProbeTierForTest(next: ProbeTierFunction): () => void {
  const previous = probeTier;
  probeTier = next;
  return () => {
    probeTier = previous;
  };
}

async function waitForAutoProbesForTest(): Promise<void> {
  while (activeAutoProbes.size > 0) {
    await Promise.allSettled([...activeAutoProbes]);
  }
}

async function runAutoProbeForCurrentTier(ctx: ExtensionCommandContext, key: string, tier: ServiceTier): Promise<ProbeTierResult> {
  if (!ctx.model) {
    ctx.ui.notify("No current model selected.", "error");
    return "unknown";
  }
  if (!isServiceTierModelSupported(ctx.model)) return "unknown";
  const model = ctx.model;
  const owner = probeOwnerForContext(ctx);
  if (owner.closed || !isActiveProbeTarget(ctx, key, model.api)) return "unknown";
  cancelAutoProbes(ctx, key);
  const controller = new AbortController();
  const run = { owner, key, controller };
  activeProbeRuns.add(run);
  const cancelled = probeAbortResult(controller.signal);
  const canContinue = () => {
    if (controller.signal.aborted) return false;
    if (!owner.closed && isActiveProbeTarget(ctx, key, model.api)) return true;
    controller.abort();
    if (!owner.closed) updateStatus(ctx);
    return false;
  };
  const paths = getPaths(ctx);
  let probeStatus: ReturnType<typeof startProbeStatus> | undefined;
  const results: Partial<Record<ServiceTier, ProbeTierResult>> = {};
  try {
    ctx.ui.notify(`service_tier auto-probe started for ${key}; checking ${SERVICE_TIERS.length} tier(s)...`, "warning");
    probeStatus = startProbeStatus(ctx, controller.signal, canContinue);
    for (const [index, currentTier] of SERVICE_TIERS.entries()) {
      if (!canContinue()) return "unknown";
      probeStatus.update(currentTier, index + 1, SERVICE_TIERS.length);
      const result = await Promise.race([probeTier(model, currentTier, ctx, controller.signal), cancelled.promise]);
      if (result === PROBE_STOPPED || !canContinue()) return "unknown";
      results[currentTier] = result;
    }
    if (!canContinue()) return "unknown";
    const unknownTiers = SERVICE_TIERS.filter((currentTier) => results[currentTier] === "unknown");
    if (unknownTiers.length > 0) {
      ctx.ui.notify(
        `service_tier auto-probe for ${key} did not determine ${unknownTiers.join(", ")}; ${MAP_BASENAME} was not changed.`,
        "warning",
      );
      return results[tier] ?? "unknown";
    }
    const determinedResults = Object.fromEntries(
      SERVICE_TIERS.map((currentTier) => [currentTier, results[currentTier] as Exclude<ProbeTierResult, "unknown">]),
    ) as Record<ServiceTier, Exclude<ProbeTierResult, "unknown">>;
    const supportedTiers = SERVICE_TIERS.filter((currentTier) => determinedResults[currentTier] === "supported");
    const unsupportedTiers = SERVICE_TIERS.filter((currentTier) => determinedResults[currentTier] === "unsupported");
    const map = ensureMap(paths.map);
    writeMap(
      paths.map,
      markTierProbeResults(
        map,
        key,
        determinedResults,
        ctx.model,
        unsupportedTiers.length > 0 ? `service_tier auto-probe rejected: ${unsupportedTiers.join(", ")}` : undefined,
      ),
    );
    updateStatus(ctx);
    if (determinedResults[tier] === "supported") {
      ctx.ui.notify(
        `service_tier auto-probe completed for ${key}; supported: ${supportedTiers.join(", ") || "none"}. Updated ${MAP_BASENAME}.`,
        "info",
      );
    } else {
      ctx.ui.notify(
        `service_tier auto-probe completed for ${key}; ${tier} remains unknown. Updated ${MAP_BASENAME}.`,
        "warning",
      );
    }
    return determinedResults[tier];
  } finally {
    activeProbeRuns.delete(run);
    cancelled.dispose();
    probeStatus?.stop();
  }
}

function startAutoProbeForCurrentTier(ctx: ExtensionCommandContext, key: string, tier: ServiceTier): Promise<ProbeTierResult> {
  const owner = probeOwnerForContext(ctx);
  const promise = runAutoProbeForCurrentTier(ctx, key, tier).catch((error) => {
    if (owner.closed) return "unknown" as const;
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`service_tier auto-probe failed for ${key}: ${message}`, "error");
    updateStatus(ctx);
    return "unknown" as const;
  });
  activeAutoProbes.add(promise);
  void promise.then(() => activeAutoProbes.delete(promise), () => activeAutoProbes.delete(promise));
  return promise;
}

const AUTO_PROBE_ONCE_CHOICE = "Auto-probe once";
const AUTO_PROBE_ALWAYS_CHOICE = "Always auto-probe";
const LEAVE_ONCE_CHOICE = "Leave unknown once";
const LEAVE_ALWAYS_CHOICE = "Always leave unknown";
const UNSUPPORTED_PROMPT_CHOICES = [AUTO_PROBE_ONCE_CHOICE, AUTO_PROBE_ALWAYS_CHOICE, LEAVE_ONCE_CHOICE, LEAVE_ALWAYS_CHOICE] as const;

async function evaluateUnsupportedAfterExplicitCommand(ctx: ExtensionCommandContext, key: string, tier: ServiceTier): Promise<void> {
  if (!isServiceTierModelSupported(ctx.model)) return;
  const owner = probeOwnerForContext(ctx);
  const generation = owner.generation;
  const api = ctx.model?.api;
  const { config, map } = loadState(ctx);
  if (owner.closed || configuredTierForModel(config, ctx.model) !== tier) return;
  if (config.unknownModelBehavior === "auto-probe") {
    ctx.ui.notify(`service_tier=${tier} auto-probe behavior will probe all service tiers for ${key} now.`, "info");
    startAutoProbeForCurrentTier(ctx, key, tier);
    return;
  }
  const mapEntry = map.entries?.[key];
  if (mapSupportsTier(map, key, tier)) return;
  if (mapEntry?.determined && mapEntry.unsupportedTiers?.includes(tier)) {
    ctx.ui.notify(`service_tier=${tier} is not supported by the support map for ${key}; configured requests will still send it.`, "info");
    return;
  }
  if (mapEntry?.source === "user-mark") {
    ctx.ui.notify(`service_tier=${tier} was left unknown for ${key}; configured requests will still send it.`, "info");
    return;
  }
  if (mapSupportState(map, key, tier) !== "unknown") return;
  if (config.unknownModelBehavior === "leave-unknown") {
    ctx.ui.notify(`service_tier=${tier} is not recorded in the support map for ${key}; active configuration will still send it.`, "info");
    return;
  }

  const choice = await ctx.ui.select(
    [
      `service_tier=${tier} is not recorded in the support map for ${key}.`,
      "",
      "Auto-probe sends low-token probe requests for every known service tier and may consume provider tokens.",
    ].join("\n"),
    [...UNSUPPORTED_PROMPT_CHOICES],
  );
  if (owner.closed || owner.generation !== generation || !isServiceTierModelSupported(ctx.model) ||
      modelKey(ctx.model) !== key || ctx.model?.api !== api ||
      configuredTierForModel(readEffectiveConfig(getPaths(ctx)), ctx.model) !== tier) return;
  const paths = getPaths(ctx);
  if (choice === AUTO_PROBE_ONCE_CHOICE) {
    startAutoProbeForCurrentTier(ctx, key, tier);
    return;
  }
  if (choice === AUTO_PROBE_ALWAYS_CHOICE) {
    setScopedUnknownModelBehavior(paths, "user", "auto-probe");
    updateStatus(ctx);
    ctx.ui.notify(`user-global unknownModelBehavior set to auto-probe; probing service_tier=${tier} for ${key} now.`, "info");
    startAutoProbeForCurrentTier(ctx, key, tier);
    return;
  }
  if (choice === LEAVE_ONCE_CHOICE) {
    if (ctx.model) {
      writeMap(paths.map, markTierUserMarked(ensureMap(paths.map), key, tier, ctx.model));
      updateStatus(ctx);
    }
    ctx.ui.notify(`service_tier=${tier} will remain unknown for ${key}; configured requests will still send it.`, "info");
    return;
  }
  if (choice === LEAVE_ALWAYS_CHOICE) {
    if (ctx.model) {
      writeMap(paths.map, markTierUserMarked(ensureMap(paths.map), key, tier, ctx.model));
    }
    setScopedUnknownModelBehavior(paths, "user", "leave-unknown");
    updateStatus(ctx);
    ctx.ui.notify("user-global unknownModelBehavior set to leave-unknown.", "info");
    return;
  }
  ctx.ui.notify("Unsupported service_tier choice cancelled; no behavior changed.", "info");
}

function currentModelKeyOrNotify(ctx: ExtensionCommandContext): string | undefined {
  const key = modelKey(ctx.model);
  if (!key) ctx.ui.notify("No current model selected.", "error");
  return key;
}

function notifyScopeStatus(ctx: ExtensionCommandContext, scope: ConfigScope): void {
  const { config, map } = loadState(ctx);
  const key = modelKey(ctx.model);
  if (!key) return ctx.ui.notify("No current model selected.", "error");
  const effectiveTier = configuredTierForModel(config, ctx.model);
  const scoped = readScopeConfig(config.paths, scope).entries?.[key];
  const mapEntry = map.entries?.[key];
  const support = effectiveTier ? mapSupportState(map, key, effectiveTier) : "unknown";
  ctx.ui.notify(
    [
      `${scope} service tier for ${key}: ${scoped?.active ? scoped.serviceTier ?? "unset" : scoped?.active === false ? "off" : "unset"}`,
      `effective: ${effectiveTier ?? "off"}`,
      `map: ${mapEntry ? (mapEntry.determined ? mapEntry.tiers.join(", ") || "none" : "unknown") : "unknown"}`,
      `support: ${support}`,
      `unknownBehavior: ${config.unknownModelBehavior}`,
    ].join("; "),
    "info",
  );
}

const TIER_COMMAND_ARGS = [...SERVICE_TIERS, "off", "status"] as const;
const TOGGLE_COMMAND_ARGS = ["on", "off", "status"] as const;
const UNKNOWN_BEHAVIOR_COMMAND_ARGS = [...UNKNOWN_MODEL_BEHAVIORS, "status"] as const;

type CompletionValue =
  | (typeof TIER_COMMAND_ARGS)[number]
  | (typeof TOGGLE_COMMAND_ARGS)[number]
  | (typeof UNKNOWN_BEHAVIOR_COMMAND_ARGS)[number];

function valueCompletions(values: readonly CompletionValue[], prefix: string) {
  const clean = prefix.trim().toLowerCase();
  const items = values.filter((value) => value.startsWith(clean));
  return items.length ? items.map((value) => ({ value, label: value })) : null;
}

function tierCompletions(prefix: string) {
  return valueCompletions(TIER_COMMAND_ARGS, prefix);
}

function fastCompletions(prefix: string) {
  return valueCompletions(TOGGLE_COMMAND_ARGS, prefix);
}

function unknownBehaviorCompletions(prefix: string) {
  return valueCompletions(UNKNOWN_BEHAVIOR_COMMAND_ARGS, prefix);
}

function debugCompletions(prefix: string) {
  return valueCompletions(TOGGLE_COMMAND_ARGS, prefix);
}

function installCommandArgumentAutocomplete(ctx: ExtensionContext, getModel: () => Model<Api> | undefined): void {
  ctx.ui.addAutocompleteProvider((current) => ({
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const commandCompletions: Record<string, (prefix: string) => ReturnType<typeof tierCompletions>> = {
        [COMMAND_TIER_PROJECT]: tierCompletions,
        [COMMAND_TIER_USER]: tierCompletions,
        [COMMAND_FAST_PROJECT]: fastCompletions,
        [COMMAND_FAST_USER]: fastCompletions,
        [COMMAND_FAST_PROJECT_ALIAS]: fastCompletions,
        [COMMAND_FAST_USER_ALIAS]: fastCompletions,
        [COMMAND_UNKNOWN_BEHAVIOR]: unknownBehaviorCompletions,
        [COMMAND_DEBUG]: debugCompletions,
      };

      for (const [command, complete] of Object.entries(commandCompletions)) {
        const commandPrefix = `/${command} `;
        if (!beforeCursor.startsWith(commandPrefix)) continue;
        if (!isServiceTierModelSupported(getModel())) return null;
        const argumentPrefix = beforeCursor.slice(commandPrefix.length);
        if (/\s/.test(argumentPrefix)) continue;
        const items = complete(argumentPrefix);
        if (items) return { items, prefix: argumentPrefix };
        break;
      }

      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  }));
}

async function handleTierCommand(scope: ConfigScope, args: string, ctx: ExtensionCommandContext): Promise<void> {
  const arg = args.trim().toLowerCase();
  const paths = getPaths(ctx);
  ensureConfig(scope === "project" ? paths.project : paths.user);
  const key = currentModelKeyOrNotify(ctx);
  if (!key) return;
  if (!arg || arg === "status") {
    updateStatus(ctx);
    return notifyScopeStatus(ctx, scope);
  }
  if (arg === "off") {
    cancelAutoProbes(ctx, key);
    setScopedEntry(paths, scope, key, { active: false });
    updateStatus(ctx);
    ctx.ui.notify(`${scope} service tier disabled for ${key}.`, "info");
    return;
  }
  if (isServiceTier(arg)) {
    setScopedEntry(paths, scope, key, { active: true, serviceTier: arg });
    refreshPresetMapEntry(paths.map, ensureMap(paths.map), ctx.model, arg);
    updateStatus(ctx);
    ctx.ui.notify(`${scope} service tier ${arg} enabled for ${key}.`, "info");
    await evaluateUnsupportedAfterExplicitCommand(ctx, key, arg);
    return;
  }
  ctx.ui.notify(`Usage: /service-tier-${scope === "project" ? "project" : "user"} [${SERVICE_TIERS.join("|")}|off|status]`, "error");
}

async function handleFastCommand(scope: ConfigScope, args: string, ctx: ExtensionCommandContext): Promise<void> {
  const arg = args.trim().toLowerCase();
  const paths = getPaths(ctx);
  ensureConfig(scope === "project" ? paths.project : paths.user);
  const key = currentModelKeyOrNotify(ctx);
  if (!key) return;
  if (arg === "status") {
    updateStatus(ctx);
    return notifyScopeStatus(ctx, scope);
  }
  const scopedEntry = readScopeConfig(paths, scope).entries?.[key];
  const turnOn = arg === "on" ? true : arg === "off" ? false : !(scopedEntry?.active && scopedEntry.serviceTier === "priority");
  if (!turnOn) cancelAutoProbes(ctx, key);
  setScopedEntry(paths, scope, key, turnOn ? { active: true, serviceTier: "priority" } : { active: false });
  if (turnOn) refreshPresetMapEntry(paths.map, ensureMap(paths.map), ctx.model, "priority");
  updateStatus(ctx);
  ctx.ui.notify(`${scope} fast mode ${turnOn ? "enabled" : "disabled"} for ${key}.`, "info");
  if (turnOn) await evaluateUnsupportedAfterExplicitCommand(ctx, key, "priority");
}

function unknownBehaviorScopeValue(config: ConfigFile | undefined): UnknownModelBehavior | "unset" {
  return config?.unknownModelBehavior ?? "unset";
}

function notifyUnknownBehaviorStatus(ctx: ExtensionCommandContext): void {
  const paths = getPaths(ctx);
  const userConfig = readConfig(paths.user);
  const projectConfig = readConfig(paths.project);
  const effective = mergeConfigs(userConfig, projectConfig, paths);
  ctx.ui.notify(
    `unknownModelBehavior is ${effective.unknownModelBehavior} (project: ${unknownBehaviorScopeValue(projectConfig)}; user: ${unknownBehaviorScopeValue(userConfig)}).`,
    "info",
  );
}

async function handleUnknownBehaviorCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const arg = args.trim().toLowerCase();
  if (!arg || arg === "status") return notifyUnknownBehaviorStatus(ctx);
  if (!isUnknownModelBehavior(arg)) {
    ctx.ui.notify("Usage: /service-tier-unknown-behavior [ask|auto-probe|leave-unknown|status]", "error");
    return;
  }
  const paths = getPaths(ctx);
  setScopedUnknownModelBehavior(paths, "user", arg);
  updateStatus(ctx);
  ctx.ui.notify(`user-global unknownModelBehavior set to ${arg}.`, "info");
}

function upsertMapEntry(path: string, entry: ServiceTierMapEntry): ServiceTierMapFile {
  const map = ensureMap(path);
  const key = `${entry.provider}/${entry.id}`;
  const next = { version: MAP_VERSION, entries: { ...(map.entries ?? {}), [key]: entry } };
  writeMap(path, next);
  return next;
}

function removeMapEntry(path: string, key: string): ServiceTierMapFile {
  const map = ensureMap(path);
  const entries = { ...(map.entries ?? {}) };
  delete entries[key];
  const next = { version: MAP_VERSION, entries };
  writeMap(path, next);
  return next;
}

function clearMap(path: string): ServiceTierMapFile {
  const map = ensureMap(path);
  const entries = Object.fromEntries(
    Object.entries(map.entries ?? {}).filter(([, entry]) => !isServiceTierModelSupported(entry)),
  );
  const next = { version: MAP_VERSION, entries };
  writeMap(path, next);
  return next;
}

async function handleRefreshSupport(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.model) return ctx.ui.notify("No current model selected.", "error");
  const paths = getPaths(ctx);
  const key = modelKey(ctx.model);
  if (!key) return ctx.ui.notify("No current model selected.", "error");
  const entry = buildPresetMapEntry(ctx.model);
  upsertMapEntry(paths.map, entry);
  updateStatus(ctx);
  ctx.ui.notify(`service_tier support refreshed for ${entry.provider}/${entry.id}: ${entry.tiers.join(", ") || "unknown"}.`, "info");
  const { config } = loadState(ctx);
  const tier = configuredTierForModel(config, ctx.model);
  if (tier) await evaluateUnsupportedAfterExplicitCommand(ctx, key, tier);
}

async function handleRefreshSupportAll(ctx: ExtensionCommandContext): Promise<void> {
  const paths = getPaths(ctx);
  const models = ctx.modelRegistry.getAvailable().filter(isServiceTierModelSupported);
  if (models.length === 0) return ctx.ui.notify("No supported service-tier models available.", "warning");
  let updated = 0;
  for (const model of models) {
    const entry = buildPresetMapEntry(model);
    upsertMapEntry(paths.map, entry);
    updated++;
  }
  updateStatus(ctx);
  ctx.ui.notify(`service_tier support refreshed for ${updated} model(s) from presets.`, "info");
  const { config } = loadState(ctx);
  const key = modelKey(ctx.model);
  const tier = configuredTierForModel(config, ctx.model);
  if (key && tier) await evaluateUnsupportedAfterExplicitCommand(ctx, key, tier);
}

async function handleUnsetSupport(ctx: ExtensionCommandContext): Promise<void> {
  const paths = getPaths(ctx);
  const key = currentModelKeyOrNotify(ctx);
  if (!key) return;
  removeMapEntry(paths.map, key);
  updateStatus(ctx);
  ctx.ui.notify(`service_tier support is now unknown for ${key}.`, "info");
}

async function handleUnsetSupportAll(ctx: ExtensionCommandContext): Promise<void> {
  const paths = getPaths(ctx);
  clearMap(paths.map);
  updateStatus(ctx);
  ctx.ui.notify("service_tier support map cleared for supported provider/API routes; blocked entries were preserved.", "info");
}

export default function piServiceTier(pi: ExtensionAPI): void {
  let lastApplied: LastAppliedTier | undefined;
  let debugEnabled = false;
  let currentModel: Model<Api> | undefined;
  let stateInitialized = false;
  let stateCache: { config: EffectiveConfig; map: ServiceTierMapFile } | undefined;
  let owner: ProbeOwner = { generation: 0, closed: false };
  let reportedConfigIssues = new Set<string>();
  const bindProbeOwner = (ctx: ExtensionContext) => probeOwners.set(ctx, owner);
  const reportConfigIssues = (ctx: ExtensionContext, config: EffectiveConfig): boolean => {
    const issues = config.configIssues ?? [];
    const nextReported = new Set(issues.map((issue) => `${issue.path}:${issue.reason}`));
    for (const issue of issues) {
      if (!reportedConfigIssues.has(`${issue.path}:${issue.reason}`)) {
        ctx.ui.notify(`Tier injection is suspended. ${new ConfigFileError(issue).message}`, "error");
      }
    }
    reportedConfigIssues = nextReported;
    if (issues.length > 0) cancelAutoProbes(ctx);
    return issues.length > 0;
  };

  const invalidateStateCache = () => {
    stateCache = undefined;
  };
  const getCachedState = (ctx: ExtensionContext) => {
    // Re-read config for each request: an edit/error must not leave a cached paid tier active.
    const config = readEffectiveConfig(getPaths(ctx));
    const map = config.configIssues?.length
      ? { ...DEFAULT_MAP }
      : stateCache?.config.configIssues?.length ? ensureMap(config.paths.map) : stateCache?.map ?? ensureMap(config.paths.map);
    stateCache = { config, map };
    return stateCache;
  };
  const initializeState = (ctx: ExtensionContext) => {
    if (stateInitialized || !isServiceTierModelSupported(ctx.model)) return;
    const paths = getPaths(ctx);
    if (readEffectiveConfig(paths).configIssues?.length) return;
    try {
      refreshPresetKnowledgeForStoredEntries(paths.map, migrateStartupFiles(paths));
      stateInitialized = true;
    } catch (error) {
      if (!(error instanceof ConfigFileError)) throw error;
      reportConfigIssues(ctx, readEffectiveConfig(paths));
      ctx.ui.notify(error.message, "error");
    }
  };
  const refreshStatus = (ctx: ExtensionContext) => {
    if (!isServiceTierModelSupported(ctx.model)) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    stateCache = loadState(ctx);
    reportConfigIssues(ctx, stateCache.config);
    ctx.ui.setStatus(STATUS_KEY, statusText(stateCache.config, stateCache.map, ctx.model) ?? undefined);
  };
  const supportedCompletions = (complete: typeof tierCompletions) => (prefix: string) =>
    isServiceTierModelSupported(currentModel) ? complete(prefix) : null;
  const commandHandler = (handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>) => async (args: string, ctx: ExtensionCommandContext) => {
    bindProbeOwner(ctx);
    currentModel = ctx.model;
    if (!isServiceTierModelSupported(ctx.model)) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify(
        ctx.model
          ? `Service-tier commands are blocked for ${ctx.model.provider} (${ctx.model.api}); this provider/API is not supported by ${PACKAGE_NAME}. Saved settings are not applied.`
          : "No current model selected.",
        "error",
      );
      return;
    }
    invalidateStateCache();
    const config = readEffectiveConfig(getPaths(ctx));
    if (reportConfigIssues(ctx, config)) {
      lastApplied = undefined;
      ctx.ui.setStatus(STATUS_KEY, statusText(config, DEFAULT_MAP, ctx.model));
      return;
    }
    try {
      await handler(args, ctx);
    } catch (error) {
      if (!(error instanceof ConfigFileError)) throw error;
      cancelAutoProbes(ctx);
      lastApplied = undefined;
      ctx.ui.notify(error.message, "error");
      refreshStatus(ctx);
    } finally {
      invalidateStateCache();
    }
  };

  pi.registerCommand(COMMAND_FAST_PROJECT, {
    description: "Toggle project-level priority service_tier for the current provider/model",
    getArgumentCompletions: supportedCompletions(fastCompletions),
    handler: commandHandler((args, ctx) => handleFastCommand("project", args, ctx)),
  });

  pi.registerCommand(COMMAND_FAST_USER, {
    description: "Toggle user-global priority service_tier for the current provider/model",
    getArgumentCompletions: supportedCompletions(fastCompletions),
    handler: commandHandler((args, ctx) => handleFastCommand("user", args, ctx)),
  });

  pi.registerCommand(COMMAND_FAST_PROJECT_ALIAS, {
    description: "Alias for /service-tier-fast-project",
    getArgumentCompletions: supportedCompletions(fastCompletions),
    handler: commandHandler((args, ctx) => handleFastCommand("project", args, ctx)),
  });

  pi.registerCommand(COMMAND_FAST_USER_ALIAS, {
    description: "Alias for /service-tier-fast-user",
    getArgumentCompletions: supportedCompletions(fastCompletions),
    handler: commandHandler((args, ctx) => handleFastCommand("user", args, ctx)),
  });

  pi.registerCommand(COMMAND_TIER_PROJECT, {
    description: "Manage project-level service_tier for the current provider/model",
    getArgumentCompletions: supportedCompletions(tierCompletions),
    handler: commandHandler((args, ctx) => handleTierCommand("project", args, ctx)),
  });

  pi.registerCommand(COMMAND_TIER_USER, {
    description: "Manage user-global service_tier for the current provider/model",
    getArgumentCompletions: supportedCompletions(tierCompletions),
    handler: commandHandler((args, ctx) => handleTierCommand("user", args, ctx)),
  });

  pi.registerCommand(COMMAND_REFRESH_SUPPORT, {
    description: "Refresh preset service_tier support for the current provider/model",
    handler: commandHandler(async (_args, ctx) => handleRefreshSupport(ctx)),
  });

  pi.registerCommand(COMMAND_REFRESH_SUPPORT_ALL, {
    description: "Refresh preset service_tier support for all available supported provider/API routes",
    handler: commandHandler(async (_args, ctx) => handleRefreshSupportAll(ctx)),
  });

  pi.registerCommand(COMMAND_UNSET_SUPPORT, {
    description: "Remove stored service_tier support for the current provider/model",
    handler: commandHandler(async (_args, ctx) => handleUnsetSupport(ctx)),
  });

  pi.registerCommand(COMMAND_UNSET_SUPPORT_ALL, {
    description: "Clear stored service_tier support for supported provider/API routes, preserving blocked entries",
    handler: commandHandler(async (_args, ctx) => handleUnsetSupportAll(ctx)),
  });

  pi.registerCommand(COMMAND_UNKNOWN_BEHAVIOR, {
    description: "Set user-global behavior for unknown service_tier support",
    getArgumentCompletions: supportedCompletions(unknownBehaviorCompletions),
    handler: commandHandler((args, ctx) => handleUnknownBehaviorCommand(args, ctx)),
  });

  pi.registerCommand(COMMAND_DEBUG, {
    description: "Toggle service_tier injection debug notifications for this Pi session",
    getArgumentCompletions: supportedCompletions(debugCompletions),
    handler: commandHandler(async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (!arg || arg === "status") {
        ctx.ui.notify(`service_tier debug is ${debugEnabled ? "on" : "off"}.`, "info");
        return;
      }
      if (arg === "on") {
        debugEnabled = true;
        ctx.ui.notify("service_tier debug enabled for this Pi session.", "info");
        return;
      }
      if (arg === "off") {
        debugEnabled = false;
        ctx.ui.notify("service_tier debug disabled for this Pi session.", "info");
        return;
      }
      ctx.ui.notify("Usage: /service-tier-debug [on|off|status]", "error");
    }),
  });

  pi.on("session_start", async (_event, ctx) => {
    bindProbeOwner(ctx);
    cancelAutoProbes(ctx);
    owner.closed = true;
    owner = { generation: 0, closed: false };
    bindProbeOwner(ctx);
    reportedConfigIssues.clear();
    currentModel = ctx.model;
    stateInitialized = false;
    lastApplied = undefined;
    installCommandArgumentAutocomplete(ctx, () => currentModel);
    initializeState(ctx);
    invalidateStateCache();
    refreshStatus(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    bindProbeOwner(ctx);
    cancelAutoProbes(ctx);
    currentModel = ctx.model;
    lastApplied = undefined;
    initializeState(ctx);
    invalidateStateCache();
    refreshStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    bindProbeOwner(ctx);
    cancelAutoProbes(ctx);
    owner.closed = true;
    currentModel = undefined;
    lastApplied = undefined;
    stateInitialized = false;
    invalidateStateCache();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    bindProbeOwner(ctx);
    if (owner.closed || !isServiceTierModelSupported(ctx.model)) {
      lastApplied = undefined;
      return undefined;
    }
    const previousTier = stateCache ? configuredTierForModel(stateCache.config, ctx.model) : undefined;
    const hadConfigIssues = reportedConfigIssues.size > 0;
    const { config, map } = getCachedState(ctx);
    const hasConfigIssues = reportConfigIssues(ctx, config);
    const key = modelKey(ctx.model);
    const tier = configuredTierForModel(config, ctx.model);
    if (!tier) cancelAutoProbes(ctx, key);
    const probing = [...activeProbeRuns].some((run) => run.owner === owner && !run.controller.signal.aborted);
    if (hasConfigIssues || !tier || (!probing && (hadConfigIssues || tier !== previousTier))) {
      ctx.ui.setStatus(STATUS_KEY, statusText(config, map, ctx.model));
    }
    const nextPayload = tier ? payloadWithServiceTier(event.payload, tier) : undefined;
    if (!key || !tier || nextPayload === undefined) {
      lastApplied = undefined;
      if (debugEnabled) {
        const requestedTier = key ? config.entries[key]?.serviceTier : undefined;
        ctx.ui.notify(
          `service_tier debug: no injection for ${key ?? "unknown model"}${requestedTier ? ` requested=${requestedTier}` : ""}.`,
          "info",
        );
      }
      return undefined;
    }
    lastApplied = { key, tier, at: Date.now() };
    if (debugEnabled) {
      ctx.ui.notify(`service_tier debug: injected service_tier=${tier} into ${key} request.`, "info");
    }
    return nextPayload;
  });

  pi.on("message_end", async (event, ctx) => {
    bindProbeOwner(ctx);
    if (event.message.role !== "assistant") return;
    if (!isServiceTierModelSupported(ctx.model) ||
        (event.message.provider && !isServiceTierModelSupported(event.message))) {
      lastApplied = undefined;
      return;
    }
    if (!lastApplied) return;
    const config = readEffectiveConfig(getPaths(ctx));
    if (reportConfigIssues(ctx, config) || !configuredTierForModel(config, ctx.model)) {
      lastApplied = undefined;
      return;
    }
    if (Date.now() - lastApplied.at > 10 * 60 * 1000) {
      lastApplied = undefined;
      return;
    }
    const errorMessage = event.message.errorMessage;
    if (!isUnsupportedServiceTierError(errorMessage)) {
      lastApplied = undefined;
      return;
    }
    const paths = getPaths(ctx);
    const map = ensureMap(paths.map);
    const next = markTierUnsupported(map, lastApplied.key, lastApplied.tier, errorMessage);
    writeMap(paths.map, next);
    invalidateStateCache();
    refreshStatus(ctx);
    ctx.ui.notify(
      `service_tier=${lastApplied.tier} failed for ${lastApplied.key}; updated ${MAP_BASENAME}. The failed request was not retried.`,
      "warning",
    );
    lastApplied = undefined;
  });
}

export const _test = {
  CONFIG_BASENAME,
  MAP_BASENAME,
  STATUS_KEY,
  STATUS_ICON,
  STATUS_OFF_ICON,
  STATUS_ACTIVE_ICON,
  ANSI_RESET,
  ANSI_GREEN,
  DEFAULT_CONFIG,
  DEFAULT_MAP,
  DEFAULT_UNKNOWN_MODEL_BEHAVIOR,
  PACKAGE_NAME,
  COMMAND_FAST_PROJECT,
  COMMAND_FAST_USER,
  COMMAND_FAST_PROJECT_ALIAS,
  COMMAND_FAST_USER_ALIAS,
  COMMAND_TIER_PROJECT,
  COMMAND_TIER_USER,
  COMMAND_REFRESH_SUPPORT,
  COMMAND_REFRESH_SUPPORT_ALL,
  COMMAND_UNSET_SUPPORT,
  COMMAND_UNSET_SUPPORT_ALL,
  COMMAND_UNKNOWN_BEHAVIOR,
  COMMAND_DEBUG,
  TIER_COMMAND_ARGS,
  TOGGLE_COMMAND_ARGS,
  UNKNOWN_BEHAVIOR_COMMAND_ARGS,
  valueCompletions,
  tierCompletions,
  unknownBehaviorCompletions,
  unknownBehaviorScopeValue,
  payloadWithServiceTier,
  statusText,
  colorStatus,
  migrateConfigToCurrent,
  migrateMapToCurrent,
  migrateStartupFiles,
  seedPresetMapEntryIfMissing,
  refreshPresetMapEntry,
  refreshPresetKnowledgeForStoredEntries,
  defaultProbeTier,
  runAutoProbeForCurrentTier,
  startAutoProbeForCurrentTier,
  setProbeTierForTest,
  waitForAutoProbesForTest,
};
