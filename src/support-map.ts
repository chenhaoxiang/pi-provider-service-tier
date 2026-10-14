import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isRecord, isServiceTier, isServiceTierModelSupported, modelKey, normalizeModelKey, parseModelKey, sameRoute, uniqueTiers, type RouteIdentity, type ServiceTier } from "./service-tiers.ts";
import { probeCandidates, tierMatchesServed, type EvidenceKind, type ProbeTierObservation, type TierEvidence } from "./probe-evidence.ts";
import { removeLegacyPresetData } from "./legacy-presets.ts";

export const MAP_VERSION = 3;
export type MapSource = "probe" | "error" | "manual" | "user-mark";
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
  evidence?: Partial<Record<ServiceTier, TierEvidence>>;
  observations?: Partial<Record<ServiceTier, TierEvidence>>;
  [key: string]: unknown;
}
export interface ServiceTierMapModel {
  routes: Record<string, ServiceTierMapEntry>;
  legacy?: unknown[];
  [key: string]: unknown;
}
export interface ServiceTierMapFile {
  version?: number;
  entries?: Record<string, ServiceTierMapModel>;
  preserved?: Record<string, unknown>;
  [key: string]: unknown;
}
export const DEFAULT_MAP: Required<Pick<ServiceTierMapFile, "version" | "entries">> = { version: MAP_VERSION, entries: {} };

export class MapFileError extends Error {
  readonly path: string;
  readonly reason: "read" | "json" | "version" | "write" | "changed";
  constructor(path: string, reason: "read" | "json" | "version" | "write" | "changed") {
    super(`Could not ${reason === "write" || reason === "changed" ? "save" : "use"} service-tier support map ${path} (${reason} error). Existing map data was not reset; support-map errors do not disable explicitly configured tiers.`);
    this.name = "MapFileError";
    this.path = path;
    this.reason = reason;
  }
}

const EVIDENCE_KINDS: readonly EvidenceKind[] = ["manual", "legacy", "verified", "request-completed", "fallback", "rejected"];
function normalizeEvidence(value: unknown, model: RouteIdentity, tier: ServiceTier): TierEvidence | undefined {
  if (!isRecord(value) || !EVIDENCE_KINDS.includes(value.kind as EvidenceKind)) return undefined;
  let kind = value.kind as EvidenceKind;
  const servedTier = typeof value.servedTier === "string" && value.servedTier.length <= 32 ? value.servedTier : undefined;
  if (kind === "verified" && (value.payloadPrepared !== true || value.requestCompleted !== true ||
      servedTier === undefined || !tierMatchesServed(model, tier, servedTier))) kind = "legacy";
  if (kind === "rejected" && value.payloadPrepared !== true) kind = "legacy";
  return {
    kind, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    ...(typeof value.payloadPrepared === "boolean" ? { payloadPrepared: value.payloadPrepared } : {}),
    ...(typeof value.requestCompleted === "boolean" ? { requestCompleted: value.requestCompleted } : {}),
    ...(servedTier !== undefined ? { servedTier } : {}),
  };
}

// Tolerant field normalization: bad metadata never rejects otherwise readable records.
export function normalizeMapEntry(key: string, value: unknown, api?: string): ServiceTierMapEntry | undefined {
  if (!isRecord(value)) return undefined;
  const parsed = parseModelKey(key);
  if (!parsed) return undefined;
  const provider = typeof value.provider === "string" && value.provider.trim() ? value.provider.trim() : parsed.provider;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : parsed.id;
  const storedApi = typeof value.api === "string" && value.api.trim() ? value.api.trim() : undefined;
  if (provider !== parsed.provider || id !== parsed.id || (api && storedApi && api !== storedApi)) return undefined;
  const routeApi = api ?? storedApi;
  const tiers = Array.isArray(value.tiers) ? uniqueTiers(value.tiers.filter(isServiceTier)) : [];
  const unsupportedTiers = Array.isArray(value.unsupportedTiers) ? uniqueTiers(value.unsupportedTiers.filter(isServiceTier)) : [];
  const source: MapSource = typeof value.source === "string" && ["probe", "error", "manual", "user-mark"].includes(value.source) ? value.source as MapSource : "manual";
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
  const determined = typeof value.determined === "boolean" ? value.determined : typeof value.supported === "boolean" ? value.supported : tiers.length > 0;
  const model = { provider, id, api: routeApi };
  const evidence: Partial<Record<ServiceTier, TierEvidence>> = {};
  const observations: Partial<Record<ServiceTier, TierEvidence>> = {};
  for (const tier of [...tiers, ...unsupportedTiers]) {
    const provided = isRecord(value.evidence) ? normalizeEvidence(value.evidence[tier], model, tier) : undefined;
    evidence[tier] = provided ?? { kind: determined && value.source === "manual" && tiers.includes(tier) ? "manual" : "legacy", updatedAt };
  }
  if (isRecord(value.observations)) {
    for (const [tier, observation] of Object.entries(value.observations)) {
      if (!isServiceTier(tier)) continue;
      const normalized = normalizeEvidence(observation, model, tier);
      if (normalized) observations[tier] = normalized;
    }
  }
  const { supported: _supported, unsupportedTiers: _unsupported, observations: _observations, error: _error, ...rest } = value;
  const normalized: ServiceTierMapEntry = {
    ...rest, provider, id, ...(routeApi ? { api: routeApi } : {}), determined,
    tiers, ...(unsupportedTiers.length ? { unsupportedTiers } : {}), source, updatedAt, evidence,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(Object.keys(observations).length ? { observations } : {}),
  };
  const preservedFields = isRecord(value.preservedFields) ? { ...value.preservedFields } : {};
  for (const field of ["provider", "id", "api", "determined", "tiers", "unsupportedTiers", "source", "updatedAt", "error", "evidence", "observations"]) {
    if (value[field] !== undefined && JSON.stringify(value[field]) !== JSON.stringify(normalized[field])) preservedFields[field] = value[field];
  }
  if (Object.keys(preservedFields).length) normalized.preservedFields = preservedFields;
  return normalized;
}

export function migrateMapToCurrent(value: unknown): ServiceTierMapFile {
  value = removeLegacyPresetData(value, "map").value;
  if (!isRecord(value)) return { ...DEFAULT_MAP, preserved: { root: value } };
  const entries: Record<string, ServiceTierMapModel> = {};
  const preserved: Record<string, unknown> = isRecord(value.preserved) ? { ...value.preserved } : {};
  if (value.entries !== undefined && !isRecord(value.entries)) preserved.entries = value.entries;
  for (const [rawKey, rawEntry] of Object.entries(isRecord(value.entries) ? value.entries : {})) {
    const key = normalizeModelKey(rawKey);
    if (!key) { Object.defineProperty(preserved, rawKey, { value: rawEntry, enumerable: true, configurable: true, writable: true }); continue; }
    const target: ServiceTierMapModel = entries[key] ?? { routes: {} };
    const retain = (item: unknown) => { target.legacy = [...target.legacy ?? [], item]; };
    if (isRecord(rawEntry) && isRecord(rawEntry.routes)) {
      const { routes: _routes, legacy: _legacy, ...extra } = rawEntry;
      for (const [field, item] of Object.entries(extra)) Object.defineProperty(target, field, { value: item, enumerable: true, configurable: true, writable: true });
      if (Array.isArray(rawEntry.legacy)) target.legacy = [...target.legacy ?? [], ...rawEntry.legacy];
      else if (rawEntry.legacy !== undefined) retain(rawEntry.legacy);
      for (const [rawApi, rawRoute] of Object.entries(rawEntry.routes)) {
        const api = rawApi.trim();
        const route = api ? normalizeMapEntry(key, rawRoute, api) : undefined;
        if (!route || target.routes[api]) { retain({ api: rawApi, record: rawRoute }); continue; }
        target.routes[api] = route;
      }
    } else {
      // Old probes never tracked payload/served-tier proof. Even similarly named
      // optional old fields must not be promoted to new-schema verification.
      const oldEvidence = isRecord(rawEntry) && value.version !== MAP_VERSION && (rawEntry.evidence !== undefined || rawEntry.observations !== undefined)
        ? { ...rawEntry, previousEvidence: { ...(rawEntry.evidence !== undefined ? { evidence: rawEntry.evidence } : {}), ...(rawEntry.observations !== undefined ? { observations: rawEntry.observations } : {}) }, evidence: undefined, observations: undefined } : rawEntry;
      const route = normalizeMapEntry(key, oldEvidence);
      if (route?.api && !target.routes[route.api]) target.routes[route.api] = route;
      else retain(rawEntry);
    }
    entries[key] = target;
  }
  const { entries: _entries, preserved: _preserved, ...rest } = value;
  return { ...rest, version: MAP_VERSION, entries, ...(Object.keys(preserved).length ? { preserved } : {}) };
}

export function routeEntry(map: unknown, model: RouteIdentity | undefined): ServiceTierMapEntry | undefined {
  if (!model || !isServiceTierModelSupported(model)) return undefined;
  const current = migrateMapToCurrent(map);
  const entries = isRecord(current.entries) ? current.entries : {};
  const modelEntry = entries[modelKey(model)!];
  const raw = isRecord(modelEntry) && isRecord(modelEntry.routes) ? modelEntry.routes[model.api!] : undefined;
  const entry = normalizeMapEntry(modelKey(model)!, raw, model.api);
  return sameRoute(entry, model) ? entry : undefined;
}

export function putRoute(map: unknown, entry: ServiceTierMapEntry): ServiceTierMapFile {
  const next = migrateMapToCurrent(map);
  const key = modelKey(entry)!;
  const normalized = normalizeMapEntry(key, entry);
  const existing = next.entries?.[key] ?? { routes: {} };
  const modelEntry = normalized?.api
    ? { ...existing, routes: { ...existing.routes, [normalized.api]: normalized } }
    : { ...existing, legacy: [...existing.legacy ?? [], entry] };
  return { ...next, entries: { ...next.entries, [key]: modelEntry } };
}

export function tierRejected(entry: ServiceTierMapEntry | undefined, tier: ServiceTier | undefined): boolean {
  return !!entry && !!tier && entry.unsupportedTiers?.includes(tier) === true && entry.evidence?.[tier]?.kind === "rejected";
}

export function mapSupportsTier(map: unknown, key: string | undefined, tier: ServiceTier | undefined, model?: RouteIdentity): boolean {
  if (!model || modelKey(model) !== key || !tier) return false;
  const entry = routeEntry(map, model);
  if (!entry || tierRejected(entry, tier) || !entry.tiers.includes(tier)) return false;
  return ["manual", "verified"].includes(entry.evidence?.[tier]?.kind ?? "legacy");
}

export function mapSupportState(map: unknown, key: string | undefined, tier: ServiceTier | undefined, model?: RouteIdentity): EvidenceKind | "unknown" {
  if (!model || modelKey(model) !== key || !tier) return "unknown";
  const entry = routeEntry(map, model);
  const observation = entry?.observations?.[tier];
  if (observation && ["request-completed", "fallback"].includes(observation.kind)) return observation.kind;
  if (!mapSupportsTier(map, key, tier, model)) return "unknown";
  return entry?.evidence?.[tier]?.kind ?? "unknown";
}

export function probeEntryKnowsTier(entry: ServiceTierMapEntry | undefined, tier: ServiceTier | undefined): boolean {
  if (!entry || !tier) return false;
  return entry.evidence?.[tier]?.kind === "verified" || tierRejected(entry, tier);
}

export function markTierUnsupported(map: unknown, key: string, tier: ServiceTier, error?: string, model?: RouteIdentity): ServiceTierMapFile {
  const next = migrateMapToCurrent(map);
  if (!model || modelKey(model) !== key || !isServiceTierModelSupported(model)) return next;
  const existing = routeEntry(next, model);
  const rejection: TierEvidence = { kind: "rejected", payloadPrepared: true, requestCompleted: false, updatedAt: new Date().toISOString() };
  return putRoute(next, {
    ...existing, provider: model.provider, id: model.id, api: model.api, determined: false,
    tiers: uniqueTiers((existing?.tiers ?? []).filter((value) => value !== tier)),
    unsupportedTiers: uniqueTiers([...(existing?.unsupportedTiers ?? []), tier]),
    evidence: { ...existing?.evidence, [tier]: rejection }, observations: { ...existing?.observations, [tier]: rejection },
    source: "error", updatedAt: rejection.updatedAt, ...(error ? { error } : {}),
  });
}

export function markTierSupported(map: unknown, key: string, tier: ServiceTier, model?: RouteIdentity): ServiceTierMapFile {
  const next = migrateMapToCurrent(map);
  if (!model || modelKey(model) !== key || !isServiceTierModelSupported(model)) return next;
  const existing = routeEntry(next, model);
  const evidence: TierEvidence = { kind: "manual", updatedAt: new Date().toISOString() };
  return putRoute(next, {
    ...existing, provider: model.provider, id: model.id, api: model.api, determined: existing?.determined ?? true,
    tiers: uniqueTiers([...(existing?.tiers ?? []), tier]),
    unsupportedTiers: (existing?.unsupportedTiers ?? []).filter((value) => value !== tier),
    evidence: { ...existing?.evidence, [tier]: evidence }, source: "manual", updatedAt: evidence.updatedAt,
  });
}

export function markTierProbeResults(map: unknown, key: string, results: Partial<Record<ServiceTier, ProbeTierObservation>>, model?: RouteIdentity, error?: string): ServiceTierMapFile {
  let next = migrateMapToCurrent(map);
  if (!model || modelKey(model) !== key || !isServiceTierModelSupported(model)) return next;
  let entry = routeEntry(next, model) ?? { provider: model.provider, id: model.id, api: model.api, determined: false, tiers: [], source: "probe" as const, updatedAt: "" };
  for (const [rawTier, rawObservation] of Object.entries(results)) {
    if (!isServiceTier(rawTier)) continue;
    const observation = normalizeEvidence(rawObservation, model, rawTier);
    if (!observation || observation.kind === "legacy") continue;
    const tiers = entry.tiers.filter((value) => value !== rawTier || !["verified", "rejected"].includes(observation.kind));
    const unsupported = (entry.unsupportedTiers ?? []).filter((value) => value !== rawTier || !["verified", "rejected"].includes(observation.kind));
    if (observation.kind === "verified") tiers.push(rawTier);
    if (observation.kind === "rejected") unsupported.push(rawTier);
    entry = {
      ...entry, tiers: uniqueTiers(tiers), unsupportedTiers: uniqueTiers(unsupported),
      evidence: { ...entry.evidence, ...(["verified", "rejected"].includes(observation.kind) ? { [rawTier]: observation } : {}) },
      observations: { ...entry.observations, [rawTier]: observation }, source: "probe", updatedAt: observation.updatedAt,
    };
  }
  entry = { ...entry, determined: probeCandidates(model).every((tier) => !!entry.observations?.[tier]), ...(error ? { error } : {}) };
  next = putRoute(next, entry);
  return next;
}

export function markTierUserMarked(map: unknown, key: string, _tier: ServiceTier, model?: RouteIdentity): ServiceTierMapFile {
  const next = migrateMapToCurrent(map);
  if (!model || modelKey(model) !== key || !isServiceTierModelSupported(model)) return next;
  const existing = routeEntry(next, model);
  return putRoute(next, {
    ...existing, provider: model.provider, id: model.id, api: model.api, determined: existing?.determined ?? false,
    tiers: [...existing?.tiers ?? []], source: "user-mark", updatedAt: new Date().toISOString(),
  });
}

interface MapRead { contents: string; parsed: unknown; map: ServiceTierMapFile }
function readMapFile(path: string): MapRead | undefined {
  let contents: string;
  try { contents = readFileSync(path, "utf8"); }
  catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      try { lstatSync(path); } catch (statError) { if (isRecord(statError) && statError.code === "ENOENT") return undefined; }
    }
    throw new MapFileError(path, "read");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(contents); } catch { throw new MapFileError(path, "json"); }
  const version = isRecord(parsed) ? typeof parsed.version === "number" ? parsed.version :
    typeof parsed.version === "string" && /^\d+$/.test(parsed.version) ? Number(parsed.version) : undefined : undefined;
  if (version !== undefined && Number.isInteger(version) && version > MAP_VERSION) throw new MapFileError(path, "version");
  return { contents, parsed, map: migrateMapToCurrent(parsed) };
}

export function readMap(path: string): ServiceTierMapFile | undefined { return readMapFile(path)?.map; }

function saveMap(path: string, map: ServiceTierMapFile, before: MapRead | undefined): void {
  let temporary: string | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const contents = `${JSON.stringify(map, null, 2)}\n`;
    if (!before) { writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 }); return; }
    const target = realpathSync(path);
    temporary = join(dirname(target), `.${MAP_VERSION}-service-tier-${randomUUID()}.tmp`);
    writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx", mode: statSync(target).mode & 0o777 });
    // Back up actual normalization (including preset retirement); stale backups are not failures.
    if (JSON.stringify(before.parsed) !== JSON.stringify(before.map)) {
      const version = isRecord(before.parsed) && (before.parsed.version === 1 || before.parsed.version === 2) ? before.parsed.version : "legacy";
      try { writeFileSync(`${path}.v${version}.backup`, before.contents, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (!(isRecord(error) && error.code === "EEXIST")) console.warn(`Could not create optional service-tier map backup for ${path}; continuing with safe file replacement.`);
      }
    }
    if (realpathSync(path) !== target) throw new MapFileError(path, "changed");
    if (readFileSync(path, "utf8") !== before.contents) {
      const current = readMapFile(path);
      // Two sessions can finish the same upgrade. Accept its already-normalized
      // result instead of reporting a false failure or replacing it again.
      if (current && isDeepStrictEqual(current.parsed, current.map) && isDeepStrictEqual(current.map, map)) return;
      throw new MapFileError(path, "changed");
    }
    renameSync(temporary, target);
  } catch (error) {
    if (error instanceof MapFileError) throw error;
    throw new MapFileError(path, "write");
  } finally {
    if (temporary) { try { rmSync(temporary, { force: true }); } catch { /* Never mask the original failure. */ } }
  }
}

export function writeMap(path: string, map: unknown): void { saveMap(path, migrateMapToCurrent(map), readMapFile(path)); }

export function ensureMap(path: string): ServiceTierMapFile {
  const before = readMapFile(path);
  if (before) {
    if (JSON.stringify(before.parsed) !== JSON.stringify(before.map)) saveMap(path, before.map, before);
    return before.map;
  }
  try { saveMap(path, { ...DEFAULT_MAP }, undefined); }
  catch (error) {
    // Another instance may have created a healthy map; don't call that a migration failure.
    if (!existsSync(path)) throw error;
    return ensureMap(path);
  }
  return { ...DEFAULT_MAP };
}

export function migrateMapFile(path: string): ServiceTierMapFile | undefined {
  return readMapFile(path) ? ensureMap(path) : undefined;
}
