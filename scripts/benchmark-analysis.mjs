// Pure benchmark protocol validation and descriptive paired analysis. No I/O.
export const CASE_FILE = ".pi/benchmark-case.json";
export const OBSERVATION_FILE = ".pi/benchmark-observation.json";
export const OBSERVATION_VERSION = 1;
export const FIXED_OUTPUT = `${Array.from({ length: 1_000 }, (_, index) => index + 1).join("\n")}\nBENCHMARK_COMPLETE`;
const REPORTED_TIERS = new Set(["priority", "fast", "ultrafast", "default", "flex", "scale", "standard", "on_demand", "performance"]);
const APIS = new Set(["openai-responses", "openai-codex-responses", "openai-completions", "anthropic-messages"]);
const THINKING_LEVELS = new Set(["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const observedThinking = (value) => THINKING_LEVELS.has(value) ? value : null;
const USAGE_KEYS = ["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteTokens", "reasoningTokens", "totalTokens"];
const FAILURES = new Set(["observer-io-or-event-error", "route-changed-or-ineligible", "invalid-case-contract", "observer-not-initialized", "additional-provider-preparation-blocked", "unexpected-request-payload", "response-without-preparation", "additional-provider-response-observed", "stream-without-preparation", "unexpected-assistant-message", "assistant-did-not-complete-normally", "agent-settled-without-completion"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const counter = (value) => Number.isSafeInteger(value) && value >= 0;
const duration = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function endpointOrigin(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch { return null; }
}

export function normalizedUsage(usage) {
  const fields = { inputTokens: "input", outputTokens: "output", cachedInputTokens: "cacheRead", cacheWriteTokens: "cacheWrite", reasoningTokens: "reasoning", totalTokens: "totalTokens" };
  return Object.fromEntries(Object.entries(fields).map(([key, source]) => [key, counter(usage?.[source]) ? usage[source] : null]));
}

// A finalized SDK message may contain initialized zeros even when the provider
// omitted usage. Track presence in provider metadata before using SDK counters.
export function providerUsageFields(api, data) {
  if (!record(data)) return [];
  const usage = ["openai-responses", "openai-codex-responses"].includes(api)
    ? ["response.completed", "response.done", "response.incomplete"].includes(data.type) ? data.response?.usage : undefined
    : api === "openai-completions" ? Array.isArray(data.choices) ? data.usage : undefined
    : api === "anthropic-messages" ? data.type === "message_start" ? data.message?.usage : ["message_delta", "message"].includes(data.type) ? data.usage : undefined : undefined;
  if (!record(usage)) return [];
  const fields = {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens,
    outputTokens: usage.output_tokens ?? usage.completion_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens,
    totalTokens: usage.total_tokens,
  };
  return Object.keys(fields).filter((key) => counter(fields[key]));
}

export function observerFailure(value, expected) {
  return record(value) && value.version === OBSERVATION_VERSION && value.caseId === expected.caseId && FAILURES.has(value.failure) ? value.failure : undefined;
}

export function validateObservation(value, expected) {
  const invalid = () => { throw new Error("Missing, incomplete or inconsistent benchmark observation; no further cases were started."); };
  if (!record(value) || value.version !== OBSERVATION_VERSION || !counter(value.pid) || value.pid === 0 || typeof value.caseId !== "string" || value.caseId !== expected.caseId ||
      value.phase !== expected.phase || value.round !== expected.round || value.failure !== null ||
      typeof value.piVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.piVersion) ||
      typeof value.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.nodeVersion) ||
      value.payloadPreparations !== 1 || value.responseCount !== 1 || value.assistantMessages !== 1 || value.normalCompletion !== true || value.incompleteResponse !== false ||
      value.payloadTier !== expected.payloadTier ||
      value.selectedThinking !== null && !THINKING_LEVELS.has(value.selectedThinking) ||
      value.payloadReasoningEffort !== null && !THINKING_LEVELS.has(value.payloadReasoningEffort) ||
      value.payloadMaxOutputTokens !== null && !counter(value.payloadMaxOutputTokens) || !record(value.route) ||
      `${value.route.provider}/${value.route.id}` !== expected.modelKey || !APIS.has(value.route.api) ||
      !["oauth", "api_key", "unknown"].includes(value.route.authMode) ||
      !Number.isInteger(value.httpStatus) || value.httpStatus < 200 || value.httpStatus >= 300 ||
      !duration(value.requestToCompletionMs) ||
      value.requestToFirstTextMs !== null && (!duration(value.requestToFirstTextMs) || value.requestToFirstTextMs > value.requestToCompletionMs) ||
      value.reportedTier !== null && !REPORTED_TIERS.has(value.reportedTier) ||
      typeof value.conflictingTierReports !== "boolean" || !record(value.usage) ||
      USAGE_KEYS.some((key) => value.usage[key] !== null && !counter(value.usage[key]))) invalid();
  // Whitelist fields: never echo a raw sidecar, headers, prompts or provider output.
  return {
    version: OBSERVATION_VERSION,
    caseId: value.caseId,
    piVersion: value.piVersion,
    nodeVersion: value.nodeVersion,
    payloadPreparations: 1,
    responseCount: 1,
    assistantMessages: 1,
    route: { provider: value.route.provider, id: value.route.id, api: value.route.api, authMode: value.route.authMode, endpointOrigin: endpointOrigin(value.route.endpointOrigin) },
    payloadTier: value.payloadTier,
    selectedThinking: value.selectedThinking,
    payloadReasoningEffort: value.payloadReasoningEffort,
    payloadMaxOutputTokens: value.payloadMaxOutputTokens,
    httpStatus: value.httpStatus,
    normalCompletion: true,
    incompleteResponse: false,
    reportedTier: value.reportedTier,
    conflictingTierReports: value.conflictingTierReports,
    requestToFirstTextMs: value.requestToFirstTextMs,
    requestToCompletionMs: value.requestToCompletionMs,
    usage: Object.fromEntries(USAGE_KEYS.map((key) => [key, value.usage[key]])),
    usageSource: "sdk-normalized-with-provider-presence",
    wireDelivery: "not-independently-observed",
  };
}

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
}
export function median(values) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function percentile(values, pct) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(Math.max(Math.ceil(pct / 100 * sorted.length) - 1, 0), sorted.length - 1)];
}
export function stats(values) {
  const average = mean(values);
  return {
    n: values.length, median: median(values), mean: mean(values),
    min: values.length ? Math.min(...values) : Number.NaN,
    max: values.length ? Math.max(...values) : Number.NaN,
    p90: percentile(values, 90),
    stddev: values.length < 2 ? 0 : Math.sqrt(mean(values.map((value) => (value - average) ** 2))),
  };
}

// Deterministic percentile bootstrap of paired mean differences. Exploratory,
// assuming representative independent pairs; it cannot measure systematic bias.
export function bootstrapMeanInterval(values) {
  if (values.length < 2) return null;
  let seed = 0x505354;
  const samples = [];
  for (let trial = 0; trial < 2_000; trial++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      sum += values[Math.floor(seed / 0x100000000 * values.length)];
    }
    samples.push(sum / values.length);
  }
  return { low: percentile(samples, 2.5), high: percentile(samples, 97.5), level: 0.95, resamples: 2_000, method: "exploratory-paired-percentile-bootstrap" };
}

export function practicalComparison(deltaMs, baselineMeanMs, thresholdMs, thresholdPct) {
  const fasterPct = baselineMeanMs > 0 ? deltaMs / baselineMeanMs * 100 : Number.NaN;
  return { deltaMs, fasterPct, crossed: deltaMs > 0 && (deltaMs >= thresholdMs || fasterPct >= thresholdPct) };
}

export function pairedSummary(results, tier) {
  const rounds = [...new Set(results.map((row) => row.round))].sort((a, b) => a - b);
  const pairs = rounds.map((round) => {
    const baseline = results.filter((row) => row.round === round && row.mode === "baseline");
    const selected = results.filter((row) => row.round === round && row.mode === tier);
    if (baseline.length !== 1 || selected.length !== 1 || !duration(baseline[0].elapsedMs) || !duration(selected[0].elapsedMs)) {
      throw new Error("Paired analysis requires exactly one valid case per condition and round.");
    }
    const b = baseline[0], t = selected[0];
    const difference = (left, right) => duration(left) && duration(right) ? left - right : null;
    return {
      round, baselineFirst: b.order < t.order,
      totalMs: b.elapsedMs - t.elapsedMs,
      totalPct: b.elapsedMs > 0 ? (b.elapsedMs - t.elapsedMs) / b.elapsedMs * 100 : null,
      firstStdoutMs: difference(b.firstStdoutMs, t.firstStdoutMs),
      requestToFirstTextMs: difference(b.observation?.requestToFirstTextMs, t.observation?.requestToFirstTextMs),
      requestToCompletionMs: difference(b.observation?.requestToCompletionMs, t.observation?.requestToCompletionMs),
    };
  });
  const deltas = pairs.map((row) => row.totalMs);
  const average = mean(deltas);
  const orderGroup = (first) => stats(pairs.filter((row) => row.baselineFirst === first).map((row) => row.totalMs));
  const comparisons = (key) => {
    const values = pairs.map((row) => row[key]).filter((value) => typeof value === "number" && Number.isFinite(value));
    return { n: values.length, wins: values.filter((value) => value > 0).length, losses: values.filter((value) => value < 0).length, ties: values.filter((value) => value === 0).length };
  };
  return {
    n: pairs.length, pairs,
    wins: deltas.filter((value) => value > 0).length,
    losses: deltas.filter((value) => value < 0).length,
    ties: deltas.filter((value) => value === 0).length,
    deltaMs: stats(deltas),
    sampleStddevMs: deltas.length < 2 ? null : Math.sqrt(deltas.reduce((sum, value) => sum + (value - average) ** 2, 0) / (deltas.length - 1)),
    meanDeltaIntervalMs: bootstrapMeanInterval(deltas),
    baselineFirst: orderGroup(true), tierFirst: orderGroup(false),
    smallSample: pairs.length < 10,
    firstStdout: comparisons("firstStdoutMs"), firstText: comparisons("requestToFirstTextMs"), requestToCompletion: comparisons("requestToCompletionMs"),
  };
}
