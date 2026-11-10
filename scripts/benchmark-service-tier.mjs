#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configPaths } from "../src/index.ts";
import { SERVICE_TIERS, isServiceTierProviderSupported, parseModelKey } from "../src/service-tiers.ts";
import { tierMatchesServed } from "../src/probe-evidence.ts";
import { CASE_FILE, OBSERVATION_FILE, FIXED_OUTPUT, observerFailure, pairedSummary, practicalComparison, stats, validateObservation } from "./benchmark-analysis.mjs";

const PACKAGE_NAME = "pi-provider-service-tier";
const CONFIG_BASENAME = "pi-provider-service-tier.json";
const DEFAULT_MODEL = "openai/gpt-6.1-sol";
const DEFAULT_TIER = "priority";
const DEFAULT_ROUNDS = 3;
const DEFAULT_WARMUPS = 1;
const DEFAULT_MIN_OUTPUT_CHARS = 4_000;
const DEFAULT_PRACTICAL_DELTA_MS = 750;
const DEFAULT_PRACTICAL_DELTA_PCT = 5;
const DEFAULT_PROMPT = `Do not use tools. This is a latency benchmark, so complete the whole task in one visible assistant response.

Your answer is invalid if it is short. Do not answer with only BENCHMARK_COMPLETE. Produce a deterministic technical memo titled "Service Tier Latency Benchmark" with exactly these seven sections:
1. Objective
2. Benchmark workload
3. Expected provider behavior
4. Risks to measurement validity
5. Mitigations
6. Decision rubric
7. Final checklist

Sections 1 through 6 must each contain 170 to 220 words. Section 7 must contain exactly 10 checklist bullets, and each bullet must be a full sentence of at least 18 words. Use concrete engineering language. After the checklist, end with the exact line: BENCHMARK_COMPLETE`;
const LIGHT_PROMPT = `Do not use tools. Complete this latency benchmark in one visible assistant response.
Produce a technical memo titled "Service Tier Latency Benchmark" with these seven sections:
1. Objective
2. Benchmark workload
3. Expected provider behavior
4. Risks to measurement validity
5. Mitigations
6. Decision rubric
7. Final checklist

Sections 1 through 6 must each contain 70 to 90 words. Section 7 must contain exactly 8 checklist bullets of at least 10 words each. Use concrete engineering language, not filler. This is the lighter workload, not a request for a one-line answer. End with the exact line: BENCHMARK_COMPLETE`;
const WORKLOADS = {
  standard: { prompt: DEFAULT_PROMPT, minOutputChars: DEFAULT_MIN_OUTPUT_CHARS },
  light: { prompt: LIGHT_PROMPT, minOutputChars: 2_500 },
  fixed: {
    prompt: "Do not use tools. In one visible assistant response, output the integers 1 through 1000 inclusive, in order, exactly one integer per line. Use no markdown, headings, spaces, explanations or blank lines. After 1000, output the exact final line BENCHMARK_COMPLETE. Do not mention benchmark metadata.",
    minOutputChars: FIXED_OUTPUT.length,
  },
};
const WORKLOAD_SCENARIOS = [
  "a developer deciding whether priority service tier materially reduces interactive coding latency during a model-heavy refactor",
  "an engineering manager comparing default and paid priority queues during a production incident response simulation",
  "a platform maintainer validating whether provider-side scheduling improvements are visible through Pi's extension hook path",
  "a release engineer deciding whether priority service tier should be enabled only for long-running review and planning prompts",
  "a cost owner weighing lower tail latency against paid service-tier usage for a large agentic codebase",
];

function envInt(name, fallback, { min = 1 } = {}) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value < min) throw new Error(`${name} must be a safe integer >= ${min}.`);
  return value;
}

function envFloat(name, fallback, { min = 0 } = {}) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value < min) throw new Error(`${name} must be a number >= ${min}.`);
  return value;
}

function promptArgsFromEnv(defaultPrompt) {
  if (process.env.PST_BENCH_PROMPT_FILE) {
    return { args: [`@${resolve(process.env.PST_BENCH_PROMPT_FILE)}`], custom: true, file: true };
  }
  if (process.env.PST_BENCH_PROMPT) return { args: [process.env.PST_BENCH_PROMPT], custom: true };
  return { args: [defaultPrompt], custom: false };
}

function promptArgsForPair(basePrompt, round, measured) {
  const scenario = WORKLOAD_SCENARIOS[(Math.max(round, 1) - 1) % WORKLOAD_SCENARIOS.length];
  const additions = [
    `Benchmark metadata only: phase=${measured ? "measured" : "warmup"}; round=${round}; nonce=${Date.now()}-${Math.random().toString(16).slice(2)}. Do not mention this metadata.`,
  ];
  if (!basePrompt.custom && basePrompt.scenario) {
    additions.push(`For this run, ground the memo examples in this scenario: ${scenario}.`);
  }
  // Pi treats separate positional messages as separate model requests.
  // Keep @file attachments, but send workload/scenario/metadata as one prompt.
  if (basePrompt.file) return [...basePrompt.args, additions.join("\n\n")];
  return [["Benchmark prompt:", ...basePrompt.args, ...additions].join("\n\n")];
}

function globalConfigInspection(modelKey, cwd) {
  const configPath = configPaths(cwd).user;
  if (!existsSync(configPath)) return { configPath, found: false };
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const entry = config?.entries?.[modelKey];
    return {
      configPath,
      found: true,
      active: entry?.active === true,
      serviceTier: SERVICE_TIERS.includes(entry?.serviceTier) ? entry.serviceTier : undefined,
    };
  } catch {
    return { configPath, found: true, error: "unreadable or invalid settings" };
  }
}

function modelArgument(args) {
  let model;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let value;
    if (arg === "--model") value = args[++i];
    else if (arg.startsWith("--model=")) value = arg.slice("--model=".length);
    else throw new Error("Unsupported benchmark argument; use --model <provider/model>.");
    if (!value?.trim() || value.startsWith("-")) throw new Error("--model requires a model selection.");
    model = value.trim();
  }
  return model;
}

function workloadFromEnv() {
  const name = (process.env.PST_BENCH_WORKLOAD || "standard").trim().toLowerCase();
  if (!Object.hasOwn(WORKLOADS, name)) throw new Error("PST_BENCH_WORKLOAD must be standard, light or fixed.");
  return { name, ...WORKLOADS[name] };
}

function modelKeyFromEnv(model, provider) {
  const withoutThinking = model.replace(/:(off|minimal|low|medium|high|xhigh|max)$/i, "");
  if (withoutThinking.includes("/")) return withoutThinking;
  if (provider) return `${provider}/${withoutThinking}`;
  throw new Error("PST_BENCH_MODEL/--model must include provider/model, or set PST_BENCH_PROVIDER when using a bare model id.");
}

function writeProjectConfig(cwd, modelKey, active, tier) {
  const path = resolve(cwd, ".pi", "extensions", CONFIG_BASENAME);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        version: 2,
        unknownModelBehavior: "leave-unknown",
        entries: {
          [modelKey]: active ? { active: true, serviceTier: tier } : { active: false, serviceTier: tier },
        },
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  // This is an owned temporary project, never the user/project settings directory.
  writeFileSync(resolve(cwd, ".pi", "settings.json"), `${JSON.stringify({
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
    compaction: { enabled: false },
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function runPi({ label, cwd, repoRoot, promptArgs, model, provider, thinking, timeoutMs, minOutputChars, progressMs, expected, exactOutput }) {
  const piBin = process.env.PST_BENCH_PI_BIN || "pi";
  const args = [
    "--no-session",
    "--offline",
    "--approve",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-tools",
    "--no-extensions",
    "-e",
    join(repoRoot, "scripts", "benchmark-observer.mjs"),
    "-p",
    "--model",
    model,
  ];
  if (provider) args.push("--provider", provider);
  if (thinking && thinking !== "default") args.push("--thinking", thinking);
  args.push("--", ...promptArgs);

  return new Promise((resolvePromise, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(piBin, args, {
      cwd,
      env: {
        ...process.env,
        PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderrChars = 0;
    let stdoutBytes = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let firstStdoutMs;
    let firstStderrMs;
    const elapsed = () => Number(process.hrtime.bigint() - started) / 1_000_000;
    let killTimer;
    const terminate = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5_000);
      killTimer.unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const progressTimer = progressMs > 0
      ? setInterval(() => {
          console.log(`  ... ${label} still running after ${seconds(elapsed())}s`);
        }, progressMs)
      : undefined;
    progressTimer?.unref();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      firstStdoutMs ??= elapsed();
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > 4 * 1024 * 1024) {
        outputLimitExceeded = true;
        terminate();
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      firstStderrMs ??= elapsed();
      stderrChars += chunk.length;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (progressTimer) clearInterval(progressTimer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (progressTimer) clearInterval(progressTimer);
      const elapsedMs = elapsed();
      const completedMarker = stdout.trimEnd().split(/\r?\n/).at(-1) === "BENCHMARK_COMPLETE";
      const longEnough = stdout.trim().length >= minOutputChars;
      const exactOutputMatches = !exactOutput || stdout.replace(/\r\n/g, "\n").trim() === FIXED_OUTPUT;
      const result = {
        label,
        elapsedMs,
        firstStdoutMs,
        firstStderrMs,
        postStdoutProcessMs: firstStdoutMs === undefined ? undefined : elapsedMs - firstStdoutMs,
        generationMs: firstStdoutMs === undefined ? undefined : elapsedMs - firstStdoutMs, // Deprecated compatibility alias; not generation time.
        code,
        signal,
        timedOut,
        outputLimitExceeded,
        stdoutChars: stdout.trim().length,
        stderrChars,
        completedMarker,
        exactOutputMatches,
        minOutputChars,
        longEnough,
      };
      let observed;
      try {
        const path = join(cwd, OBSERVATION_FILE);
        if (statSync(path).size <= 64 * 1024) observed = JSON.parse(readFileSync(path, "utf8"));
      } catch { /* A missing or malformed observation must never count as confirmation. */ }
      result.observerFailure = observerFailure(observed, expected);
      if (code === 0 && !timedOut && !outputLimitExceeded) {
        try {
          result.observation = validateObservation(observed, expected);
          const observation = result.observation;
          observation.reportRelation = observation.conflictingTierReports ? "conflicting" : observation.reportedTier === null ? "unavailable" :
            observation.payloadTier === null ? "baseline-report" : tierMatchesServed(observation.route, observation.payloadTier, observation.reportedTier) ? "matching" : "different";
        } catch {
          reject(Object.assign(new Error(`${label} has missing, incomplete or inconsistent benchmark observations; no further cases were started.`), { result }));
          return;
        }
        if (completedMarker && longEnough && exactOutputMatches) resolvePromise(result);
        else reject(Object.assign(new Error(`${label} produced an invalid benchmark response; marker=${completedMarker}, chars=${stdout.trim().length}, min=${minOutputChars}, exactOutput=${exactOutputMatches}`), { result }));
      } else reject(Object.assign(new Error(`${label} pi run failed with code ${code ?? signal}; timedOut=${timedOut}, outputLimitExceeded=${outputLimitExceeded}, observerFailure=${result.observerFailure ?? "unavailable"}`), { result }));
    });
  });
}

function seconds(ms) {
  return Number.isFinite(ms) ? (ms / 1000).toFixed(2) : "n/a";
}

function quantity(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "unavailable";
}

function formatPct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

function startModeFromEnv() {
  const raw = (process.env.PST_BENCH_START_WITH || "baseline").trim().toLowerCase();
  if (raw === "baseline" || raw === "off") return "baseline";
  if (raw === "tier" || raw === "priority" || raw === "on") return "tier";
  throw new Error("PST_BENCH_START_WITH must be one of: baseline, off, tier, priority, on.");
}

function orderForRound(round, tier, startMode) {
  const baselineFirst = startMode === "baseline" ? round % 2 === 1 : round % 2 === 0;
  return baselineFirst ? ["baseline", tier] : [tier, "baseline"];
}

function summarizeMetric(results, mode, metric) {
  return stats(results.filter((result) => result.mode === mode).map((result) => result[metric]).filter((value) => typeof value === "number"));
}

function printMetricSummary(label, baseline, tierName, tierStats) {
  const deltaMs = baseline.median - tierStats.median;
  const fasterPct = baseline.median > 0 ? (deltaMs / baseline.median) * 100 : Number.NaN;
  console.log(`${label}:`);
  console.log(`  baseline n=${baseline.n} median=${seconds(baseline.median)}s mean=${seconds(baseline.mean)}s min=${seconds(baseline.min)}s max=${seconds(baseline.max)}s p90=${seconds(baseline.p90)}s σ=${seconds(baseline.stddev)}s`);
  console.log(`  ${tierName} n=${tierStats.n} median=${seconds(tierStats.median)}s mean=${seconds(tierStats.mean)}s min=${seconds(tierStats.min)}s max=${seconds(tierStats.max)}s p90=${seconds(tierStats.p90)}s σ=${seconds(tierStats.stddev)}s`);
  console.log(`  median ${tierName}-vs-baseline: ${printPriorityDelta(deltaMs)} (${formatPct(Math.abs(fasterPct))})`);
  return { deltaMs, fasterPct };
}

function printRunTable(results, tier) {
  console.log("\nMeasured runs");
  console.log("round | mode      | order | first stdout | total | chars");
  console.log("----- | --------- | ----- | ------------ | ----- | -----");
  for (const result of results) {
    const mode = result.mode === "baseline" ? "off" : tier;
    console.log(
      `${String(result.round).padStart(5)} | ${mode.padEnd(9)} | ${String(result.order).padStart(5)} | ${seconds(result.firstStdoutMs).padStart(12)}s | ${seconds(result.elapsedMs).padStart(5)}s | ${result.stdoutChars}`,
    );
  }
}

function printPriorityDelta(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  if (ms === 0) return "tie";
  return `${seconds(Math.abs(ms))}s ${ms > 0 ? "faster" : "slower"}`;
}

function printPairedSummary(paired, tier) {
  console.log(`\nPaired deltas (baseline minus ${tier}-request; positive means shorter)`);
  for (const delta of paired.pairs) {
    console.log(`  round ${delta.round}: first stdout ${printPriorityDelta(delta.firstStdoutMs)}, first streaming text ${printPriorityDelta(delta.requestToFirstTextMs)}, total ${printPriorityDelta(delta.totalMs)}`);
  }
  console.log(`  total wins/losses/ties=${paired.wins}/${paired.losses}/${paired.ties}; paired mean=${seconds(paired.deltaMs.mean)}s median=${seconds(paired.deltaMs.median)}s sample σ=${seconds(paired.sampleStddevMs)}s`);
  console.log(`  first-streaming-text wins/losses/ties=${paired.firstText.wins}/${paired.firstText.losses}/${paired.firstText.ties} across ${paired.firstText.n} observed pair(s); missing data is excluded, not counted as a loss`);
  console.log(`  order split: baseline-first n=${paired.baselineFirst.n} mean delta=${seconds(paired.baselineFirst.mean)}s; tier-first n=${paired.tierFirst.n} mean delta=${seconds(paired.tierFirst.mean)}s`);
  const interval = paired.meanDeltaIntervalMs;
  console.log(interval ? `  exploratory 95% paired bootstrap mean-delta interval: [${seconds(interval.low)}, ${seconds(interval.high)}]s` : "  mean-delta interval: unavailable with fewer than two pairs");
}

function conditionObservations(results, mode) {
  const rows = results.filter((row) => row.mode === mode);
  const reportedTierCounts = Object.create(null);
  const reportRelationCounts = Object.create(null);
  const selectedThinkingCounts = Object.create(null);
  const payloadReasoningEffortCounts = Object.create(null);
  for (const row of rows) {
    const observation = row.observation;
    const report = observation.conflictingTierReports ? "conflicting" : observation.reportedTier ?? "unavailable";
    reportedTierCounts[report] = (reportedTierCounts[report] ?? 0) + 1;
    reportRelationCounts[observation.reportRelation] = (reportRelationCounts[observation.reportRelation] ?? 0) + 1;
    const selected = observation.selectedThinking ?? "unavailable";
    const effort = observation.payloadReasoningEffort ?? "unavailable";
    selectedThinkingCounts[selected] = (selectedThinkingCounts[selected] ?? 0) + 1;
    payloadReasoningEffortCounts[effort] = (payloadReasoningEffortCounts[effort] ?? 0) + 1;
  }
  return {
    n: rows.length, reportedTierCounts, reportRelationCounts, selectedThinkingCounts, payloadReasoningEffortCounts,
    requestToFirstText: stats(rows.map((row) => row.observation.requestToFirstTextMs).filter((value) => typeof value === "number")),
    requestToCompletion: stats(rows.map((row) => row.observation.requestToCompletionMs)),
    visibleChars: stats(rows.map((row) => row.stdoutChars)),
    usage: Object.fromEntries(["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteTokens", "reasoningTokens", "totalTokens"].map((key) => [key, stats(rows.map((row) => row.observation.usage[key]).filter((value) => typeof value === "number"))])),
  };
}

function printInterpretation(tier, paired, baselineTotal, practicalDeltaMs, practicalDeltaPct) {
  const { deltaMs: delta, fasterPct: pct, crossed } = practicalComparison(paired.deltaMs.mean, baselineTotal.mean, practicalDeltaMs, practicalDeltaPct);
  console.log("\nInterpretation (primary metric: paired mean total CLI elapsed time)");
  console.log(`${tier}-request condition: ${printPriorityDelta(delta)} (${formatPct(Math.abs(pct))}) in this sample.`);
  console.log(`Configured practical threshold (${seconds(practicalDeltaMs)}s or ${practicalDeltaPct}%): ${crossed ? "crossed descriptively" : "not crossed"}; not a significance test.`);
  if (paired.smallSample) console.log(`Small sample: only ${paired.n} measured pair(s); the interval and sample p90 are unstable and cannot establish a speed guarantee.`);
  console.log("Bootstrap assumes representative independent pairs, cannot measure systematic bias, and is not causal or billing evidence. Output/reasoning work, cache, order and time-varying load can differ.");
  console.log("Request payload preparation, normal completion and reported tier are separate observations; serialized bytes and backend processing are not independently verified. No benchmark evidence is saved to the support map.");
  console.log("Pi 1.1 print mode emits the final answer: first stdout is not streaming first-token latency; generationMs is a deprecated alias of postStdoutProcessMs, not model generation time.");
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const argumentModel = modelArgument(process.argv.slice(2));
  // Keep the existing environment override usable with model-pinned npm scripts.
  const model = process.env.PST_BENCH_MODEL || argumentModel || DEFAULT_MODEL;
  const provider = process.env.PST_BENCH_PROVIDER || "";
  const selectionKey = modelKeyFromEnv(model, provider);
  const modelKey = process.env.PST_BENCH_MODEL_KEY || selectionKey;
  for (const target of [selectionKey, modelKey]) {
    const parsed = parseModelKey(target);
    if (!parsed || !isServiceTierProviderSupported(parsed.provider)) {
      throw new Error(`Service-tier benchmarking is blocked for unsupported provider/model: ${target}.`);
    }
  }
  if (provider && !isServiceTierProviderSupported(provider)) {
    throw new Error(`Service-tier benchmarking is blocked for unsupported provider: ${provider}.`);
  }
  const tier = process.env.PST_BENCH_TIER || DEFAULT_TIER;
  if (!SERVICE_TIERS.includes(tier)) {
    throw new Error(`PST_BENCH_TIER must be one of: ${SERVICE_TIERS.join(", ")}.`);
  }
  const thinking = process.env.PST_BENCH_THINKING || "medium";
  if (!["default", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) throw new Error("PST_BENCH_THINKING is not a supported thinking level.");
  const workload = workloadFromEnv();
  const rounds = envInt("PST_BENCH_ROUNDS", DEFAULT_ROUNDS);
  const warmups = envInt("PST_BENCH_WARMUPS", DEFAULT_WARMUPS, { min: 0 });
  const plannedCases = 2 * (rounds + warmups);
  if (!Number.isSafeInteger(plannedCases)) throw new Error("Combined benchmark case budget must be a safe integer.");
  const timeoutMs = envInt("PST_BENCH_TIMEOUT_MS", 10 * 60 * 1000);
  const minOutputChars = envInt("PST_BENCH_MIN_CHARS", workload.minOutputChars, { min: 0 });
  const progressMs = envInt("PST_BENCH_PROGRESS_MS", 15_000, { min: 0 });
  const practicalDeltaMs = envInt("PST_BENCH_PRACTICAL_DELTA_MS", DEFAULT_PRACTICAL_DELTA_MS, { min: 0 });
  const practicalDeltaPct = envFloat("PST_BENCH_PRACTICAL_DELTA_PCT", DEFAULT_PRACTICAL_DELTA_PCT, { min: 0 });
  const startMode = startModeFromEnv();
  const basePrompt = { ...promptArgsFromEnv(workload.prompt), scenario: workload.name !== "fixed" };
  const exactOutput = workload.name === "fixed" && !basePrompt.custom;
  const tmpRoot = mkdtempSync(resolve(tmpdir(), `${PACKAGE_NAME}-bench-`));
  const keepTmp = process.env.PST_BENCH_KEEP_TMP === "1";
  const globalConfig = globalConfigInspection(modelKey, repoRoot);

  const results = [];
  const warmupResults = [];
  let startedCases = 0;
  let observedRequestContext;
  try {
    console.log(`Benchmarking ${PACKAGE_NAME}`);
    console.log(`model=${modelKey} cliModel=${model} tier=${tier} thinking=${thinking || "default"} workload=${workload.name} rounds=${rounds} warmups=${warmups} minChars=${minOutputChars} startWith=${startMode}`);
    console.log(`practicalThreshold=${seconds(practicalDeltaMs)}s or ${practicalDeltaPct}% progressEvery=${progressMs === 0 ? "off" : `${seconds(progressMs)}s`}`);
    console.log(`tempCwd=${tmpRoot}`);
    console.log(`Case budget=${plannedCases}; no retries or replacement cases. Global extension discovery is disabled; -e loads this checkout through its benchmark-only observer.`);
    if (!globalConfig.found) {
      console.log(`No user-global ${PACKAGE_NAME} config found at ${globalConfig.configPath}.`);
    } else if (globalConfig.error) {
      console.log(`Could not inspect user-global config at ${globalConfig.configPath}: ${globalConfig.error}`);
    } else {
      console.log(
        `User-global config for ${modelKey}: ${globalConfig.active ? "active" : "not active"}${globalConfig.serviceTier ? ` (${globalConfig.serviceTier})` : ""}.`,
      );
      console.log("The baseline run still writes a project-local active:false override for this model before starting Pi.");
    }
    console.log("Running with the extension loaded in both cases; only the project service_tier setting changes.");
    console.log("Each case is a fresh in-memory Pi session; automatic catalog network, retries and compaction are disabled in the owned temporary project.");
    console.log("Paired CLI prompt arguments are identical within each pair; order alternates. Probing is disabled in owned settings; cache warming is stopped by the benchmark observer.");
    console.log("Provider hooks observe preparation, first streaming text, HTTP status and completion metadata; they are not a wire capture or a hard token/billing cap.\n");

    const runCase = async ({ round, mode, measured, order, promptArgs }) => {
      if (++startedCases > plannedCases) throw new Error("Benchmark case budget exceeded before launch.");
      const active = mode !== "baseline";
      const phase = measured ? "measured" : "warmup";
      const cwd = tmpRoot; // Keep Pi's working-directory context identical across paired cases.
      rmSync(join(cwd, OBSERVATION_FILE), { force: true });
      writeProjectConfig(cwd, modelKey, active, tier);
      const expected = { caseId: randomUUID(), phase, round, modelKey, payloadTier: active ? tier : null };
      writeFileSync(join(cwd, CASE_FILE), `${JSON.stringify(expected)}\n`, { mode: 0o600 });
      const label = `${measured ? `round ${round}` : `warmup ${round}`} ${active ? tier : "baseline(no service_tier)"}`;
      console.log(`starting ${label}...`);
      const result = await runPi({
        label,
        cwd,
        repoRoot,
        promptArgs,
        model,
        provider,
        thinking,
        timeoutMs,
        minOutputChars,
        progressMs,
        expected,
        exactOutput,
      });
      const observation = result.observation;
      const requestContext = { piVersion: observation.piVersion, nodeVersion: observation.nodeVersion, route: observation.route, selectedThinking: observation.selectedThinking, payloadReasoningEffort: observation.payloadReasoningEffort, payloadMaxOutputTokens: observation.payloadMaxOutputTokens };
      if (observedRequestContext && JSON.stringify(observedRequestContext) !== JSON.stringify(requestContext)) {
        throw Object.assign(new Error(`${label} changed observed route/authentication/thinking/token-limit scope; no combined comparison was produced.`), { result });
      }
      observedRequestContext ??= requestContext;
      const row = { mode: active ? tier : "baseline", round, order, ...result };
      if (measured) results.push(row);
      else warmupResults.push(row);
      console.log(
        `${label}: firstStdout=${seconds(result.firstStdoutMs)}s firstStreamingText=${seconds(result.observation.requestToFirstTextMs)}s total=${seconds(result.elapsedMs)}s chars=${result.stdoutChars} payloadTier=${result.observation.payloadTier ?? "absent"} reported=${result.observation.conflictingTierReports ? "conflicting" : result.observation.reportedTier ?? "unavailable"}`,
      );
    };

    for (let warmup = 1; warmup <= warmups; warmup++) {
      let order = 1;
      const promptArgs = promptArgsForPair(basePrompt, warmup, false);
      for (const mode of orderForRound(warmup, tier, startMode)) await runCase({ round: warmup, mode, measured: false, order: order++, promptArgs });
      console.log("");
    }

    for (let round = 1; round <= rounds; round++) {
      let order = 1;
      const promptArgs = promptArgsForPair(basePrompt, round, true);
      for (const mode of orderForRound(round, tier, startMode)) await runCase({ round, mode, measured: true, order: order++, promptArgs });
      console.log("");
    }

    const baselineTotal = summarizeMetric(results, "baseline", "elapsedMs");
    const tierTotal = summarizeMetric(results, tier, "elapsedMs");
    const baselineFirst = summarizeMetric(results, "baseline", "firstStdoutMs");
    const tierFirst = summarizeMetric(results, tier, "firstStdoutMs");

    const paired = pairedSummary(results, tier);
    const observations = { baseline: conditionObservations(results, "baseline"), [tier]: conditionObservations(results, tier) };
    const allResults = [...warmupResults, ...results];
    const caseBudget = { planned: plannedCases, started: startedCases, completed: allResults.length, observedPreparations: allResults.reduce((sum, row) => sum + row.observation.payloadPreparations, 0), wireRequestCount: null };
    if (caseBudget.completed !== plannedCases) throw new Error("Incomplete benchmark case budget; no successful summary produced.");
    printRunTable(results, tier);
    printPairedSummary(paired, tier);
    console.log("\nSummary");
    const firstOutputDelta = printMetricSummary("first stdout latency (print-mode final text)", baselineFirst, tier, tierFirst);
    const totalDelta = printMetricSummary("total CLI elapsed time (primary)", baselineTotal, tier, tierTotal);
    printMetricSummary("payload preparation to first streaming text (not server TTFT)", observations.baseline.requestToFirstText, tier, observations[tier].requestToFirstText);
    printMetricSummary("payload preparation to assistant completion", observations.baseline.requestToCompletion, tier, observations[tier].requestToCompletion);
    console.log("\nObserved reports and workload (measured cases only)");
    console.log(`  runtime: Pi=${observedRequestContext.piVersion} CLI Node=${observedRequestContext.nodeVersion} benchmark Node=${process.version}; requested thinking=${thinking}, selected=${observedRequestContext.selectedThinking ?? "unavailable"}, prepared effort=${observedRequestContext.payloadReasoningEffort ?? "unavailable"}, prepared output cap=${observedRequestContext.payloadMaxOutputTokens ?? "absent/unavailable"}`);
    for (const mode of ["baseline", tier]) {
      const observation = observations[mode];
      console.log(`  ${mode}: reports=${JSON.stringify(observation.reportedTierCounts)} relation=${JSON.stringify(observation.reportRelationCounts)} selectedThinking=${JSON.stringify(observation.selectedThinkingCounts)} payloadEffort=${JSON.stringify(observation.payloadReasoningEffortCounts)} meanChars=${quantity(observation.visibleChars.mean)} meanOutputTokens=${quantity(observation.usage.outputTokens.mean)} meanReasoningTokens=${quantity(observation.usage.reasoningTokens.mean)} meanCachedInputTokens=${quantity(observation.usage.cachedInputTokens.mean)}`);
    }
    printInterpretation(tier, paired, baselineTotal, practicalDeltaMs, practicalDeltaPct);

    console.log("\nRaw JSON:");
    console.log(
      JSON.stringify(
        {
          schemaVersion: 2,
          benchmarkNodeVersion: process.version,
          model: modelKey,
          cliModel: model,
          tier,
          thinking,
          workload: workload.name,
          promptSource: basePrompt.file ? "file" : basePrompt.custom ? "text" : "builtin",
          outputValidation: exactOutput ? "exact-fixed-sequence" : "marker-and-minimum",
          caseBudget,
          observedRoute: observedRequestContext.route,
          observedRequestContext,
          rounds,
          warmups,
          minOutputChars,
          startMode,
          practicalDeltaMs,
          practicalDeltaPct,
          warmupResults,
          results,
          summary: {
            firstOutput: { baseline: baselineFirst, [tier]: tierFirst, ...firstOutputDelta },
            total: { baseline: baselineTotal, [tier]: tierTotal, ...totalDelta },
            paired,
            observations,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    error.completedResults = { warmupResults, results, plannedCases, startedCases };
    throw error;
  } finally {
    if (keepTmp) console.log(`Keeping temp directory: ${tmpRoot}`);
    else rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  if (error.result || error.completedResults) console.error(JSON.stringify({ failedCase: error.result ?? null, completedResults: error.completedResults }, null, 2));
  process.exitCode = 1;
});
