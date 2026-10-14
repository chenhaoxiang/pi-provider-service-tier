import type { Api, Model } from "@earendil-works/pi-ai";

export const SERVICE_TIERS = ["priority", "flex", "default", "auto", "scale", "fast", "ultrafast"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];
export type RouteIdentity = Pick<Model<Api>, "provider" | "id"> & Partial<Pick<Model<Api>, "api">>;

// Package eligibility is not evidence of account/model-specific support.
const SUPPORTED_PROVIDER_APIS: Readonly<Record<string, readonly string[]>> = {
  openai: ["openai-responses", "openai-completions"],
  "openai-codex": ["openai-codex-responses"],
  openrouter: ["openai-completions", "openai-responses", "anthropic-messages"],
  xai: ["openai-completions", "openai-responses"],
  groq: ["openai-completions"],
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isServiceTier(value: unknown): value is ServiceTier {
  return typeof value === "string" && (SERVICE_TIERS as readonly string[]).includes(value);
}

export function uniqueTiers(values: readonly ServiceTier[]): ServiceTier[] {
  return SERVICE_TIERS.filter((tier) => values.includes(tier));
}

export function isServiceTierProviderSupported(provider: string): boolean {
  return Object.hasOwn(SUPPORTED_PROVIDER_APIS, provider);
}

export function isServiceTierModelSupported(model: Pick<RouteIdentity, "provider" | "api"> | undefined): boolean {
  return !!model && isServiceTierProviderSupported(model.provider) && typeof model.api === "string" &&
    SUPPORTED_PROVIDER_APIS[model.provider].includes(model.api);
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

export function modelKey(model: Pick<RouteIdentity, "provider" | "id"> | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

export function sameRoute(a: RouteIdentity | undefined, b: RouteIdentity | undefined): boolean {
  return !!a && !!b && a.provider === b.provider && a.id === b.id && typeof a.api === "string" && a.api === b.api;
}
