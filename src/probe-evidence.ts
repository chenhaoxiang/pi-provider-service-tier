import { SERVICE_TIERS, isRecord, isServiceTierModelSupported, sameRoute, type RouteIdentity, type ServiceTier } from "./service-tiers.ts";

export type ProbeTierResult = "supported" | "unsupported" | "unknown";
export type EvidenceKind = "manual" | "legacy" | "verified" | "request-completed" | "fallback" | "rejected";
export interface TierEvidence {
  kind: EvidenceKind;
  updatedAt: string;
  payloadPrepared?: boolean;
  requestCompleted?: boolean;
  servedTier?: string;
}
export interface ProbeTierObservation extends TierEvidence {
  result: ProbeTierResult;
}

// Candidates are request values, not a claim that this model/account accepts them.
const PROVIDER_CANDIDATES: Readonly<Record<string, readonly ServiceTier[]>> = {
  openai: SERVICE_TIERS,
  "openai-codex": SERVICE_TIERS,
  openrouter: ["priority", "flex", "default", "fast", "ultrafast"],
  xai: ["priority", "default"],
  groq: ["flex", "auto"],
};

export function probeCandidates(model: RouteIdentity): ServiceTier[] {
  return isServiceTierModelSupported(model) ? [...PROVIDER_CANDIDATES[model.provider]] : [];
}

function reportedTierValues(provider: string): readonly string[] {
  if (provider === "xai") return ["priority", "default"];
  if (provider === "openrouter") return ["priority", "fast", "default", "standard", "flex", "ultrafast"];
  if (provider === "groq") return ["on_demand", "performance", "flex"];
  return SERVICE_TIERS.filter((tier) => tier !== "auto");
}

export function tierMatchesServed(model: RouteIdentity, requested: ServiceTier, served: string): boolean {
  if (!reportedTierValues(model.provider).includes(served)) return false;
  if (requested === "auto") return model.provider === "openai" || model.provider === "openai-codex" ||
    model.provider === "groq" && ["flex", "on_demand"].includes(served);
  if (requested === served) return true;
  if ((model.provider === "openai" || model.provider === "openai-codex" || model.provider === "openrouter") &&
      ["priority", "fast"].includes(requested) && ["priority", "fast"].includes(served)) return true;
  return model.provider === "openrouter" && requested === "default" && served === "standard";
}

export function reportedServiceTier(model: RouteIdentity, data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  // Groq's public request enum is known, but a served-tier stream contract is
  // not established here. Never infer it from an OpenAI-compatible response.
  if (model.provider === "groq") return undefined;
  let value: unknown;
  if (model.api === "openai-responses" || model.api === "openai-codex-responses") {
    if (typeof data.type !== "string" || !["response.completed", "response.done", "response.incomplete"].includes(data.type) || !isRecord(data.response)) return undefined;
    if (data.response.status === "failed" || data.response.status === "cancelled") return undefined;
    value = data.response.service_tier;
  } else if (model.api === "openai-completions" && Array.isArray(data.choices)) {
    value = data.service_tier;
  } else if (model.provider === "openrouter" && model.api === "anthropic-messages") {
    if (data.type === "message_start" && isRecord(data.message) && isRecord(data.message.usage)) value = data.message.usage.service_tier;
    else if ((data.type === "message_delta" || data.type === "message") && isRecord(data.usage)) value = data.usage.service_tier;
  }
  return typeof value === "string" && reportedTierValues(model.provider).includes(value) ? value : undefined;
}

export function unknownProbe(): ProbeTierObservation {
  return { result: "unknown", kind: "legacy", payloadPrepared: false, requestCompleted: false, updatedAt: new Date().toISOString() };
}

export function createProbeEvidence(model: RouteIdentity, tier: ServiceTier) {
  let prepared = false;
  let invalid = false;
  let servedTier: string | undefined;
  let conflicting = false;
  return {
    prepare(payload: unknown, resolved: RouteIdentity): boolean {
      if (!sameRoute(model, resolved) || isRecord(payload) && Object.hasOwn(payload, "model") && payload.model !== resolved.id) invalid = true;
      prepared = !invalid && isRecord(payload) && payload.service_tier === tier;
      return prepared;
    },
    observe(data: unknown, resolved: RouteIdentity): void {
      if (!sameRoute(model, resolved)) { invalid = true; return; }
      const reported = reportedServiceTier(resolved, data);
      if (reported === undefined) return;
      if (servedTier !== undefined && servedTier !== reported &&
          !(tierMatchesServed(model, "priority", servedTier) && tierMatchesServed(model, "priority", reported))) conflicting = true;
      servedTier = reported;
    },
    finish(rejected = false): ProbeTierObservation {
      if (invalid || rejected && !prepared) return unknownProbe();
      const base = { payloadPrepared: prepared, requestCompleted: !rejected, updatedAt: new Date().toISOString() };
      if (!prepared) return { ...base, result: "unknown", kind: "request-completed" };
      if (rejected) return { ...base, result: "unsupported", kind: "rejected" };
      if (servedTier === undefined || conflicting) return { ...base, result: "unknown", kind: "request-completed" };
      if (tierMatchesServed(model, tier, servedTier)) return { ...base, servedTier, result: "supported", kind: "verified" };
      return { ...base, servedTier, result: "unknown", kind: "fallback" };
    },
  };
}
