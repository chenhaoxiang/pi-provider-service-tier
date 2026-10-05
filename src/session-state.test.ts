import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionFastState,
  fastPayload,
  fastStatusText,
  isGptFastModel,
  restoreSessionFastState,
  SESSION_FAST_STATE_ENTRY,
} from "./session-state.ts";

const gptResponses = { id: "gpt-6.1-sol", api: "openai-responses" };
const gptCompletions = { id: "gpt-5.6-sol", api: "openai-completions" };
const kimi = { id: "kimi-k3", api: "openai-responses" };

test("limits session Fast mode to GPT models on supported OpenAI APIs", () => {
  assert.equal(isGptFastModel(gptResponses), true);
  assert.equal(isGptFastModel(gptCompletions), true);
  assert.equal(isGptFastModel(kimi), false);
  assert.equal(isGptFastModel({ id: "gpt-6.1-sol", api: "anthropic-messages" }), false);
});

test("restores only the latest session override on the active branch", () => {
  const state = restoreSessionFastState([
    { type: "custom", customType: SESSION_FAST_STATE_ENTRY, data: createSessionFastState(true) },
    { type: "message" },
    { type: "custom", customType: SESSION_FAST_STATE_ENTRY, data: createSessionFastState(false) },
  ]);
  assert.equal(state.override, true);
  assert.equal(state.active, false);

  const fresh = restoreSessionFastState([]);
  assert.equal(fresh.override, false);
  assert.equal(fresh.active, false);
});

test("injects priority and removes a persistent tier for a session-local off override", () => {
  assert.deepEqual(
    fastPayload({ model: "gpt-6.1-sol", input: [] }, gptResponses, createSessionFastState(true)),
    { model: "gpt-6.1-sol", input: [], service_tier: "priority" },
  );
  assert.deepEqual(
    fastPayload(
      { model: "gpt-6.1-sol", input: [], service_tier: "priority" },
      gptResponses,
      createSessionFastState(false),
    ),
    { model: "gpt-6.1-sol", input: [] },
  );
  assert.equal(fastPayload({ model: "kimi-k3", service_tier: "priority" }, kimi, createSessionFastState(true)), undefined);
});

test("renders a bottom status label without claiming upstream success", () => {
  assert.match(fastStatusText(gptResponses, createSessionFastState(true)) ?? "", /Fast 开启/);
  assert.match(fastStatusText(gptResponses, createSessionFastState(false, "unsupported")) ?? "", /已降级/);
  assert.equal(fastStatusText(kimi, createSessionFastState(true)), undefined);
});
