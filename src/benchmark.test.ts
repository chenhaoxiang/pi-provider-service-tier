import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const benchmark = fileURLToPath(new URL("../scripts/benchmark-service-tier.mjs", import.meta.url));
const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
const model = "openai/gpt-6.1-sol";

interface FakeCase {
  args: string[];
  cwd: string;
  modelKey: string;
  active: boolean;
  serviceTier: string;
  unknownModelBehavior: string;
  settings: { retry: { enabled: boolean; maxRetries: number; provider: { maxRetries: number } }; compaction: { enabled: boolean } };
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "pst-benchmark-test-"));
  const records = join(home, "calls.jsonl");
  const executable = join(home, "fake-pi.mjs");
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASE_FILE, OBSERVATION_FILE, OBSERVATION_VERSION, FIXED_OUTPUT, normalizedUsage } from ${JSON.stringify(new URL("../scripts/benchmark-analysis.mjs", import.meta.url).href)};
const cwd = process.cwd();
const config = JSON.parse(readFileSync(join(cwd, ".pi/extensions/pi-provider-service-tier.json"), "utf8"));
const settings = JSON.parse(readFileSync(join(cwd, ".pi/settings.json"), "utf8"));
const [[modelKey, entry]] = Object.entries(config.entries);
appendFileSync(process.env.BENCH_TEST_RECORDS, JSON.stringify({ args: process.argv.slice(2), cwd, modelKey, ...entry, unknownModelBehavior: config.unknownModelBehavior, settings }) + "\\n");
const contract = JSON.parse(readFileSync(join(cwd, CASE_FILE), "utf8"));
const row = {
  version: OBSERVATION_VERSION, caseId: contract.caseId, pid: process.pid, phase: contract.phase, round: contract.round, piVersion: "1.1.0", nodeVersion: process.version,
  failure: null, payloadPreparations: 1, responseCount: 1, assistantMessages: 1,
  route: { provider: modelKey.split("/")[0], id: modelKey.slice(modelKey.indexOf("/") + 1), api: "openai-responses", authMode: "unknown", endpointOrigin: "https://api.openai.com" },
  payloadTier: entry.active ? entry.serviceTier : null, selectedThinking: "medium", payloadReasoningEffort: "medium", payloadMaxOutputTokens: null, httpStatus: 200, normalCompletion: true,
  reportedTier: "default", conflictingTierReports: false, incompleteResponse: false, requestToFirstTextMs: 10, requestToCompletionMs: 20,
  usage: normalizedUsage({ input: 200, output: 100, cacheRead: 50, cacheWrite: 0, reasoning: 25, totalTokens: 350 }),
};
const caseIndex = readFileSync(process.env.BENCH_TEST_RECORDS, "utf8").trim().split("\\n").length;
const kind = !process.env.BENCH_TEST_FAIL_ON_CASE || Number(process.env.BENCH_TEST_FAIL_ON_CASE) === caseIndex ? process.env.BENCH_TEST_OBSERVATION : undefined;
if (kind === "wrong-pid") row.pid = 0;
if (kind === "stale-case") row.caseId = "00000000-0000-4000-8000-000000000000";
if (kind === "wrong-route") row.route.id = "different-model";
if (kind === "scope-change" && entry.active) row.route.api = "openai-completions";
if (kind === "thinking-change" && entry.active) row.payloadReasoningEffort = "high";
if (kind === "incomplete") row.normalCompletion = false;
if (kind === "incomplete-response") row.incompleteResponse = true;
if (kind === "extra-preparation") row.payloadPreparations = 2;
if (kind === "extra-response") row.responseCount = 2;
if (kind === "wrong-tier") row.payloadTier = "flex";
if (kind === "negative-timing") row.requestToFirstTextMs = -1;
if (kind === "inverted-timing") row.requestToFirstTextMs = 21;
if (kind === "conflicting") row.conflictingTierReports = true;
if (kind === "no-report") row.reportedTier = null;
if (kind === "no-text") row.requestToFirstTextMs = null;
if (kind === "unknown-usage") row.usage = normalizedUsage(undefined);
row.privateUnknownField = process.env.BENCH_TEST_CANARY;
if (kind !== "missing") writeFileSync(join(cwd, OBSERVATION_FILE), kind === "bad-json" ? "{" : JSON.stringify(row));
const canary = process.env.BENCH_TEST_CANARY || "";
if (canary) process.stderr.write(canary);
const output = process.env.BENCH_TEST_FIXED ? FIXED_OUTPUT.replace(process.env.BENCH_TEST_FIXED === "invalid" ? "500\\n" : "never-matches", "501\\n") : canary + "x".repeat(Number(process.env.BENCH_TEST_CHARS || 5000)) + "\\nBENCHMARK_COMPLETE";
process.stdout.write(process.env.BENCH_TEST_MARKER === "middle" ? output + "\\nnot-final" : output + "\\n");
if (process.env.BENCH_TEST_EXIT) process.exitCode = Number(process.env.BENCH_TEST_EXIT);
`, { mode: 0o700 });
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PST_BENCH_"))),
    HOME: home, PI_CODING_AGENT_DIR: home,
    PST_BENCH_PI_BIN: executable, PST_BENCH_PROGRESS_MS: "0", BENCH_TEST_RECORDS: records,
  };
  function run(args: string[] = [], overrides: Record<string, string> = {}, profile?: string) {
    const result = spawnSync(profile ? "sh" : process.execPath, profile ? ["-c", scripts[profile]] : [benchmark, ...args], {
      cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...env, ...overrides },
    });
    assert.equal(result.error, undefined);
    const calls: FakeCase[] = existsSync(records)
      ? readFileSync(records, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    const raw = result.status === 0 ? JSON.parse(result.stdout.split("\nRaw JSON:\n")[1]) : undefined;
    return { ...result, calls, raw };
  }
  return { home, records, run, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

const shortRun = { PST_BENCH_ROUNDS: "1", PST_BENCH_WARMUPS: "0" };

test("every npm benchmark profile explicitly selects gpt-6.1-sol and preserves its call budget and order offline", () => {
  const profiles = [
    ["bench:service-tier", 3, 1, "medium", "standard", false],
    ["bench:service-tier:quick", 1, 0, "medium", "standard", false],
    ["bench:service-tier:stress", 5, 1, "high", "standard", false],
    ["bench:service-tier:stress:light", 2, 0, "medium", "light", false],
    ["bench:service-tier:swap", 3, 1, "medium", "standard", true],
  ] as const;
  assert.deepEqual(Object.keys(scripts).filter((name) => name.startsWith("bench:service-tier")).sort(), profiles.map(([name]) => name).sort());
  for (const [name, rounds, warmups, thinking, workload, startsWithTier] of profiles) {
    const f = fixture();
    try {
      assert.match(scripts[name], /--model openai\/gpt-6\.1-sol(?:\s|$)/);
      const result = f.run([], {}, name);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.raw.model, model);
      assert.equal(result.raw.cliModel, model);
      assert.equal(result.raw.rounds, rounds);
      assert.equal(result.raw.warmups, warmups);
      assert.equal(result.raw.thinking, thinking);
      assert.equal(result.raw.workload, workload);
      assert.equal(result.calls.length, 2 * (rounds + warmups));
      assert.equal(result.raw.results.length, 2 * rounds);
      assert.equal(result.raw.warmupResults.length, 2 * warmups);
      assert.equal(result.raw.schemaVersion, 2);
      assert.deepEqual(result.raw.caseBudget, { planned: 2 * (rounds + warmups), started: 2 * (rounds + warmups), completed: 2 * (rounds + warmups), observedPreparations: 2 * (rounds + warmups), wireRequestCount: null });
      assert.equal(result.raw.summary.paired.n, rounds);
      for (let pair = 0; pair < result.calls.length; pair += 2) {
        const positional = (row: FakeCase) => row.args.slice(row.args.indexOf("--") + 1);
        assert.deepEqual(positional(result.calls[pair]), positional(result.calls[pair + 1]), "paired prompt arguments must be identical, including nonce/scenario");
        assert.doesNotMatch(positional(result.calls[pair]).join("\n"), /; mode=/);
      }
      const modes = [...result.raw.warmupResults, ...result.raw.results].map((row: { mode: string }) => row.mode);
      assert.deepEqual(result.calls.map((row) => row.active ? row.serviceTier : "baseline"), modes);
      for (const rows of [result.raw.warmupResults, result.raw.results]) {
        for (let pair = 0; pair < rows.length / 2; pair++) {
          const tierFirst = (pair % 2 === 0) === startsWithTier;
          assert.deepEqual(rows.slice(pair * 2, pair * 2 + 2).map((row: { mode: string }) => row.mode), tierFirst ? ["priority", "baseline"] : ["baseline", "priority"]);
        }
      }
      for (const row of result.calls) {
        assert.equal(row.modelKey, model);
        assert.equal(row.unknownModelBehavior, "leave-unknown");
        assert.equal(option(row.args, "--model"), model);
        assert.equal(option(row.args, "--thinking"), thinking);
        assert.equal(option(row.args, "-e"), fileURLToPath(new URL("../scripts/benchmark-observer.mjs", import.meta.url)));
        const prompts = row.args.slice(row.args.indexOf("--") + 1);
        assert.ok(row.args.includes("--"));
        assert.equal(prompts.length, 1, "one CLI message must produce one completion, not multiple followups");
        assert.match(prompts[0], /Benchmark metadata only: phase=/);
        for (const flag of ["--offline", "--approve", "--no-session", "--no-tools", "--no-extensions", "--no-context-files"]) assert.ok(row.args.includes(flag), flag);
        assert.deepEqual(row.settings, {
          retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } }, compaction: { enabled: false },
        });
        assert.equal(existsSync(row.cwd), false, "owned benchmark workspace is removed");
      }
      assert.match(result.stdout, /first stdout is not streaming first-token latency/);
      assert.equal(result.raw.minOutputChars, workload === "light" ? 2500 : 4000);
    } finally { f.cleanup(); }
  }
});

test("global settings inspection uses the extension's real path and preserves settings with a different Pi agent directory", () => {
  const f = fixture();
  try {
    const directory = join(f.home, ".pi/agent/extensions");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "pi-provider-service-tier.json");
    const original = `${JSON.stringify({ version: 2, entries: { [model]: { active: true, serviceTier: "flex" } }, unrelated: "preserve" })}\n`;
    writeFileSync(path, original, { mode: 0o600 });
    const result = f.run([], shortRun);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /User-global config for openai\/gpt-6\.1-sol: active \(flex\)/);
    assert.equal(readFileSync(path, "utf8"), original);
    assert.deepEqual(result.calls.map((row) => row.active), [false, true]);
  } finally { f.cleanup(); }
});

test("benchmark defaults and last --model argument work while preserving environment model overrides", () => {
  for (const [args, overrides, expected] of [
    [[], {}, model],
    [["--model", "openai/gpt-6-sol", `--model=${model}`], {}, model],
    [["--model", model], { PST_BENCH_MODEL: "openai/gpt-6-sol" }, "openai/gpt-6-sol"],
    [["--model", "gpt-6.1-sol:max"], { PST_BENCH_PROVIDER: "openai", PST_BENCH_THINKING: "default" }, model],
  ] as [string[], Record<string, string>, string][]) {
    const f = fixture();
    try {
      const result = f.run(args, { ...shortRun, ...overrides });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.raw.model, expected);
      assert.equal(result.calls.length, 2);
      assert.ok(result.calls.every((row) => row.modelKey === expected));
      if (overrides.PST_BENCH_THINKING === "default") {
        assert.equal(result.raw.cliModel, "gpt-6.1-sol:max");
        assert.equal(option(result.calls[0].args, "--thinking"), undefined);
      }
    } finally { f.cleanup(); }
  }
});

test("invalid benchmark arguments, CLI providers and workloads fail before starting even a fake Pi", () => {
  for (const [args, overrides, error] of [
    [["--model"], {}, /--model requires/],
    [["--model="], {}, /--model requires/],
    [["--model", "--unknown"], {}, /--model requires/],
    [["--unknown"], {}, /Unsupported benchmark argument/],
    [[model], {}, /Unsupported benchmark argument/],
    [["--model", "anthropic/blocked-model"], {}, /benchmarking is blocked/],
    [[], { PST_BENCH_WORKLOAD: "unknown" }, /PST_BENCH_WORKLOAD/],
    [[], { PST_BENCH_WORKLOAD: "__proto__" }, /PST_BENCH_WORKLOAD/],
    [[], { PST_BENCH_TIER: "not-a-tier" }, /PST_BENCH_TIER/],
    [[], { PST_BENCH_ROUNDS: "1.5" }, /PST_BENCH_ROUNDS/],
    [[], { PST_BENCH_ROUNDS: "2oops" }, /PST_BENCH_ROUNDS/],
    [[], { PST_BENCH_ROUNDS: "1e3" }, /PST_BENCH_ROUNDS/],
    [[], { PST_BENCH_ROUNDS: "0x10" }, /PST_BENCH_ROUNDS/],
    [[], { PST_BENCH_WARMUPS: "1oops" }, /PST_BENCH_WARMUPS/],
    [[], { PST_BENCH_ROUNDS: "9007199254740991" }, /case budget/],
    [[], { PST_BENCH_THINKING: "unknown" }, /PST_BENCH_THINKING/],
    [[], { PST_BENCH_PRACTICAL_DELTA_PCT: "5oops" }, /PST_BENCH_PRACTICAL_DELTA_PCT/],
  ] as [string[], Record<string, string>, RegExp][]) {
    const f = fixture();
    try {
      const result = f.run(args, { ...shortRun, ...overrides });
      assert.equal(result.status, 1);
      assert.match(result.stderr, error);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(f.records), false);
    } finally { f.cleanup(); }
  }
});

test("light workload shortens the prompt and minimum output without overriding custom prompt/file precedence", () => {
  for (const source of ["builtin", "text", "file"] as const) {
    const f = fixture();
    try {
      const promptFile = join(f.home, "prompt.md");
      writeFileSync(promptFile, "File prompt BENCHMARK_COMPLETE", "utf8");
      const overrides: Record<string, string> = source === "builtin" ? {} : { PST_BENCH_PROMPT: "Text prompt BENCHMARK_COMPLETE" };
      const result = f.run(["--model", model], {
        ...shortRun, PST_BENCH_WORKLOAD: "light", BENCH_TEST_CHARS: "2600", ...overrides,
        ...(source === "file" ? { PST_BENCH_PROMPT_FILE: promptFile } : {}),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.raw.minOutputChars, 2500);
      const args = result.calls[0].args;
      const positional = args.slice(args.indexOf("--") + 1);
      assert.equal(positional.filter((arg) => !arg.startsWith("@")).length, 1);
      if (source === "builtin") {
        assert.match(args.join("\n"), /70 to 90 words/);
        assert.doesNotMatch(args.join("\n"), /170 to 220 words/);
      } else if (source === "text") assert.ok(args.some((arg) => arg.includes("Text prompt BENCHMARK_COMPLETE")));
      else assert.ok(args.includes(`@${promptFile}`));
    } finally { f.cleanup(); }
  }
});

test("light workload still enforces completion length, with an explicit minimum override available", () => {
  for (const minimum of [undefined, "0"]) {
    const f = fixture();
    try {
      const result = f.run([], {
        ...shortRun, PST_BENCH_WORKLOAD: "light", BENCH_TEST_CHARS: "1000",
        ...(minimum === undefined ? {} : { PST_BENCH_MIN_CHARS: minimum }),
      });
      if (minimum === undefined) {
        assert.equal(result.status, 1);
        assert.match(result.stderr, /invalid benchmark response; marker=true, chars=\d+, min=2500/);
        assert.equal(result.calls.length, 1, "failed cases stop the benchmark rather than retry");
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.raw.minOutputChars, 0);
        assert.equal(result.calls.length, 2);
      }
      assert.ok(result.calls.every((row) => !existsSync(row.cwd)));
    } finally { f.cleanup(); }
  }
});

test("missing, inconsistent or incomplete observations stop before another case, without retries", () => {
  for (const kind of ["missing", "bad-json", "wrong-pid", "stale-case", "wrong-route", "incomplete", "incomplete-response", "extra-preparation", "extra-response", "wrong-tier", "negative-timing", "inverted-timing"]) {
    const f = fixture();
    try {
      const result = f.run([], { ...shortRun, BENCH_TEST_OBSERVATION: kind });
      assert.equal(result.status, 1, kind);
      assert.match(result.stderr, /missing, incomplete or inconsistent benchmark observations/);
      assert.equal(result.calls.length, 1, kind);
      assert.doesNotMatch(result.stdout, /Raw JSON:|Interpretation/);
      assert.ok(result.calls.every((row) => !existsSync(row.cwd)));
    } finally { f.cleanup(); }
  }
});

test("absent or conflicting tier metadata and unavailable first-text/usage remain explicitly unknown", () => {
  for (const kind of ["no-report", "conflicting", "no-text", "unknown-usage"]) {
    const f = fixture();
    try {
      const result = f.run([], { ...shortRun, BENCH_TEST_OBSERVATION: kind });
      assert.equal(result.status, 0, result.stderr);
      const observation = result.raw.results.find((row: { mode: string }) => row.mode === "priority").observation;
      assert.equal(observation.wireDelivery, "not-independently-observed");
      if (kind === "no-report") assert.equal(observation.reportRelation, "unavailable");
      if (kind === "conflicting") assert.equal(observation.reportRelation, "conflicting");
      if (kind === "no-text") {
        assert.equal(result.raw.summary.observations.priority.requestToFirstText.n, 0);
        assert.equal(result.raw.summary.paired.pairs[0].requestToFirstTextMs, null);
        assert.equal(result.raw.summary.paired.firstText.n, 0);
      }
      if (kind === "unknown-usage") {
        assert.equal(result.raw.summary.observations.priority.usage.reasoningTokens.n, 0);
        assert.match(result.stdout, /meanReasoningTokens=unavailable/);
      }
      assert.equal(result.raw.summary.paired.meanDeltaIntervalMs, null);
      assert.match(result.stdout, /Small sample: only 1 measured pair/);
    } finally { f.cleanup(); }
  }
});

test("reports distinguish a default response from a priority request and preserve output/cache/reasoning workload", () => {
  const f = fixture();
  try {
    const result = f.run([], shortRun);
    assert.equal(result.status, 0, result.stderr);
    const observation = result.raw.summary.observations.priority;
    assert.deepEqual(observation.reportedTierCounts, { default: 1 });
    assert.deepEqual(observation.reportRelationCounts, { different: 1 });
    assert.equal(observation.usage.outputTokens.mean, 100);
    assert.equal(observation.usage.reasoningTokens.mean, 25);
    assert.equal(observation.usage.cachedInputTokens.mean, 50);
    assert.equal(observation.visibleChars.n, 1);
    assert.doesNotMatch(result.stdout, /showed a practical improvement|Try more rounds/);
    assert.equal(result.raw.results[0].generationMs, result.raw.results[0].postStdoutProcessMs);
  } finally { f.cleanup(); }
});

test("changed route/auth scope and mid-run failures retain prior cases without producing a successful comparison", () => {
  for (const overrides of [
    { BENCH_TEST_OBSERVATION: "scope-change" },
    { BENCH_TEST_OBSERVATION: "thinking-change" },
    { BENCH_TEST_OBSERVATION: "missing", BENCH_TEST_FAIL_ON_CASE: "2" },
  ] as Record<string, string>[]) {
    const f = fixture();
    try {
      const result = f.run([], { ...shortRun, ...overrides });
      assert.equal(result.status, 1);
      assert.equal(result.calls.length, 2);
      const failure = JSON.parse(result.stderr.slice(result.stderr.indexOf("{")));
      assert.equal(failure.completedResults.results.length, 1);
      assert.equal(failure.completedResults.startedCases, 2);
      assert.equal(failure.completedResults.plannedCases, 2);
      assert.doesNotMatch(result.stdout, /Raw JSON:|Interpretation/);
    } finally { f.cleanup(); }
  }
});

test("raw reports and failure diagnostics do not retain provider text, stderr or unknown sidecar fields", () => {
  const canary = "PRIVATE_PROVIDER_CONTENT_DO_NOT_REPORT_8924";
  for (const code of ["0", "3"]) {
    const f = fixture();
    try {
      const result = f.run([], { ...shortRun, BENCH_TEST_CANARY: canary, BENCH_TEST_EXIT: code });
      assert.equal(result.status, code === "0" ? 0 : 1, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(canary));
      if (result.raw) {
        assert.equal(result.raw.results[0].stderrChars, canary.length);
        assert.equal(result.raw.results[0].stdoutTail, undefined);
        assert.equal(result.raw.results[0].stderrTail, undefined);
        assert.equal(result.raw.results[0].observation.privateUnknownField, undefined);
      } else assert.equal(result.calls.length, 1);
    } finally { f.cleanup(); }
  }
});

test("completion marker must be final and oversized output stops without a replacement case", () => {
  for (const overrides of [{ BENCH_TEST_MARKER: "middle" }, { BENCH_TEST_CHARS: String(5 * 1024 * 1024) }] as Record<string, string>[]) {
    const f = fixture();
    try {
      const result = f.run([], { ...shortRun, ...overrides });
      assert.equal(result.status, 1);
      assert.equal(result.calls.length, 1);
      assert.match(result.stderr, /invalid benchmark response|outputLimitExceeded=true/);
    } finally { f.cleanup(); }
  }
});

test("opt-in fixed workload validates the exact output without changing profiles, budgets or custom-prompt precedence", () => {
  for (const variant of ["valid", "invalid", "custom"] as const) {
    const f = fixture();
    try {
      const result = f.run([], {
        ...shortRun, PST_BENCH_WORKLOAD: "fixed", PST_BENCH_MIN_CHARS: "0",
        ...(variant === "custom" ? { PST_BENCH_PROMPT: "Custom BENCHMARK_COMPLETE" } : { BENCH_TEST_FIXED: variant }),
      });
      assert.equal(result.status, variant === "invalid" ? 1 : 0, result.stderr);
      if (variant === "invalid") {
        assert.equal(result.calls.length, 1);
        assert.match(result.stderr, /exactOutput=false/);
      } else {
        assert.equal(result.calls.length, 2);
        assert.equal(result.raw.workload, "fixed");
        assert.equal(result.raw.outputValidation, variant === "custom" ? "marker-and-minimum" : "exact-fixed-sequence");
        assert.equal(result.raw.promptSource, variant === "custom" ? "text" : "builtin");
      }
    } finally { f.cleanup(); }
  }
});
