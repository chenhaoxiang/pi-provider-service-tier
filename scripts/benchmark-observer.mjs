// Explicit benchmark-only extension. Importing this file does not start work.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import serviceTierExtension from "../src/index.ts";
import { currentAuthMode } from "../src/auth-scope.ts";
import { isRecord, isServiceTier, isServiceTierModelSupported, modelKey, sameRoute } from "../src/service-tiers.ts";
import { reportedServiceTier, tierMatchesServed } from "../src/probe-evidence.ts";
import { CASE_FILE, OBSERVATION_FILE, OBSERVATION_VERSION, endpointOrigin, normalizedUsage, observedThinking, providerUsageFields } from "./benchmark-analysis.mjs";

export function registerBenchmarkObserver(pi, registerExtension = () => {}) {
  let state;
  let expected;
  let outputPath;
  let requestStart;
  const usageFields = new Set();
  const elapsed = () => requestStart === undefined ? null : Number(process.hrtime.bigint() - requestStart) / 1_000_000;
  const persist = () => writeFileSync(outputPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  const fail = (reason) => {
    if (state) {
      state.failure = reason;
      try { persist(); } catch { /* Never continue to a paid request after an observer I/O error. */ }
    }
    process.stderr.write(`[pi-provider-service-tier] Benchmark stopped: ${reason}.\n`);
    // Pi reports and swallows provider-hook exceptions. A throw alone cannot
    // enforce this one-shot child process's preparation limit; exit before send.
    process.exit(1);
  };
  const guarded = (handler) => (...args) => {
    try { return handler(...args); } catch { fail("observer-io-or-event-error"); }
  };
  const checkRoute = (model) => {
    if (!model || !isServiceTierModelSupported(model) || modelKey(model) !== expected.modelKey ||
        state.route && !sameRoute(state.route, model)) fail("route-changed-or-ineligible");
  };

  // Finish/abort before the normal extension's error handler can save a
  // benchmark rejection to the user's support map. Do not change that handler.
  pi.on("message_end", guarded((event) => {
    if (event.message.role !== "assistant") return;
    if (!state || state.payloadPreparations !== 1 || ++state.assistantMessages !== 1) fail("unexpected-assistant-message");
    checkRoute({ provider: event.message.provider, id: event.message.model, api: event.message.api });
    state.requestToCompletionMs = elapsed();
    state.normalCompletion = event.message.stopReason === "stop" && !event.message.errorMessage && !state.incompleteResponse;
    state.usage = Object.fromEntries(Object.entries(normalizedUsage(event.message.usage)).map(([key, value]) => [key, usageFields.has(key) ? value : null]));
    persist();
    if (!state.normalCompletion) fail("assistant-did-not-complete-normally");
  }));
  registerExtension();
  // Request observation is registered after the extension's payload hook.
  pi.on("session_start", guarded((_event, ctx) => {
    outputPath = join(ctx.cwd, OBSERVATION_FILE);
    expected = JSON.parse(readFileSync(join(ctx.cwd, CASE_FILE), "utf8"));
    if (!isRecord(expected) || typeof expected.caseId !== "string" || !/^[0-9a-f-]{36}$/.test(expected.caseId) || !["warmup", "measured"].includes(expected.phase) ||
        !Number.isSafeInteger(expected.round) || expected.round < 1 || typeof expected.modelKey !== "string" ||
        expected.payloadTier !== null && !isServiceTier(expected.payloadTier)) fail("invalid-case-contract");
    state = {
      version: OBSERVATION_VERSION, caseId: expected.caseId, pid: process.pid, phase: expected.phase, round: expected.round,
      piVersion: PI_VERSION, nodeVersion: process.version,
      failure: null, payloadPreparations: 0, responseCount: 0, assistantMessages: 0,
      route: null, payloadTier: null, selectedThinking: null, payloadReasoningEffort: null, payloadMaxOutputTokens: null, httpStatus: null, normalCompletion: false,
      reportedTier: null, conflictingTierReports: false, incompleteResponse: false,
      requestToFirstTextMs: null, requestToCompletionMs: null,
      usage: normalizedUsage(undefined),
    };
    checkRoute(ctx.model);
    persist();
  }));
  pi.on("cache_warming_decision", () => ({ action: "stop" }));
  pi.on("before_provider_request", guarded((event, ctx) => {
    if (!state) fail("observer-not-initialized");
    if (++state.payloadPreparations !== 1) fail("additional-provider-preparation-blocked");
    checkRoute(ctx.model);
    const payload = event.payload;
    if (!isRecord(payload) || Object.hasOwn(payload, "model") && payload.model !== ctx.model.id ||
        (payload.service_tier ?? null) !== expected.payloadTier ||
        payload.service_tier === null || payload.tools !== undefined && (!Array.isArray(payload.tools) || payload.tools.length > 0)) fail("unexpected-request-payload");
    requestStart = process.hrtime.bigint();
    state.route = {
      provider: ctx.model.provider, id: ctx.model.id, api: ctx.model.api,
      authMode: currentAuthMode(ctx.modelRegistry, ctx.model), endpointOrigin: endpointOrigin(ctx.model.baseUrl),
    };
    state.payloadTier = payload.service_tier ?? null;
    state.selectedThinking = observedThinking(pi.getThinkingLevel?.());
    state.payloadReasoningEffort = observedThinking(payload.reasoning?.effort ?? payload.reasoning_effort);
    const maxOutput = payload.max_output_tokens ?? payload.max_completion_tokens ?? payload.max_tokens;
    state.payloadMaxOutputTokens = Number.isSafeInteger(maxOutput) && maxOutput >= 0 ? maxOutput : null;
    persist();
    // Observation only: return no replacement and do not mutate the payload.
  }));
  pi.on("after_provider_response", guarded((event) => {
    if (!state || state.payloadPreparations !== 1) fail("response-without-preparation");
    if (++state.responseCount !== 1) fail("additional-provider-response-observed");
    state.httpStatus = event.status;
    // Do not inspect or persist response headers.
  }));
  pi.on("provider_stream_event", guarded((event) => {
    if (!state?.route) fail("stream-without-preparation");
    checkRoute({ provider: event.provider, id: event.model, api: event.api });
    const data = event.data;
    if (!isRecord(data)) return;
    for (const field of providerUsageFields(state.route.api, data)) usageFields.add(field);
    if (["response.incomplete", "response.failed"].includes(data.type) ||
        ["response.completed", "response.done"].includes(data.type) && data.response?.status !== undefined && data.response.status !== "completed") state.incompleteResponse = true;
    const tier = reportedServiceTier(state.route, data);
    if (tier !== undefined) {
      if (state.reportedTier !== null && state.reportedTier !== tier &&
          !(tierMatchesServed(state.route, "priority", state.reportedTier) && tierMatchesServed(state.route, "priority", tier))) state.conflictingTierReports = true;
      state.reportedTier = tier;
    }
    const firstText = state.route.api === "openai-responses" || state.route.api === "openai-codex-responses"
      ? data.type === "response.output_text.delta" && typeof data.delta === "string" && data.delta.length > 0
      : state.route.api === "openai-completions"
        ? Array.isArray(data.choices) && data.choices.some((choice) => typeof choice?.delta?.content === "string" && choice.delta.content.length > 0)
        : data.type === "content_block_delta" && data.delta?.type === "text_delta" && typeof data.delta.text === "string" && data.delta.text.length > 0;
    if (firstText && state.requestToFirstTextMs === null) state.requestToFirstTextMs = elapsed();
    // No raw events, text, hidden reasoning or response bodies are retained.
  }));
  pi.on("agent_settled", guarded(() => {
    if (!state?.normalCompletion) fail("agent-settled-without-completion");
    persist();
  }));
  pi.on("session_shutdown", guarded(() => { if (state) persist(); }));
}

export default function benchmarkExtension(pi) {
  try {
    // No other extensions are loaded by the benchmark CLI.
    registerBenchmarkObserver(pi, () => serviceTierExtension(pi));
  } catch {
    process.stderr.write("[pi-provider-service-tier] Benchmark extension initialization failed.\n");
    process.exit(1);
  }
}
