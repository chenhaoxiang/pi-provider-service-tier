import test from "node:test";
import assert from "node:assert/strict";
import { SERVICE_TIERS } from "./service-tiers.ts";
import { markTierProbeResults, markTierSupported, markTierUnsupported } from "./support-map.ts";
import { TIER_PICKER_LEGEND, tierChoices } from "./tier-picker.ts";
import type { SupportScope } from "./auth-scope.ts";

const model: SupportScope = { provider: "openai", id: "fixture", api: "openai-responses", authMode: "api_key" };
const key = "openai/fixture";
const base = { payloadPrepared: true, updatedAt: "fixture" };
const fixture = () => markTierSupported(markTierProbeResults({ entries: {} }, key, {
  priority: { ...base, kind: "fallback", result: "unknown", requestCompleted: true, servedTier: "default" },
  flex: { ...base, kind: "verified", result: "supported", requestCompleted: true, servedTier: "flex" },
  default: { ...base, kind: "request-completed", result: "unknown", requestCompleted: true },
  auto: { ...base, kind: "rejected", result: "unsupported", requestCompleted: false },
}, model), key, "fast", model);

test("tier picker distinguishes verified, unverified, fallback, rejection and manual records", () => {
  assert.deepEqual(tierChoices(fixture(), model), [
    { value: "priority", label: "service_tier: ↪ priority — fallback→default (unverified)" },
    { value: "flex", label: "service_tier: ✓ flex — Probe-verified" },
    { value: "default", label: "service_tier: ? default — request completed; applied tier unknown" },
    { value: "auto", label: "service_tier: ✕ auto — rejected record" },
    { value: "scale", label: "service_tier: ? scale — unverified" },
    { value: "fast", label: "service_tier: ✎ fast — manual record (not Probe-verified)" },
    { value: "ultrafast", label: "service_tier: ? ultrafast — unverified" },
    { value: "off", label: "○ off — disable tier injection" },
    { value: "status", label: "ℹ status — show current settings" },
  ]);
});

test("tier picker keeps every tier and utility action selectable with stable raw values", () => {
  for (const map of [fixture(), undefined, null, {}, { version: 3, entries: {} }]) {
    const choices = tierChoices(map, model);
    assert.deepEqual(choices.map(({ value }) => value), [...SERVICE_TIERS, "off", "status"]);
    assert.equal(new Set(choices.map(({ label }) => label)).size, choices.length);
    assert.ok(choices.every(({ label }) => !label.includes("pi-provider-service-tier")));
  }
});

test("tier picker never borrows another model, API, provider or auth mode's facts", () => {
  for (const scope of [
    undefined,
    { ...model, id: "another" },
    { ...model, api: "openai-completions" },
    { ...model, provider: "openai-codex", api: "openai-codex-responses" },
    { ...model, authMode: "oauth" as const },
    { ...model, authMode: "unknown" as const },
    { ...model, authMode: undefined },
    { ...model, provider: "anthropic", api: "anthropic-messages" },
  ]) assert.ok(tierChoices(fixture(), scope).slice(0, SERVICE_TIERS.length).every(({ label }) => label.startsWith("service_tier: ? ")));
});

test("historical unclassified facts and invalid proof cannot become picker verification", () => {
  const historical = { version: 2, entries: { [key]: { ...model, determined: true, tiers: ["priority"], source: "probe" } } };
  assert.ok(tierChoices(historical, model)[0].label.startsWith("service_tier: ? "));
  const invalid = markTierProbeResults({}, key, {
    priority: { ...base, kind: "verified", result: "supported", requestCompleted: true, servedTier: "default" },
  }, model);
  assert.ok(tierChoices(invalid, model)[0].label.startsWith("service_tier: ? "));
});

test("latest completion or fallback is not displayed as verified despite retained positive history", () => {
  let map = markTierProbeResults({}, key, {
    priority: { ...base, kind: "verified", result: "supported", requestCompleted: true, servedTier: "priority" },
  }, model);
  map = markTierProbeResults(map, key, {
    priority: { ...base, kind: "fallback", result: "unknown", requestCompleted: true, servedTier: "default" },
  }, model);
  assert.equal(tierChoices(map, model)[0].label, "service_tier: ↪ priority — fallback→default (unverified)");
  map = markTierProbeResults(map, key, {
    priority: { ...base, kind: "request-completed", result: "unknown", requestCompleted: true },
  }, model);
  assert.ok(tierChoices(map, model)[0].label.startsWith("service_tier: ? "));
});

test("explicit rejection remains a caution and unsafe reported-tier text is not rendered", () => {
  let map = markTierUnsupported({}, key, "priority", undefined, model);
  map = markTierProbeResults(map, key, {
    priority: { ...base, kind: "fallback", result: "unknown", requestCompleted: true, servedTier: "default" },
  }, model);
  assert.equal(tierChoices(map, model)[0].label, "service_tier: ✕ priority — rejected record");
  const unsafe = markTierProbeResults({}, key, {
    priority: { ...base, kind: "fallback", result: "unknown", requestCompleted: true, servedTier: "\u001b[31msecret\n" },
  }, model);
  assert.equal(tierChoices(unsafe, model)[0].label, "service_tier: ↪ priority — fallback→unknown (unverified)");
});

test("tier picker is non-mutating and repeatable, and explains symbols, limits and costs", () => {
  const map = fixture(), original = structuredClone(map);
  const first = tierChoices(map, model);
  assert.deepEqual(tierChoices(map, model), first);
  assert.deepEqual(map, original);
  for (const symbol of ["✓", "?", "↪", "✕", "✎", "○", "ℹ"]) assert.ok(TIER_PICKER_LEGEND.includes(symbol));
  assert.match(TIER_PICKER_LEGEND, /All tiers remain selectable/);
  assert.match(TIER_PICKER_LEGEND, /do not guarantee/);
  assert.match(TIER_PICKER_LEGEND, /Opening\/cancelling does not probe/);
  assert.match(TIER_PICKER_LEGEND, /paid Auto Probe/);
});
