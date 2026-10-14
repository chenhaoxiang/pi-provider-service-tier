import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, type Api, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { streamSimple as responsesStream } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as completionsStream } from "@earendil-works/pi-ai/api/openai-completions";
import { _test } from "./index.ts";

// Exercise the real Pi 1.1.0 serializers and raw stream callbacks, but replace
// every HTTP response locally. The credential is a nonfunctional test string.
for (const api of ["openai-responses", "openai-completions"] as const) {
  test(`Pi 1.1.0 ${api} forwards prepared payloads and observed tier fields without live HTTP`, async () => {
    const model = { provider: "openai", id: "gpt-5.5", api, name: "Offline fixture", baseUrl: "https://offline.invalid/v1", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 } as Model<Api>;
    const savedFetch = globalThis.fetch;
    let unexpected = 0;
    globalThis.fetch = async () => { unexpected++; throw new Error("Live network forbidden"); };
    try {
      for (const servedTier of ["priority", undefined, "default"]) {
        const bodies: Record<string, unknown>[] = [];
        const localFetch: typeof fetch = async (url, init) => {
          assert.ok(String(url).startsWith("https://offline.invalid/v1/"));
          assert.equal(typeof init?.body, "string");
          bodies.push(JSON.parse(init!.body as string));
          const reported = servedTier ? { service_tier: servedTier } : {};
          const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, input_tokens: 1, output_tokens: 1 };
          const event = api === "openai-responses"
            ? { type: "response.completed", response: { id: "resp_offline", status: "completed", output: [], usage, ...reported } }
            : { id: "chatcmpl-offline", object: "chat.completion.chunk", created: 0, model: model.id, choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }], usage, ...reported };
          return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
        };
        const ctx = { modelRegistry: { streamSimple: (requestModel: Model<Api>, context: Context, options: SimpleStreamOptions) => {
          const normalized = normalizeContext(context);
          const configured = { ...options, apiKey: "sk-test-not-real", fetch: localFetch };
          return api === "openai-responses" ? responsesStream(requestModel as Model<"openai-responses">, normalized, configured)
            : completionsStream(requestModel as Model<"openai-completions">, normalized, configured);
        } } } as never;
        const observation = await _test.defaultProbeTier(model, "fast", ctx);
        assert.equal(bodies.length, 1);
        assert.equal(bodies[0].service_tier, "fast");
        assert.equal(observation.kind, servedTier === "priority" ? "verified" : servedTier === "default" ? "fallback" : "request-completed");
        assert.equal(observation.result, servedTier === "priority" ? "supported" : "unknown");
        assert.equal(observation.servedTier, servedTier);
        if (api === "openai-responses") assert.equal(bodies[0].max_output_tokens, 16);
      }
      assert.equal(unexpected, 0);
    } finally { globalThis.fetch = savedFetch; }
  });
}
