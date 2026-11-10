import test from "node:test";
import assert from "node:assert/strict";
import { formatStatus, isStatusFormat, MAX_STATUS_FORMAT_LENGTH, STATUS_FORMAT_PRESETS } from "./status-format.ts";

const parts = { label: "service_tier", symbol: "⚡", tier: "priority", support: "fallback", fallback: "default" };

test("status templates reorder, repeat and omit segments without evaluating expressions", () => {
  assert.equal(formatStatus(parts, "{symbol} {tier} | {support}"), "⚡ priority | fallback");
  assert.equal(formatStatus(parts, "{support} / {tier} / {tier}"), "fallback / priority / priority");
  assert.equal(formatStatus(parts, "{support} | {fallback}"), "fallback | default");
  assert.equal(formatStatus({ ...parts, fallback: "" }, "{support} | {fallback}"), "fallback | ");
  assert.equal(formatStatus(parts, "{label}"), "service_tier");
  assert.equal(formatStatus(parts, "custom footer"), "custom footer");
});

test("omitted or malformed templates use the long template; empty templates hide normal status", () => {
  assert.equal(formatStatus(parts), "service_tier: ⚡ priority | fallback | default");
  assert.equal(formatStatus(parts, STATUS_FORMAT_PRESETS.long), formatStatus(parts));
  assert.equal(formatStatus(parts, "{unknown}"), formatStatus(parts));
  assert.equal(formatStatus(parts, ""), undefined);
  assert.equal(formatStatus(parts, "   "), undefined);
});

test("literal braces are escaped and inserted segment values are never recursively formatted", () => {
  assert.ok(isStatusFormat("{{{tier}}}"));
  assert.equal(formatStatus(parts, "{{{tier}}}"), "{priority}");
  assert.equal(formatStatus({ ...parts, support: "{tier}" }, "{support}"), "{tier}");
  assert.equal(formatStatus({ ...parts, fallback: "{tier}" }, "{fallback}"), "{tier}");
});

test("unknown placeholders, unmatched braces, control characters and oversized templates are invalid", () => {
  for (const value of [null, 3, {}, "{unknown}", "{tier", "tier}", "{constructor}", "{__proto__}", "{tier.toUpperCase()}", "\n", "\t", "\u001b[31m", "\u009b31m", "\u2028", "\u202e", "x".repeat(MAX_STATUS_FORMAT_LENGTH + 1)]) {
    assert.equal(isStatusFormat(value), false, JSON.stringify(value));
  }
  assert.equal(isStatusFormat("x".repeat(MAX_STATUS_FORMAT_LENGTH)), true);
  assert.ok(isStatusFormat("{symbol} 模式 {tier}"));
});

test("rendered segment data cannot inject terminal controls and inputs remain unchanged", () => {
  const unsafe = { ...parts, support: "\u001b[31mdefault\n\u202e" };
  const before = structuredClone(unsafe);
  assert.equal(formatStatus(unsafe, "{support}"), "[31mdefault");
  assert.deepEqual(unsafe, before);
  assert.equal(formatStatus({ ...parts, support: "x".repeat(200) }, "{support}")?.length, 128);
  assert.equal(formatStatus({ ...parts, fallback: unsafe.support }, "{fallback}"), "[31mdefault");
});

test("template validation and formatting are deterministic across repeated calls", () => {
  for (let i = 0; i < 4; i++) {
    assert.equal(isStatusFormat("{symbol} {tier}"), true);
    assert.equal(formatStatus(parts, "{symbol} {tier}"), "⚡ priority");
    assert.equal(isStatusFormat("{bad}"), false);
  }
});
