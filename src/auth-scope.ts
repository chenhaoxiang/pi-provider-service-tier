import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sameRoute, type RouteIdentity } from "./service-tiers.ts";

export type AuthMode = "oauth" | "api_key" | "unknown";
export type KnownAuthMode = Exclude<AuthMode, "unknown">;
export type SupportScope = RouteIdentity & { authMode?: AuthMode };

export function isAuthMode(value: unknown): value is AuthMode {
  return value === "oauth" || value === "api_key" || value === "unknown";
}
export function isKnownAuthMode(value: unknown): value is KnownAuthMode {
  return value === "oauth" || value === "api_key";
}

// Read only Pi's synchronous, non-secret auth metadata. No key resolution,
// token inspection, refresh, network, or independent auth.json reads.
export function currentAuthMode(registry: ExtensionContext["modelRegistry"], model: Model<Api>): AuthMode {
  try {
    if (registry.hasConfiguredAuth(model) !== true) return "unknown";
    const status = registry.getProviderAuthStatus(model.provider);
    if (status.configured !== true) return "unknown";
    const usingOAuth = registry.isUsingOAuth(model);
    if (usingOAuth === true) return "oauth";
    if (usingOAuth !== false) return "unknown";
    // A false OAuth flag alone is not evidence of a configured API credential.
    return ["stored", "runtime", "environment", "models_json_key", "models_json_command"].includes(status.source ?? "") ? "api_key" : "unknown";
  } catch { return "unknown"; }
}

export function currentSupportScope(ctx: Pick<ExtensionContext, "model" | "modelRegistry">, model = ctx.model): SupportScope | undefined {
  return model ? { provider: model.provider, id: model.id, api: model.api, authMode: currentAuthMode(ctx.modelRegistry, model) } : undefined;
}

export function sameSupportScope(a: SupportScope | undefined, b: SupportScope | undefined): boolean {
  return sameRoute(a, b) && isKnownAuthMode(a?.authMode) && a.authMode === b?.authMode;
}
