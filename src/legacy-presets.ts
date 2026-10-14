import { isRecord, isServiceTier, type ServiceTier } from "./service-tiers.ts";

export interface PresetCleanupResult { value: unknown; removed: number }

const PRESET_FIELDS = new Set([
  "preset", "presets", "presettiers", "presetsupport", "presetevidence", "presetknowledge",
  "presetversion", "presetsource", "presetupdatedat", "presetapplied", "presetenabled", "copiedfrom",
]);
const SUPPORT_FIELDS = new Set([
  "provider", "id", "api", "source", "supported", "determined", "tiers", "unsupportedTiers",
  "evidence", "observations", "updatedAt", "error", "basis", "sources", "notes", "preservedFields", "previousEvidence",
]);

// Retirement-only cleanup. Never invent support, infer authentication, or remove
// a user's explicit active/serviceTier selection because support was preset-owned.
export function removeLegacyPresetData(value: unknown, kind: "settings" | "map"): PresetCleanupResult {
  let removed = 0;
  const clean = (input: unknown, trustedRoute = false): unknown => {
    if (Array.isArray(input)) return input.map((item) => clean(item)).filter((item) => item !== undefined);
    if (!isRecord(input)) return input;
    if (kind === "map" && input.source === "preset") {
      removed++;
      if (Object.hasOwn(input, "entries") || Object.hasOwn(input, "routes")) {
        // A tagged carrier can also contain independent manual/probe records.
        const carrier = { ...input };
        for (const field of ["source", "tiers", "unsupportedTiers", "determined", "supported", "basis", "sources", "notes"]) delete carrier[field];
        return clean(carrier);
      }
      if (!trustedRoute) return undefined;
      const evidence = isRecord(input.evidence) ? Object.fromEntries(Object.entries(input.evidence).filter(([tier, item]) =>
        isServiceTier(tier) && isRecord(item) && ["manual", "verified", "rejected"].includes(String(item.kind)))) : {};
      const observations = isRecord(input.observations) ? Object.fromEntries(Object.entries(input.observations).filter(([tier, item]) =>
        isServiceTier(tier) && isRecord(item) && ["verified", "rejected", "request-completed", "fallback"].includes(String(item.kind)))) : {};
      if (!Object.keys(evidence).length && !Object.keys(observations).length) return undefined;
      const tiers = Array.isArray(input.tiers) ? input.tiers.filter((tier): tier is ServiceTier =>
        isServiceTier(tier) && isRecord(evidence[tier]) && ["manual", "verified"].includes(String(evidence[tier].kind))) : [];
      const unsupportedTiers = Array.isArray(input.unsupportedTiers) ? input.unsupportedTiers.filter((tier): tier is ServiceTier =>
        isServiceTier(tier) && isRecord(evidence[tier]) && evidence[tier].kind === "rejected") : [];
      return clean({ provider: input.provider, id: input.id, api: input.api, determined: false, tiers,
        ...(unsupportedTiers.length ? { unsupportedTiers } : {}), evidence, observations,
        source: Object.keys(observations).length || Object.values(evidence).some((item) => isRecord(item) && item.kind !== "manual") ? "probe" : "manual",
        updatedAt: input.updatedAt }, true);
    }
    const result: Record<string, unknown> = {};
    const retiredTiers = new Set<string>();
    for (const [key, item] of Object.entries(input)) {
      if (PRESET_FIELDS.has(key.toLowerCase()) || kind === "settings" && input.source === "preset" && SUPPORT_FIELDS.has(key)) { removed++; continue; }
      if ((key === "evidence" || key === "observations") && isRecord(item)) {
        const retained: Record<string, unknown> = {};
        for (const [tier, proof] of Object.entries(item)) {
          if (isRecord(proof) && (proof.kind === "documented" || proof.source === "preset")) {
            removed++; retiredTiers.add(tier); continue;
          }
          const next = clean(proof);
          if (next !== undefined) Object.defineProperty(retained, tier, { value: next, enumerable: true, configurable: true, writable: true });
        }
        Object.defineProperty(result, key, { value: retained, enumerable: true, configurable: true, writable: true });
        continue;
      }
      const next = clean(item);
      if (next !== undefined) Object.defineProperty(result, key, { value: next, enumerable: true, configurable: true, writable: true });
    }
    if (retiredTiers.size) {
      const evidence = isRecord(result.evidence) ? result.evidence : {};
      if (Array.isArray(result.tiers)) result.tiers = result.tiers.filter((tier) => {
        const proof = evidence[String(tier)];
        return !retiredTiers.has(String(tier)) || isRecord(proof) && ["manual", "verified"].includes(String(proof.kind));
      });
      if (Array.isArray(result.unsupportedTiers)) result.unsupportedTiers = result.unsupportedTiers.filter((tier) => {
        const proof = evidence[String(tier)];
        return !retiredTiers.has(String(tier)) || isRecord(proof) && proof.kind === "rejected";
      });
    }
    // Drop emptied legacy wrappers rather than leaving a phantom preset record.
    if (kind === "map" && Object.hasOwn(input, "record") && result.record === undefined) return undefined;
    return result;
  };

  if (kind !== "map" || !isRecord(value) || !isRecord(value.entries)) return { value: clean(value), removed };
  const result = (clean({ ...value, entries: undefined }) ?? { version: value.version }) as Record<string, unknown>;
  const entries: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value.entries)) {
    let next: unknown;
    if (isRecord(entry) && isRecord(entry.routes)) {
      const container = (clean({ ...entry, routes: undefined }) ?? {}) as Record<string, unknown>;
      const routes: Record<string, unknown> = {};
      for (const [api, route] of Object.entries(entry.routes)) {
        const cleaned = clean(route, true);
        if (cleaned !== undefined) Object.defineProperty(routes, api, { value: cleaned, enumerable: true, configurable: true, writable: true });
      }
      container.routes = routes;
      const hasHistory = Array.isArray(container.legacy) && container.legacy.length > 0;
      const hasExtra = Object.keys(container).some((field) => field !== "routes" && field !== "legacy");
      next = Object.keys(routes).length || hasHistory || hasExtra ? container : undefined;
    } else next = clean(entry);
    if (next !== undefined) Object.defineProperty(entries, key, { value: next, enumerable: true, configurable: true, writable: true });
  }
  result.entries = entries;
  return { value: result, removed };
}
