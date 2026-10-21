import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  settings: { retry: { enabled: boolean; maxRetries: number; provider: { maxRetries: number } }; compaction: { enabled: boolean } };
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "pst-benchmark-test-"));
  const records = join(home, "calls.jsonl");
  const executable = join(home, "fake-pi.mjs");
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const cwd = process.cwd();
const config = JSON.parse(readFileSync(join(cwd, ".pi/extensions/pi-provider-service-tier.json"), "utf8"));
const settings = JSON.parse(readFileSync(join(cwd, ".pi/settings.json"), "utf8"));
const [[modelKey, entry]] = Object.entries(config.entries);
appendFileSync(process.env.BENCH_TEST_RECORDS, JSON.stringify({ args: process.argv.slice(2), cwd, modelKey, ...entry, settings }) + "\\n");
process.stdout.write("x".repeat(Number(process.env.BENCH_TEST_CHARS || 5000)) + "\\nBENCHMARK_COMPLETE\\n");
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
        assert.equal(option(row.args, "--model"), model);
        assert.equal(option(row.args, "--thinking"), thinking);
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
