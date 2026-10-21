import test from "node:test";
import assert from "node:assert/strict";
import { extensionMessage, notify } from "./extension-ui.ts";

const prefix = "[pi-provider-service-tier]";

test("extension messages identify their origin, including empty and multiline messages", () => {
  for (const message of ["", "Ready.", "Unknown support.\nPaid probes need approval."]) {
    assert.equal(extensionMessage(message), `${prefix} ${message}`);
  }
});

test("existing extension and version prefixes are preserved without duplication", () => {
  for (const message of [`${prefix} Authentication changed.`, "[pi-provider-service-tier v0.1.7] Removed legacy preset information."]) {
    assert.equal(extensionMessage(message), message);
    assert.equal(extensionMessage(extensionMessage(message)), message);
  }
});

test("a filename, another extension, or a similar name cannot suppress the origin label", () => {
  for (const message of [
    "Could not use /tmp/pi-provider-service-tier.json.",
    "[other-extension] Ready.",
    "[pi-provider-service-tier-other] Ready.",
  ]) assert.equal(extensionMessage(message), `${prefix} ${message}`);
});

test("notification branding preserves severity, the UI receiver and shared UI methods", () => {
  const messages: Array<{ message: string; type?: string }> = [];
  const ui = {
    notify(message: string, type?: string) {
      assert.equal(this, ui);
      messages.push({ message, type });
    },
  };
  const original = ui.notify;
  const ctx = { ui } as never;
  for (const type of [undefined, "info", "warning", "error"] as const) notify(ctx, "Ready.", type);
  notify(ctx, "[pi-provider-service-tier v0.1.7] Removed legacy preset information.", "warning");
  assert.deepEqual(messages.slice(0, 4), [undefined, "info", "warning", "error"].map((type) => ({ message: `${prefix} Ready.`, type })));
  assert.equal(messages[4].message, "[pi-provider-service-tier v0.1.7] Removed legacy preset information.");
  assert.equal(ui.notify, original);
});
