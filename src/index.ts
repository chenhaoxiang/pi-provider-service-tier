import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Api, Context as ProviderContext, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SERVICE_TIERS, isServiceTier, isRecord, isServiceTierModelSupported, isServiceTierProviderSupported, modelKey, normalizeModelKey, parseModelKey, sameRoute, type RouteIdentity, type ServiceTier } from "./service-tiers.ts";
import { DEFAULT_MAP, MapFileError, ensureMap, readMap, writeMap, migrateMapFile, migrateMapToCurrent, routeEntry, mapSupportsTier, mapSupportState, tierRejected, markTierUnsupported, markTierProbeResults, markTierUserMarked, type ServiceTierMapFile } from "./support-map.ts";
import { createProbeEvidence, probeCandidates, unknownProbe, type ProbeTierObservation, type ProbeTierResult } from "./probe-evidence.ts";
import { removeLegacyPresetData } from "./legacy-presets.ts";
import { currentSupportScope, isKnownAuthMode, sameSupportScope, type AuthMode, type SupportScope } from "./auth-scope.ts";
export { SERVICE_TIERS, isServiceTier, isServiceTierModelSupported, isServiceTierProviderSupported, modelKey, normalizeModelKey, parseModelKey } from "./service-tiers.ts";
export type { ServiceTier } from "./service-tiers.ts";
export { MapFileError, readMap, writeMap, ensureMap, routeEntry, mapSupportsTier, mapSupportState, markTierUnsupported, markTierSupported, markTierProbeResults } from "./support-map.ts";
export type { MapSource, ServiceTierMapEntry, ServiceTierMapFile } from "./support-map.ts";

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
const COMMAND_UNSET_SUPPORT = "service-tier-unset-support";
const COMMAND_UNSET_SUPPORT_ALL = "service-tier-unset-support-all";
const COMMAND_UNKNOWN_BEHAVIOR = "service-tier-unknown-behavior";
const COMMAND_DEBUG = "service-tier-debug";

export const UNKNOWN_MODEL_BEHAVIORS = ["ask", "auto-probe", "leave-unknown"] as const;
export type UnknownModelBehavior = (typeof UNKNOWN_MODEL_BEHAVIORS)[number];

export type ConfigScope = "project" | "user";

export interface ServiceTierEntry {
  active?: boolean;
  serviceTier?: ServiceTier;
  [key: string]: unknown;
}

export interface ConfigFile {
  version?: number;
  unknownModelBehavior?: UnknownModelBehavior;
  entries?: Record<string, ServiceTierEntry>;
  [key: string]: unknown;
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

const DEFAULT_UNKNOWN_MODEL_BEHAVIOR: UnknownModelBehavior = "ask";

const DEFAULT_CONFIG: ConfigFile = {
  version: CONFIG_VERSION,
  entries: {},
};

interface LastAppliedTier {
  key: string;
  tier: ServiceTier;
  at: number;
  model: SupportScope;
}

export function isUnknownModelBehavior(value: unknown): value is UnknownModelBehavior {
  return typeof value === "string" && (UNKNOWN_MODEL_BEHAVIORS as readonly string[]).includes(value);
}

function parseEntry(value: unknown): ServiceTierEntry | undefined {
  if (!isRecord(value)) return undefined;
  const entry: ServiceTierEntry = { ...value };
  if (Object.hasOwn(value, "active")) entry.active = value.active === true;
  if (Object.hasOwn(value, "serviceTier")) {
    if (isServiceTier(value.serviceTier)) {
      entry.serviceTier = value.serviceTier;
    } else {
      // An explicit invalid tier must not revive a lower-scope tier after merging.
      delete entry.serviceTier;
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

export function configPaths(cwd: string, home = homedir()): ConfigPaths {
  return {
    project: join(cwd, ".pi", "extensions", CONFIG_BASENAME),
    user: join(home, ".pi", "agent", "extensions", CONFIG_BASENAME),
    map: join(home, ".pi", "agent", "extensions", MAP_BASENAME),
  };
}

function rawFileVersion(value: unknown): number {
  if (!isRecord(value)) return 1;
  return typeof value.version === "number" && Number.isInteger(value.version) && value.version > 0 ? value.version : 1;
}

function migrateConfigV1ToV2(value: unknown): ConfigFile {
  if (!isRecord(value)) return { ...DEFAULT_CONFIG };
  const config: ConfigFile = { ...value, version: 2 };
  delete config.aggressiveProbe;
  delete config.unsupportedModelBehavior;
  const rawUnknownBehavior = value.unknownModelBehavior ?? value.unsupportedModelBehavior;
  if (isUnknownModelBehavior(rawUnknownBehavior)) config.unknownModelBehavior = rawUnknownBehavior;
  const entries = normalizeEntries(value.entries);
  if (entries !== undefined) config.entries = entries;
  return config;
}

function migrateConfigToCurrent(value: unknown): ConfigFile {
  value = removeLegacyPresetData(value, "settings").value;
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
  const value = { ...config, version: CONFIG_VERSION, entries: config.entries ?? {} };
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
  saveConfigFile(path, migrateConfigToCurrent(config), existing.status === "missing");
}

function migrateConfigFile(path: string): ConfigFile | undefined {
  const config = readConfig(path);
  if (config) {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (rawFileVersion(raw) < CONFIG_VERSION || JSON.stringify(raw.entries ?? {}) !== JSON.stringify(config.entries ?? {})) writeConfig(path, config);
  }
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

export function configuredTierForModel(config: EffectiveConfig, model: Model<Api> | undefined): ServiceTier | undefined {
  if (config.configIssues?.length || !isServiceTierModelSupported(model)) return undefined;
  const key = modelKey(model);
  if (!key) return undefined;
  const entry = config.entries[key];
  return entry?.active === true && isServiceTier(entry.serviceTier) ? entry.serviceTier : undefined;
}

export function resolveTierForModel(config: EffectiveConfig, map: ServiceTierMapFile, model: Model<Api> | undefined, scope: SupportScope | undefined = model): ServiceTier | undefined {
  const key = modelKey(model);
  const tier = configuredTierForModel(config, model);
  return mapSupportsTier(map, key, tier, scope) ? tier : undefined;
}

function payloadWithServiceTier(payload: unknown, tier: ServiceTier): unknown | undefined {
  if (!isRecord(payload)) return undefined;
  return { ...payload, service_tier: tier };
}

export function isUnsupportedServiceTierError(message: string | undefined): boolean {
  if (!message) return false;
  return /service[_\s-]?tier/i.test(message) && /unsupported|not\s+supported|invalid|unknown|unrecognized|not\s+recognized|extra_forbidden|unknown\s+parameter|unrecognized\s+request/i.test(message);
}

function colorStatus(text: string, color?: "green"): string {
  if (!color) return text;
  if (process.env.NO_COLOR) return text;
  return `${ANSI_GREEN}${text}${ANSI_RESET}`;
}

function statusText(config: EffectiveConfig, map: ServiceTierMapFile, model: Model<Api> | undefined, scope: SupportScope | undefined = model): string | undefined {
  if (!isServiceTierModelSupported(model)) return undefined;
  const key = modelKey(model);
  if (!key) return undefined;
  if (config.configIssues?.length) return `${STATUS_LABEL} ${STATUS_OFF_ICON} off (config error)`;
  const tier = configuredTierForModel(config, model);
  if (!tier) return colorStatus(`${STATUS_LABEL} ${STATUS_OFF_ICON} off`);
  const support = mapSupportState(map, key, tier, scope);
  const supported = support === "verified";
  const observation = routeEntry(map, scope)?.observations?.[tier];
  const label = support === "verified" ? "probe-verified"
    : support === "request-completed" ? "probe-completed (tier unknown)"
    : support === "fallback" ? `probe-fallback→${observation?.servedTier ?? "unknown"}` : support;
  const prefix = ["priority", "fast", "ultrafast"].includes(tier) ? STATUS_ICON : STATUS_ACTIVE_ICON;
  const text = `${STATUS_LABEL}: ${prefix} ${tier} ${label}`;
  return colorStatus(text, supported ? "green" : undefined);
}

function getCwd(ctx: ExtensionContext): string {
  return ctx.cwd || process.cwd();
}

function getPaths(ctx: ExtensionContext): ConfigPaths {
  return configPaths(getCwd(ctx));
}

const unavailableMaps = new WeakSet<ServiceTierMapFile>();

function contextMap(ctx: ExtensionContext): ServiceTierMapFile {
  try { return ensureMap(getPaths(ctx).map); }
  catch (error) {
    if (!(error instanceof MapFileError)) throw error;
    ctx.ui.notify(error.message, "error");
    const map = { ...DEFAULT_MAP };
    unavailableMaps.add(map);
    return map;
  }
}

const PRESET_REMOVAL_NOTICE = `[${PACKAGE_NAME}] Removed legacy preset information. The preset feature has been removed because service_tier support varies across providers, OAuth/API-key authentication, and API routes.\nChoose service_tier values manually or explicitly approve Auto Probe to check the current provider/model. Request completion alone does not verify the tier actually applied.\nEven the same provider/model can support different service_tier values with OAuth versus API-key access or different APIs; re-check after changing authentication or API. Explicit tier settings were kept and may still be sent. Cleanup does not start probes.`;

function removePresetDataFromSettings(path: string): boolean {
  const existing = readConfigResult(path);
  if (existing.status === "error") throw existing.error;
  if (existing.status === "missing") return false;
  let temporary: string | undefined;
  try {
    const target = realpathSync(path);
    const contents = readFileSync(path, "utf8");
    const raw: unknown = JSON.parse(contents);
    if (!isValidConfigContainer(raw)) throw new ConfigFileError({ path, reason: "schema" });
    const cleanup = removeLegacyPresetData(raw, "settings");
    if (!cleanup.removed) return false;
    temporary = join(dirname(target), `.service-tier-cleanup-${randomUUID()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(cleanup.value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: statSync(target).mode & 0o777 });
    if (realpathSync(path) !== target || readFileSync(path, "utf8") !== contents) throw new ConfigFileError({ path, reason: "write" });
    renameSync(temporary, target);
    return true;
  } catch (error) {
    if (error instanceof ConfigFileError) throw error;
    throw new ConfigFileError({ path, reason: "write" });
  } finally {
    if (temporary) { try { rmSync(temporary, { force: true }); } catch { /* Preserve the original error. */ } }
  }
}

function removeLegacyPresetFiles(paths: ConfigPaths, onRemoved: () => void = () => {}): void {
  assertHealthyConfigScopes(paths);
  for (const path of [paths.user, paths.project]) if (removePresetDataFromSettings(path)) onRemoved();
  if (!readMap(paths.map)) return;
  let contents: string;
  let target: string;
  try { target = realpathSync(paths.map); contents = readFileSync(paths.map, "utf8"); }
  catch { throw new MapFileError(paths.map, "read"); }
  let raw: unknown;
  try { raw = JSON.parse(contents); } catch { throw new MapFileError(paths.map, "json"); }
  const cleanup = removeLegacyPresetData(raw, "map");
  if (!cleanup.removed) return;
  if (realpathSync(paths.map) !== target || readFileSync(paths.map, "utf8") !== contents) throw new MapFileError(paths.map, "changed");
  writeMap(paths.map, cleanup.value);
  onRemoved();
}

function migrateStartupFiles(paths: ConfigPaths): ServiceTierMapFile {
  assertHealthyConfigScopes(paths);
  removeLegacyPresetFiles(paths);
  migrateConfigFile(paths.user);
  migrateConfigFile(paths.project);
  const migratedMap = migrateMapFile(paths.map);
  return migratedMap ?? ensureMap(paths.map);
}

function loadState(ctx: ExtensionContext): { config: EffectiveConfig; map: ServiceTierMapFile } {
  const paths = getPaths(ctx);
  const config = readEffectiveConfig(paths);
  const map = config.configIssues?.length ? { ...DEFAULT_MAP } : contextMap(ctx);
  return { config, map };
}

function updateStatus(ctx: ExtensionContext): void {
  if (!isServiceTierModelSupported(ctx.model)) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }
  const { config, map } = loadState(ctx);
  ctx.ui.setStatus(STATUS_KEY, statusText(config, map, ctx.model, supportScope(ctx)) ?? undefined);
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

type ProbeTierFunction = (model: Model<Api>, tier: ServiceTier, ctx: ExtensionCommandContext, signal?: AbortSignal, expectedAuthMode?: AuthMode) => Promise<ProbeTierObservation>;
type TestProbeFunction = (model: Model<Api>, tier: ServiceTier, ctx: ExtensionCommandContext, signal?: AbortSignal, expectedAuthMode?: AuthMode) => Promise<ProbeTierResult | ProbeTierObservation>;

function probeAbortResult(signal: AbortSignal): { promise: Promise<typeof PROBE_STOPPED>; dispose: () => void } {
  let onAbort!: () => void;
  const promise = new Promise<typeof PROBE_STOPPED>((resolve) => {
    onAbort = () => resolve(PROBE_STOPPED);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

function isActiveProbeTarget(ctx: ExtensionContext, key: string, api: string, authMode: AuthMode | undefined): boolean {
  try {
    const scope = supportScope(ctx);
    return isKnownAuthMode(authMode) && scope?.authMode === authMode && isServiceTierModelSupported(ctx.model) && modelKey(ctx.model) === key && ctx.model?.api === api &&
      configuredTierForModel(readEffectiveConfig(getPaths(ctx)), ctx.model) !== undefined;
  } catch {
    return false;
  }
}

async function defaultProbeTier(model: Model<Api>, tier: ServiceTier, ctx: ExtensionCommandContext, signal?: AbortSignal, expectedAuthMode?: AuthMode): Promise<ProbeTierObservation> {
  if (signal?.aborted || !isServiceTierModelSupported(model)) return unknownProbe();
  const scope = supportScope(ctx, model);
  const owner = probeOwnerForContext(ctx);
  const generation = owner.generation;
  if (owner.closed || !isKnownAuthMode(scope?.authMode) || expectedAuthMode !== undefined && scope.authMode !== expectedAuthMode) return unknownProbe();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const cancelled = probeAbortResult(controller.signal);
  const evidence = createProbeEvidence(model, tier);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closeIterator: (() => void) | undefined;
  const canInspect = (resolved: RouteIdentity) => {
    if (controller.signal.aborted || (signal && !isActiveProbeTarget(ctx, modelKey(model)!, model.api, scope.authMode)) || !sameRoute(model, resolved) || !isServiceTierModelSupported(resolved) || !sameSupportScope(scope, supportScope(ctx, resolved as Model<Api>)) || owner.closed || owner.generation !== generation) {
      controller.abort();
      return false;
    }
    return true;
  };
  try {
    const context: ProviderContext = { messages: [{ role: "user", content: "Reply OK.", timestamp: Date.now() }] };
    const options: SimpleStreamOptions = {
      maxTokens: 1, maxRetries: 0, signal: controller.signal,
      onPayload: (payload, requestModel) => {
        if (!canInspect(requestModel)) throw new Error("Service-tier probe cancelled or provider/model/API changed.");
        const next = payloadWithServiceTier(payload, tier);
        if (!evidence.prepare(next, requestModel)) {
          controller.abort();
          throw new Error("Could not prepare a service-tier probe payload.");
        }
        return next;
      },
      onProviderStreamEvent: (data, requestModel) => {
        if (canInspect(requestModel)) evidence.observe(data, requestModel);
      },
    };
    timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const iterator = ctx.modelRegistry.streamSimple(model, context, options)[Symbol.asyncIterator]();
    closeIterator = () => {
      try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Already stopped. */ }
    };
    while (true) {
      const next = await Promise.race([iterator.next(), cancelled.promise]);
      if (controller.signal.aborted || next === PROBE_STOPPED || next.done) return unknownProbe();
      const event = next.value;
      if (event.type === "done") return evidence.finish();
      if (event.type === "error") return isUnsupportedServiceTierError(event.error.errorMessage) ? evidence.finish(true) : unknownProbe();
    }
  } catch (error) {
    if (controller.signal.aborted) return unknownProbe();
    const message = error instanceof Error ? error.message : String(error);
    return isUnsupportedServiceTierError(message) ? evidence.finish(true) : unknownProbe();
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
  authModes: Map<string, AuthMode>;
  onAuthChange?: () => void;
}

function createProbeOwner(): ProbeOwner {
  return { generation: 0, closed: false, authModes: new Map() };
}

function supportScope(ctx: ExtensionContext, model = ctx.model): SupportScope | undefined {
  const scope = currentSupportScope(ctx, model);
  if (!scope || !isServiceTierModelSupported(scope)) return scope;
  const owner = probeOwnerForContext(ctx);
  const mode = scope.authMode ?? "unknown";
  const previous = owner.authModes.get(scope.provider);
  owner.authModes.set(scope.provider, mode);
  if (!owner.closed && previous !== undefined && previous !== mode) {
    cancelAutoProbes(ctx);
    owner.onAuthChange?.();
    ctx.ui.notify(`[${PACKAGE_NAME}] Authentication changed for ${modelKey(scope)} (${scope.api}): ${previous} → ${mode}. Only this authentication mode's support records apply; without one, support is unknown. Explicit tier settings are unchanged; healthy active settings will still be sent. Re-confirm support manually or explicitly approve Auto Probe (may cost money). No probe was started by this change.`, "warning");
  }
  return scope;
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
    owner = createProbeOwner();
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

function setProbeTierForTest(next: TestProbeFunction): () => void {
  const previous = probeTier;
  probeTier = async (model, tier, ctx, signal, expectedAuthMode) => {
    const result = await next(model, tier, ctx, signal, expectedAuthMode);
    if (typeof result !== "string") return result;
    if (result === "unknown") return unknownProbe();
    // Legacy string test fixtures represent explicit mocked evidence, not SDK completion.
    return { result, kind: result === "supported" ? "verified" : "rejected", payloadPrepared: true,
      requestCompleted: result === "supported", servedTier: result === "supported" ? tier === "auto" ? model.provider === "groq" ? "on_demand" : "default" : tier : undefined,
      updatedAt: new Date().toISOString() };
  };
  return () => { probeTier = previous; };
}

async function waitForAutoProbesForTest(): Promise<void> {
  while (activeAutoProbes.size > 0) {
    await Promise.allSettled([...activeAutoProbes]);
  }
}

async function runAutoProbeForCurrentTier(ctx: ExtensionCommandContext, key: string, tier: ServiceTier): Promise<ProbeTierResult> {
  if (!ctx.model) { ctx.ui.notify("No current model selected.", "error"); return "unknown"; }
  if (!isServiceTierModelSupported(ctx.model)) return "unknown";
  const model = ctx.model;
  const scope = supportScope(ctx);
  if (!isKnownAuthMode(scope?.authMode)) {
    ctx.ui.notify(`[${PACKAGE_NAME}] Cannot determine OAuth/API-key authentication; support remains unknown and no probe was sent. Explicit tier settings are unchanged.`, "warning");
    return "unknown";
  }
  const candidates = probeCandidates(model);
  const owner = probeOwnerForContext(ctx);
  if (owner.closed || !isActiveProbeTarget(ctx, key, model.api, scope.authMode)) return "unknown";
  cancelAutoProbes(ctx, key);
  const controller = new AbortController();
  const run = { owner, key, controller };
  activeProbeRuns.add(run);
  const cancelled = probeAbortResult(controller.signal);
  const canContinue = () => {
    if (controller.signal.aborted) return false;
    if (!owner.closed && isActiveProbeTarget(ctx, key, model.api, scope.authMode)) return true;
    controller.abort();
    if (!owner.closed) updateStatus(ctx);
    return false;
  };
  const paths = getPaths(ctx);
  let probeStatus: ReturnType<typeof startProbeStatus> | undefined;
  const results: Partial<Record<ServiceTier, ProbeTierObservation>> = {};
  try {
    ctx.ui.notify(`service_tier auto-probe started for ${key} (${model.api}, ${scope.authMode}); checking ${candidates.length} candidate tier(s)...`, "warning");
    probeStatus = startProbeStatus(ctx, controller.signal, canContinue);
    for (const [index, currentTier] of candidates.entries()) {
      if (!canContinue()) return "unknown";
      probeStatus.update(currentTier, index + 1, candidates.length);
      const result = await Promise.race([probeTier(model, currentTier, ctx, controller.signal, scope.authMode), cancelled.promise]);
      if (result === PROBE_STOPPED || !canContinue()) return "unknown";
      if (result.result === "unknown" && (result.requestCompleted !== true || result.payloadPrepared !== true)) {
        ctx.ui.notify(`service_tier auto-probe did not determine ${currentTier}; ${MAP_BASENAME} was not changed.`, "warning");
        return "unknown";
      }
      results[currentTier] = result;
    }
    if (!canContinue()) return "unknown";
    const map = ensureMap(paths.map);
    const unsupported = candidates.filter((candidate) => results[candidate]?.result === "unsupported");
    writeMap(paths.map, markTierProbeResults(map, key, results, scope,
      unsupported.length ? `service_tier auto-probe rejected: ${unsupported.join(", ")}` : undefined));
    updateStatus(ctx);
    const verified = candidates.filter((candidate) => results[candidate]?.kind === "verified");
    ctx.ui.notify(`service_tier auto-probe completed for ${key}; probe-verified: ${verified.join(", ") || "none"}. Request completion alone is not tier verification.`, "info");
    return results[tier]?.result ?? "unknown";
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
  const scope = supportScope(ctx);
  const owner = probeOwnerForContext(ctx);
  const generation = owner.generation;
  const api = ctx.model?.api;
  if (!isKnownAuthMode(scope?.authMode)) {
    ctx.ui.notify(`[${PACKAGE_NAME}] Cannot determine OAuth/API-key authentication; support stays unknown. No automatic probe or support record was created; explicit tier settings are unchanged.`, "warning");
    return;
  }
  const { config, map } = loadState(ctx);
  if (owner.closed || configuredTierForModel(config, ctx.model) !== tier) return;
  if (config.unknownModelBehavior === "auto-probe") {
    ctx.ui.notify(`service_tier=${tier} auto-probe behavior will probe this provider/API's candidate tiers for ${key} now.`, "info");
    startAutoProbeForCurrentTier(ctx, key, tier);
    return;
  }
  const mapEntry = routeEntry(map, scope);
  if (mapSupportsTier(map, key, tier, scope)) return;
  if (tierRejected(mapEntry, tier)) {
    ctx.ui.notify(`service_tier=${tier} is not supported by the support map for ${key}; configured requests will still send it.`, "info");
    return;
  }
  if (mapEntry?.source === "user-mark") {
    ctx.ui.notify(`service_tier=${tier} was left unknown for ${key}; configured requests will still send it.`, "info");
    return;
  }
  if (mapEntry?.observations?.[tier]?.requestCompleted) return;
  if (config.unknownModelBehavior === "leave-unknown") {
    ctx.ui.notify(`service_tier=${tier} is not recorded in the support map for ${key}; active configuration will still send it.`, "info");
    return;
  }

  const choice = await ctx.ui.select(
    [
      `service_tier=${tier} is not recorded in the support map for ${key}.`,
      "",
      "Auto-probe sends low-token requests for this provider/API's candidate tiers and may consume provider tokens. Completion alone does not verify tier delivery.",
    ].join("\n"),
    [...UNSUPPORTED_PROMPT_CHOICES],
  );
  if (owner.closed || owner.generation !== generation || !isServiceTierModelSupported(ctx.model) ||
      modelKey(ctx.model) !== key || ctx.model?.api !== api || !sameSupportScope(scope, supportScope(ctx)) ||
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
      writeMap(paths.map, markTierUserMarked(ensureMap(paths.map), key, tier, scope));
      updateStatus(ctx);
    }
    ctx.ui.notify(`service_tier=${tier} will remain unknown for ${key}; configured requests will still send it.`, "info");
    return;
  }
  if (choice === LEAVE_ALWAYS_CHOICE) {
    if (ctx.model) {
      writeMap(paths.map, markTierUserMarked(ensureMap(paths.map), key, tier, scope));
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

function notifyScopeStatus(ctx: ExtensionCommandContext, configScope: ConfigScope): void {
  const scope = supportScope(ctx);
  const { config, map } = loadState(ctx);
  const key = modelKey(ctx.model);
  if (!key) return ctx.ui.notify("No current model selected.", "error");
  const effectiveTier = configuredTierForModel(config, ctx.model);
  const scoped = readScopeConfig(config.paths, configScope).entries?.[key];
  const mapEntry = routeEntry(map, scope);
  const support = effectiveTier ? mapSupportState(map, key, effectiveTier, scope) : "unknown";
  ctx.ui.notify(
    [
      `${configScope} service tier for ${key}: ${scoped?.active ? scoped.serviceTier ?? "unset" : scoped?.active === false ? "off" : "unset"}`,
      `effective: ${effectiveTier ?? "off"}`,
      `map (${ctx.model?.api}, ${scope?.authMode ?? "unknown"}): ${mapEntry?.tiers.join(", ") || "unknown"}`,
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

function removeMapEntry(path: string, model: SupportScope | undefined): ServiceTierMapFile {
  const map = ensureMap(path);
  const key = modelKey(model)!;
  const current = map.entries?.[key];
  if (!current || !model?.api || !isKnownAuthMode(model.authMode)) return map;
  const route = current.routes[model.api];
  if (!route?.auth[model.authMode]) return map;
  const auth = { ...route.auth };
  delete auth[model.authMode];
  const routes = { ...current.routes, [model.api]: { ...route, auth } };
  if (!Object.keys(auth).length && Object.keys(route).every((field) => field === "auth")) delete routes[model.api];
  const entries = { ...map.entries, [key]: { ...current, routes } };
  if (!Object.keys(routes).length && !current.legacy?.length && Object.keys(current).every((field) => field === "routes" || field === "legacy")) delete entries[key];
  const next = { ...map, entries };
  writeMap(path, next);
  return next;
}

function clearMap(path: string): ServiceTierMapFile {
  const map = ensureMap(path);
  const entries = Object.fromEntries(Object.entries(map.entries ?? {}).map(([key, entry]) => [key, {
    ...entry, routes: Object.fromEntries(Object.entries(entry.routes).map(([api, route]) => [api, {
      ...route, auth: Object.fromEntries(Object.entries(route.auth).filter(([mode, record]) => !isKnownAuthMode(mode) || !isServiceTierModelSupported(record))),
    }] as const).filter(([, route]) => Object.keys(route.auth).length || Object.keys(route).some((field) => field !== "auth"))),
  }] as const).filter(([, entry]) => Object.keys(entry.routes).length || entry.legacy?.length || Object.keys(entry).some((field) => field !== "routes" && field !== "legacy")));
  const next = { ...map, entries };
  writeMap(path, next);
  return next;
}

async function handleUnsetSupport(ctx: ExtensionCommandContext): Promise<void> {
  const paths = getPaths(ctx);
  const key = currentModelKeyOrNotify(ctx);
  if (!key) return;
  if (ctx.model) removeMapEntry(paths.map, supportScope(ctx));
  updateStatus(ctx);
  ctx.ui.notify(`service_tier support is now unknown for ${key} (${supportScope(ctx)?.authMode ?? "unknown"}).`, "info");
}

async function handleUnsetSupportAll(ctx: ExtensionCommandContext): Promise<void> {
  const paths = getPaths(ctx);
  clearMap(paths.map);
  updateStatus(ctx);
  ctx.ui.notify("service_tier support map cleared for known-auth supported provider/API routes; blocked and unclassified historical records were preserved.", "info");
}

export default function piServiceTier(pi: ExtensionAPI): void {
  let lastApplied: LastAppliedTier | undefined;
  let debugEnabled = false;
  let currentModel: Model<Api> | undefined;
  let stateInitialized = false;
  let presetRemovalNotified = false;
  let stateCache: { config: EffectiveConfig; map: ServiceTierMapFile } | undefined;
  let owner: ProbeOwner = createProbeOwner();
  let reportedConfigIssues = new Set<string>();
  const bindProbeOwner = (ctx: ExtensionContext) => {
    owner.onAuthChange = () => { lastApplied = undefined; stateCache = undefined; };
    probeOwners.set(ctx, owner);
  };
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
      : stateCache?.config.configIssues?.length || (stateCache && unavailableMaps.has(stateCache.map)) ? contextMap(ctx) : stateCache?.map ?? contextMap(ctx);
    stateCache = { config, map };
    return stateCache;
  };
  const initializeState = (ctx: ExtensionContext) => {
    if (stateInitialized) return;
    const paths = getPaths(ctx);
    if (readEffectiveConfig(paths).configIssues?.length) return;
    try {
      removeLegacyPresetFiles(paths, () => {
        if (presetRemovalNotified) return;
        presetRemovalNotified = true;
        ctx.ui.notify(PRESET_REMOVAL_NOTICE, "warning");
      });
      if (!isServiceTierModelSupported(ctx.model)) return;
      migrateStartupFiles(paths);
      stateInitialized = true;
    } catch (error) {
      if (!(error instanceof ConfigFileError) && !(error instanceof MapFileError)) throw error;
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
    ctx.ui.setStatus(STATUS_KEY, statusText(stateCache.config, stateCache.map, ctx.model, supportScope(ctx)) ?? undefined);
  };
  const supportedCompletions = (complete: typeof tierCompletions) => (prefix: string) =>
    isServiceTierModelSupported(currentModel) ? complete(prefix) : null;
  const commandHandler = (handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>) => async (args: string, ctx: ExtensionCommandContext) => {
    bindProbeOwner(ctx);
    supportScope(ctx);
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
      ctx.ui.setStatus(STATUS_KEY, statusText(config, DEFAULT_MAP, ctx.model, supportScope(ctx)));
      return;
    }
    try {
      await handler(args, ctx);
    } catch (error) {
      if (!(error instanceof ConfigFileError) && !(error instanceof MapFileError)) throw error;
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

  pi.registerCommand(COMMAND_UNSET_SUPPORT, {
    description: "Remove service_tier support for the current provider/model/API/authentication mode",
    handler: commandHandler(async (_args, ctx) => handleUnsetSupport(ctx)),
  });

  pi.registerCommand(COMMAND_UNSET_SUPPORT_ALL, {
    description: "Clear known-auth service_tier support on eligible routes, preserving blocked/unclassified history",
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
    owner = createProbeOwner();
    bindProbeOwner(ctx);
    reportedConfigIssues.clear();
    currentModel = ctx.model;
    stateInitialized = false;
    presetRemovalNotified = false;
    lastApplied = undefined;
    supportScope(ctx);
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
    supportScope(ctx);
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
    const scope = supportScope(ctx);
    const previousTier = stateCache ? configuredTierForModel(stateCache.config, ctx.model) : undefined;
    const hadConfigIssues = reportedConfigIssues.size > 0;
    const hadMapIssues = stateCache !== undefined && unavailableMaps.has(stateCache.map);
    const { config, map } = getCachedState(ctx);
    const hasConfigIssues = reportConfigIssues(ctx, config);
    const key = modelKey(ctx.model);
    const tier = configuredTierForModel(config, ctx.model);
    if (!tier) cancelAutoProbes(ctx, key);
    const probing = [...activeProbeRuns].some((run) => run.owner === owner && !run.controller.signal.aborted);
    if (hasConfigIssues || !tier || (!probing && (hadConfigIssues || hadMapIssues || tier !== previousTier))) {
      ctx.ui.setStatus(STATUS_KEY, statusText(config, map, ctx.model, supportScope(ctx)));
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
    lastApplied = { key, tier, at: Date.now(), model: scope! };
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
    const scope = supportScope(ctx);
    if (!lastApplied) return;
    const messageRoute = event.message.provider
      ? { provider: event.message.provider, id: event.message.model, api: event.message.api } : ctx.model;
    if (!sameSupportScope(lastApplied.model, scope) || !sameRoute(lastApplied.model, messageRoute)) { lastApplied = undefined; return; }
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
    const next = markTierUnsupported(map, lastApplied.key, lastApplied.tier, errorMessage, lastApplied.model);
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
  supportScope,
  colorStatus,
  migrateConfigToCurrent,
  migrateMapToCurrent,
  migrateStartupFiles,
  removeLegacyPresetFiles,
  PRESET_REMOVAL_NOTICE,
  defaultProbeTier,
  probeCandidates,
  runAutoProbeForCurrentTier,
  startAutoProbeForCurrentTier,
  setProbeTierForTest,
  waitForAutoProbesForTest,
};
