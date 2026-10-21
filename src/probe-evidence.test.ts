import test from "node:test";
import assert from "node:assert/strict";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import { _test } from "./index.ts";
import { createProbeEvidence, probeCandidates, reportedServiceTier, tierMatchesServed } from "./probe-evidence.ts";
import type { RouteIdentity } from "./service-tiers.ts";

const responses: RouteIdentity = { provider: "openai", id: "gpt-5.5", api: "openai-responses" };
const completions: RouteIdentity = { ...responses, api: "openai-completions" };
const routerMessages: RouteIdentity = { provider: "openrouter", id: "anthropic/example", api: "anthropic-messages" };

function registry(stream: (options: SimpleStreamOptions) => AsyncIterable<unknown>) {
  return { modelRegistry: { hasConfiguredAuth: () => true, isUsingOAuth: () => false, getProviderAuthStatus: () => ({ configured: true, source: "stored" }), streamSimple: (_model: unknown, _context: unknown, options: SimpleStreamOptions) => stream(options) } } as never;
}

test("probe candidates are provider/API-scoped, defensive, and do not imply support", () => {
  assert.deepEqual(probeCandidates(responses), ["priority", "flex", "default", "auto", "scale", "fast", "ultrafast"]);
  assert.deepEqual(probeCandidates({ ...completions, provider: "groq" }), ["flex", "auto"]);
  assert.deepEqual(probeCandidates({ ...responses, provider: "xai" }), ["priority", "default"]);
  assert.deepEqual(probeCandidates(routerMessages), ["priority", "flex", "default", "fast", "ultrafast"]);
  assert.deepEqual(probeCandidates({ ...responses, provider: "anthropic", api: "anthropic-messages" }), []);
  const copy = probeCandidates(responses); copy.length = 0;
  assert.equal(probeCandidates(responses).length, 7);
});

test("reported tier parsing uses API-specific response locations, not request echoes", () => {
  for (const type of ["response.completed", "response.done", "response.incomplete"]) {
    const event = { type, response: { service_tier: "priority" } };
    const copy = structuredClone(event);
    assert.equal(reportedServiceTier(responses, event), "priority");
    assert.deepEqual(event, copy);
  }
  assert.equal(reportedServiceTier(responses, { type: "response.created", response: { service_tier: "priority" } }), undefined);
  assert.equal(reportedServiceTier(responses, { type: "response.completed", response: { status: "failed", service_tier: "priority" } }), undefined);
  assert.equal(reportedServiceTier(responses, { choices: [], service_tier: "priority" }), undefined);
  assert.equal(reportedServiceTier(completions, { choices: [], service_tier: "priority" }), "priority");
  assert.equal(reportedServiceTier(completions, { service_tier: "priority", messages: [] }), undefined);
  assert.equal(reportedServiceTier(completions, { choices: [], service_tier: "auto" }), undefined);
  assert.equal(reportedServiceTier(completions, { choices: [], service_tier: null }), undefined);
  assert.equal(reportedServiceTier(completions, { choices: [], service_tier: "unrecognized" }), undefined);
});

test("OpenRouter Messages uses usage.service_tier and provider-specific standard/priority semantics", () => {
  const start = { type: "message_start", message: { usage: { service_tier: "priority" } } };
  assert.equal(reportedServiceTier(routerMessages, start), "priority");
  assert.equal(reportedServiceTier(routerMessages, { type: "message_delta", usage: { service_tier: "standard" } }), "standard");
  assert.equal(reportedServiceTier(routerMessages, { type: "message_delta", service_tier: "priority" }), undefined);
  assert.equal(reportedServiceTier(routerMessages, { type: "message_start", message: { usage: { speed: "fast" } } }), undefined);
  assert.equal(tierMatchesServed(routerMessages, "default", "standard"), true);
  const evidence = createProbeEvidence(routerMessages, "fast");
  evidence.prepare({ service_tier: "fast" }, routerMessages);
  evidence.observe(start, routerMessages);
  assert.equal(evidence.finish().kind, "verified");
});

test("aliases and auto selection are interpreted per provider, not compared as literal strings", () => {
  assert.equal(tierMatchesServed(responses, "fast", "priority"), true);
  assert.equal(tierMatchesServed(responses, "priority", "fast"), true);
  assert.equal(tierMatchesServed(responses, "auto", "default"), true);
  assert.equal(tierMatchesServed(responses, "auto", "auto"), false);
  assert.equal(tierMatchesServed(responses, "priority", "default"), false);
  assert.equal(tierMatchesServed({ ...responses, provider: "xai" }, "fast", "priority"), false);
  assert.equal(tierMatchesServed({ ...completions, provider: "groq" }, "auto", "on_demand"), true);
  assert.equal(tierMatchesServed({ ...completions, provider: "groq" }, "auto", "performance"), false);
  assert.equal(reportedServiceTier({ ...completions, provider: "groq" }, { choices: [], service_tier: "flex" }), undefined);
});

test("done without the payload hook is unknown even when a raw event claims the selected tier", async () => {
  const ctx = registry(async function* (options) {
    await options.onProviderStreamEvent?.({ type: "response.completed", response: { service_tier: "priority" } }, responses as never);
    yield { type: "done" };
  });
  const result = await _test.defaultProbeTier(responses as never, "priority", ctx);
  assert.equal(result.result, "unknown");
  assert.equal(result.payloadPrepared, false);
  assert.equal(result.requestCompleted, true);
  assert.equal(result.kind, "request-completed");
});

test("hook plus done without reported tier records completion, not support", async () => {
  let payload: unknown;
  const original = { model: "gpt-5.5", service_tier: "default" };
  const ctx = registry(async function* (options) {
    assert.equal(options.maxRetries, 0);
    payload = await options.onPayload?.(original, responses as never);
    yield { type: "done" };
  });
  const result = await _test.defaultProbeTier(responses as never, "priority", ctx);
  assert.equal(result.result, "unknown");
  assert.equal(result.kind, "request-completed");
  assert.equal(result.requestCompleted, true);
  assert.equal(result.servedTier, undefined);
  assert.deepEqual(payload, { model: "gpt-5.5", service_tier: "priority" });
  assert.deepEqual(original, { model: "gpt-5.5", service_tier: "default" });
});

test("properly prepared completed requests separate verified delivery and fallback", async () => {
  for (const [servedTier, kind, result] of [["priority", "verified", "supported"], ["default", "fallback", "unknown"]] as const) {
    const ctx = registry(async function* (options) {
      await options.onPayload?.({}, responses as never);
      await options.onProviderStreamEvent?.({ type: "response.completed", response: { service_tier: servedTier } }, responses as never);
      yield { type: "done" };
    });
    const observation = await _test.defaultProbeTier(responses as never, "priority", ctx);
    assert.equal(observation.result, result);
    assert.equal(observation.kind, kind);
    assert.equal(observation.servedTier, servedTier);
  }
});

test("raw server metadata without terminal SDK success cannot become verification", async () => {
  const ctx = registry(async function* (options) {
    await options.onPayload?.({}, responses as never);
    await options.onProviderStreamEvent?.({ type: "response.completed", response: { service_tier: "priority" } }, responses as never);
  });
  const observation = await _test.defaultProbeTier(responses as never, "priority", ctx);
  assert.equal(observation.result, "unknown");
  assert.equal(observation.requestCompleted, false);
});

test("conflicting reports and changed provider/model/API cannot create positive proof", () => {
  const conflicting = createProbeEvidence(responses, "priority");
  conflicting.prepare({ service_tier: "priority" }, responses);
  conflicting.observe({ type: "response.completed", response: { service_tier: "priority" } }, responses);
  conflicting.observe({ type: "response.completed", response: { service_tier: "default" } }, responses);
  assert.equal(conflicting.finish().kind, "request-completed");
  for (const different of [completions, { ...responses, id: "other" }, { ...responses, provider: "xai" }]) {
    const evidence = createProbeEvidence(responses, "priority");
    assert.equal(evidence.prepare({ service_tier: "priority" }, different), false);
    assert.equal(evidence.finish().result, "unknown");
    const late = createProbeEvidence(responses, "priority");
    late.prepare({ service_tier: "priority" }, responses);
    late.observe({ type: "response.completed", response: { service_tier: "priority" } }, different);
    assert.equal(late.finish().result, "unknown");
  }
});

test("a payload prepared for a different model cannot verify the selected model", () => {
  const evidence = createProbeEvidence(responses, "priority");
  assert.equal(evidence.prepare({ model: "another-model", service_tier: "priority" }, responses), false);
  assert.equal(evidence.finish().result, "unknown");
});

test("an SDK hook resolved to another allowed route aborts before sending", async () => {
  let sent = false;
  let signal: AbortSignal | undefined;
  const ctx = registry(async function* (options) {
    signal = options.signal;
    await options.onPayload?.({}, completions as never);
    sent = true;
    yield { type: "done" };
  });
  assert.equal((await _test.defaultProbeTier(responses as never, "priority", ctx)).result, "unknown");
  assert.equal(sent, false);
  assert.equal(signal?.aborted, true);
});

test("a candidate rejection is trusted only after its payload was prepared; auth and limits remain unknown", async () => {
  for (const prepared of [false, true]) {
    const ctx = registry(async function* (options) {
      if (prepared) await options.onPayload?.({}, responses as never);
      yield { type: "error", error: { errorMessage: "Invalid service_tier: priority" } };
    });
    assert.equal((await _test.defaultProbeTier(responses as never, "priority", ctx)).result, prepared ? "unsupported" : "unknown");
  }
  for (const errorMessage of ["Unauthorized", "Rate limit exceeded", "flex temporarily unavailable"]) {
    const ctx = registry(async function* (options) {
      await options.onPayload?.({}, responses as never);
      yield { type: "error", error: { errorMessage } };
    });
    assert.equal((await _test.defaultProbeTier(responses as never, "priority", ctx)).result, "unknown");
  }
});
