import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { bootstrapMeanInterval, endpointOrigin, normalizedUsage, observerFailure, pairedSummary, practicalComparison, providerUsageFields, validateObservation } = await import(new URL("../scripts/benchmark-analysis.mjs", import.meta.url).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const observerUrl = new URL("../scripts/benchmark-observer.mjs", import.meta.url).href;
const canary = "PRIVATE_TEST_KEY_BODY_HEADER_AND_REASONING_98fa";

function observe(scenario: string) {
  const cwd = mkdtempSync(join(tmpdir(), "pst-observer-test-"));
  mkdirSync(join(cwd, ".pi"));
  const provider = scenario === "messages" ? "openrouter" : scenario === "groq" ? "groq" : scenario === "codex" ? "openai-codex" : "openai";
  const api = scenario === "messages" ? "anthropic-messages" : ["chat", "groq"].includes(scenario) ? "openai-completions" : scenario === "codex" ? "openai-codex-responses" : "openai-responses";
  writeFileSync(join(cwd, ".pi/benchmark-case.json"), JSON.stringify({ caseId: "00000000-0000-4000-8000-000000000000", phase: "measured", round: 1, modelKey: `${provider}/gpt-6.1-sol`, payloadTier: "priority" }));
  try {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
import assert from "node:assert/strict";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { registerBenchmarkObserver } = await import(${JSON.stringify(observerUrl)});
const scenario = ${JSON.stringify(scenario)};
const canary = ${JSON.stringify(canary)};
const hooks = new Map();
const cwd = ${JSON.stringify(cwd)};
const api = { on(name, handler) { const handlers = hooks.get(name) ?? []; handlers.push(handler); hooks.set(name, handlers); }, getThinkingLevel: () => "high" };
registerBenchmarkObserver(api, () => api.on("message_end", (event) => { if (event.message.errorMessage) writeFileSync(join(cwd, "support-map-written"), "unsafe"); }));
let forbiddenAuthCalls = 0;
const forbidden = () => { forbiddenAuthCalls++; throw new Error("Credential resolution forbidden"); };
const model = { provider: ${JSON.stringify(provider)}, id: "gpt-6.1-sol", api: ${JSON.stringify(api)}, baseUrl: "https://user:" + canary + "@api.openai.com/v1/responses?private=" + canary };
const ctx = { cwd, model, modelRegistry: {
  hasConfiguredAuth: () => true, getProviderAuthStatus: () => ({ configured: true, source: "environment" }), isUsingOAuth: () => false,
  getProviderAuth: forbidden, getApiKeyAndHeaders: forbidden, refresh: forbidden,
} };
const emit = async (name, event = {}) => {
  let result;
  for (const handler of hooks.get(name) ?? []) {
    const next = await handler({ type: name, ...event }, ctx);
    if (next !== undefined) result = next;
  }
  return result;
};
const payload = Object.freeze({ model: "gpt-6.1-sol", service_tier: scenario === "wrong-tier" ? "flex" : "priority", tools: Object.freeze([]), reasoning: Object.freeze({ effort: "medium" }), max_output_tokens: 4096, private: canary });
if (scenario === "before-start") await emit("before_provider_request", { payload });
if (scenario === "wrong-route") model.id = "different-model";
await emit("session_start");
assert.deepEqual(await emit("cache_warming_decision", { action: "warm" }), { action: "stop" });
const prepare = async () => {
  assert.equal(await emit("before_provider_request", { payload }), undefined);
  appendFileSync(join(cwd, "synthetic-sends"), "1\\n");
};
await prepare();
if (scenario === "duplicate") await prepare();
await emit("after_provider_response", { status: 200, headers: { authorization: canary } });
const raw = async (data) => emit("provider_stream_event", { provider: model.provider, api: model.api, model: model.id, data: Object.freeze(data) });
await raw({ type: "response.reasoning_text.delta", delta: canary });
if (scenario !== "no-text") {
  await raw(model.api === "openai-completions" ? { choices: [{ delta: { content: canary } }] } : model.api === "anthropic-messages" ? { type: "content_block_delta", delta: { type: "text_delta", text: canary } } : { type: "response.output_text.delta", delta: canary });
}
if (scenario === "conflicting" || scenario === "aliases") await raw({ type: "response.completed", response: { status: "completed", service_tier: "priority" } });
const rawUsage = scenario === "no-usage" ? undefined : { input_tokens: 250, output_tokens: 100, input_tokens_details: { cached_tokens: 50 }, output_tokens_details: { reasoning_tokens: 25 }, cache_creation_input_tokens: 0, total_tokens: 350 };
if (model.api === "openai-completions") await raw({ choices: [], service_tier: "default", usage: { prompt_tokens: 250, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 25 }, total_tokens: 350 } });
else if (model.api === "anthropic-messages") await raw({ type: "message_delta", usage: { service_tier: "default", ...rawUsage } });
else if (scenario !== "no-report") await raw({ type: scenario === "incomplete" ? "response.incomplete" : "response.completed", response: { status: scenario === "incomplete" ? "incomplete" : "completed", service_tier: scenario === "aliases" ? "fast" : "default", usage: rawUsage, private: canary } });
if (scenario === "changed-stream-route") await emit("provider_stream_event", { provider: model.provider, api: "anthropic-messages", model: model.id, data: {} });
const message = { role: "assistant", provider: model.provider, model: model.id, api: model.api, stopReason: scenario === "length" ? "length" : scenario === "rejected" ? "error" : "stop", errorMessage: scenario === "rejected" ? "Invalid service_tier: priority" : undefined, content: [{ type: "text", text: canary }], usage: { input: 200, cacheRead: 50, cacheWrite: 0, output: 100, reasoning: 25, totalTokens: 350, private: canary } };
await emit("message_end", { message });
await emit("agent_settled");
await emit("session_shutdown");
assert.equal(forbiddenAuthCalls, 0);
assert.equal(payload.private, canary);
assert.equal(existsSync(join(cwd, "auth.json")), false);
console.log("observer-complete");
`], { cwd: root, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    const path = join(cwd, ".pi/benchmark-observation.json");
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    const sendsPath = join(cwd, "synthetic-sends");
    return { ...result, text, supportMapWritten: existsSync(join(cwd, "support-map-written")), observation: text ? JSON.parse(text) : undefined, sends: existsSync(sendsPath) ? readFileSync(sendsPath, "utf8").trim().split("\n").length : 0 };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test("benchmark observer uses non-mutating public hooks, secret-free auth metadata and sanitized origins", () => {
  for (const scenario of ["responses", "chat", "messages", "codex", "groq"]) {
    const result = observe(scenario);
    assert.equal(result.status, 0, result.stderr);
    const value = result.observation;
    assert.equal(value.payloadPreparations, 1);
    assert.equal(value.responseCount, 1);
    assert.equal(value.assistantMessages, 1);
    assert.equal(value.route.authMode, "api_key");
    assert.equal(value.route.endpointOrigin, "https://api.openai.com");
    assert.equal(value.normalCompletion, true);
    assert.equal(value.selectedThinking, "high");
    assert.equal(value.payloadReasoningEffort, "medium");
    assert.equal(value.payloadMaxOutputTokens, 4096);
    assert.equal(value.reportedTier, scenario === "groq" ? null : "default");
    assert.ok(value.requestToFirstTextMs >= 0);
    assert.ok(value.requestToCompletionMs >= value.requestToFirstTextMs);
    assert.equal(value.usage.outputTokens, 100);
    assert.equal(value.usage.reasoningTokens, 25);
    assert.doesNotMatch(result.text + result.stdout + result.stderr, new RegExp(canary));
    assert.equal(result.sends, 1);
  }
});

test("observer guards stop a duplicate preparation before a second synthetic send and reject wrong routes/payloads", () => {
  for (const scenario of ["before-start", "wrong-route", "wrong-tier", "duplicate", "changed-stream-route"]) {
    const result = observe(scenario);
    assert.equal(result.status, 1, scenario);
    assert.equal(result.sends, ["duplicate", "changed-stream-route"].includes(scenario) ? 1 : 0);
    assert.doesNotMatch(result.text + result.stdout + result.stderr, new RegExp(canary));
    if (scenario === "duplicate") {
      assert.equal(result.observation.payloadPreparations, 2);
      assert.equal(result.observation.failure, "additional-provider-preparation-blocked");
    }
  }
});

test("incomplete terminal metadata or a length stop cannot be treated as a normal benchmark completion", () => {
  for (const scenario of ["incomplete", "length", "rejected"]) {
    const result = observe(scenario);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.observation.normalCompletion, false);
    assert.equal(result.supportMapWritten, false, "stop before the normal rejection handler can persist benchmark evidence");
    assert.equal(result.observation.failure, "assistant-did-not-complete-normally");
    assert.equal(result.sends, 1);
  }
});

test("observer preserves missing/conflicting metadata without inferring a first token from reasoning or completion", () => {
  for (const scenario of ["no-report", "conflicting", "aliases", "no-text", "no-usage"]) {
    const result = observe(scenario);
    assert.equal(result.status, 0, result.stderr);
    if (scenario === "no-report") assert.equal(result.observation.reportedTier, null);
    if (scenario === "conflicting") assert.equal(result.observation.conflictingTierReports, true);
    if (scenario === "aliases") assert.equal(result.observation.conflictingTierReports, false);
    if (scenario === "no-text") assert.equal(result.observation.requestToFirstTextMs, null);
    if (scenario === "no-usage") assert.ok(Object.values(result.observation.usage).every((value) => value === null), "SDK defaults must not invent reported zero usage");
  }
});

test("paired analysis describes wins, ties, sample dispersion, order and deterministic exploratory uncertainty", () => {
  const row = (round: number, mode: string, elapsedMs: number, order: number) => ({ round, mode, elapsedMs, order, firstStdoutMs: mode === "baseline" ? 70 : 40 });
  const rows = [row(1, "baseline", 100, 1), row(1, "priority", 70, 2), row(2, "priority", 120, 1), row(2, "baseline", 100, 2), row(3, "baseline", 100, 1), row(3, "priority", 100, 2)];
  const summary = pairedSummary(rows, "priority");
  assert.equal(summary.n, 3);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.ties, 1);
  assert.equal(summary.deltaMs.mean, 10 / 3);
  assert.equal(summary.deltaMs.median, 0);
  assert.ok(summary.sampleStddevMs > 25 && summary.sampleStddevMs < 26);
  assert.equal(summary.baselineFirst.n, 2);
  assert.equal(summary.tierFirst.n, 1);
  assert.equal(summary.smallSample, true);
  assert.deepEqual(summary.meanDeltaIntervalMs, bootstrapMeanInterval([30, -20, 0]));
  assert.ok(summary.meanDeltaIntervalMs.low <= 0 && summary.meanDeltaIntervalMs.high >= 0);
  assert.equal(summary.pairs[1].totalMs, -20);
  assert.equal(summary.pairs[1].firstStdoutMs, 30, "first-stdout improvement need not imply primary total-time improvement");
  assert.equal(summary.pairs[0].requestToFirstTextMs, null);
  assert.equal(practicalComparison(summary.pairs[1].totalMs, 100, 1, 1).crossed, false, "earlier stdout must not make a slower primary total-time result cross the threshold");
  assert.equal(practicalComparison(10, 100, 750, 5).crossed, true);
});

test("paired analysis rejects incomplete/duplicate cases and cannot invent uncertainty from one pair", () => {
  const baseline = { round: 1, mode: "baseline", elapsedMs: 100, order: 1 };
  const selected = { round: 1, mode: "priority", elapsedMs: 80, order: 2 };
  assert.throws(() => pairedSummary([baseline], "priority"), /exactly one/);
  assert.throws(() => pairedSummary([baseline, baseline, selected], "priority"), /exactly one/);
  assert.throws(() => pairedSummary([baseline, { ...selected, elapsedMs: Number.NaN }], "priority"), /exactly one/);
  assert.equal(pairedSummary([baseline, selected], "priority").meanDeltaIntervalMs, null);
  assert.equal(pairedSummary([baseline, selected], "priority").sampleStddevMs, null);
  assert.equal(bootstrapMeanInterval([]), null);
});

test("usage/origin normalization excludes invalid counters, cost estimates, credentials, paths and arbitrary fields", () => {
  assert.deepEqual(normalizedUsage({ input: 0, output: 100, cacheRead: -1, cacheWrite: 1.5, reasoning: Number.NaN, totalTokens: 100, cost: { total: 12 }, private: canary }), { inputTokens: 0, outputTokens: 100, cachedInputTokens: null, cacheWriteTokens: null, reasoningTokens: null, totalTokens: 100 });
  assert.equal(endpointOrigin(`https://user:${canary}@api.example.test/v1/account-private?key=${canary}`), "https://api.example.test");
  assert.equal(endpointOrigin("file:///private/path"), null);
  assert.deepEqual(providerUsageFields("openai-responses", { type: "response.completed", response: { usage: { output_tokens: 0 } } }), ["outputTokens"], "only explicitly reported counters are present, including legitimate zero");
  assert.deepEqual(providerUsageFields("openai-responses", { type: "response.output_text.delta", delta: canary, usage: { output_tokens: 10 } }), []);
  assert.throws(() => validateObservation({ private: canary }, { pid: 1 }), /incomplete or inconsistent/);
  const failed = { version: 1, caseId: "current", failure: "unexpected-request-payload" };
  assert.equal(observerFailure(failed, { caseId: "current" }), "unexpected-request-payload");
  assert.equal(observerFailure(failed, { caseId: "stale" }), undefined);
  assert.equal(observerFailure({ ...failed, failure: canary }, { caseId: "current" }), undefined);
});
