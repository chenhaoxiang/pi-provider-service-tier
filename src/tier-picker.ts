import { SERVICE_TIERS, modelKey, type ServiceTier } from "./service-tiers.ts";
import { mapSupportState, routeEntry, tierRejected } from "./support-map.ts";
import type { SupportScope } from "./auth-scope.ts";

export interface TierChoice {
  value: ServiceTier | "off" | "status";
  label: string;
}

export const TIER_PICKER_LEGEND = [
  "✓ Probe-verified | ? Unverified | ↪ Fallback (different reported tier)",
  "✕ Rejected record | ✎ Manual record (not Probe-verified)",
  "○ off | ℹ status. All tiers remain selectable.",
  "Saved results do not guarantee future delivery or billing.",
  "Opening/cancelling does not probe. Selecting a tier may start paid Auto Probe under your policy.",
].join("\n");

// Display existing exact-scope evidence only; never seed facts or probe here.
export function tierChoices(map: unknown, model: SupportScope | undefined): TierChoice[] {
  const key = modelKey(model);
  const entry = routeEntry(map, model);
  const choices: TierChoice[] = SERVICE_TIERS.map((tier) => {
    let detail = `? ${tier} — unverified`;
    if (tierRejected(entry, tier)) {
      detail = `✕ ${tier} — rejected record`;
    } else {
      const support = mapSupportState(map, key, tier, model);
      if (support === "verified") detail = `✓ ${tier} — Probe-verified`;
      else if (support === "manual") detail = `✎ ${tier} — manual record (not Probe-verified)`;
      else if (support === "request-completed") detail = `? ${tier} — request completed; applied tier unknown`;
      else if (support === "fallback") {
        const reported = entry?.observations?.[tier]?.servedTier;
        const served = reported && /^[a-z][a-z0-9_-]{0,31}$/i.test(reported) ? reported : "unknown";
        detail = `↪ ${tier} — fallback→${served} (unverified)`;
      }
    }
    return { value: tier, label: detail };
  });
  return [...choices, { value: "off", label: "○ off — disable tier injection" }, { value: "status", label: "ℹ status — show current settings" }];
}
