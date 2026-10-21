import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../scripts/check-support-map-rollback.mjs", import.meta.url);
test("package-selection rollback checks target schema without touching current or backup data", () => {
  const dir = mkdtempSync(join(tmpdir(), "pst-rollback-"));
  const file = join(dir, "legacy.json");
  try {
    for (const [version, allowed] of [[2, true], [3, false], [4, false]] as const) {
      const bytes = JSON.stringify({ version, entries: {} }); writeFileSync(file, bytes);
      const result = spawnSync(process.execPath, [script.pathname, file, "2"], { encoding: "utf8" });
      assert.equal(result.status, allowed ? 0 : 1, result.stderr);
      assert.equal(readFileSync(file, "utf8"), bytes);
      if (!allowed) assert.match(result.stderr, /rollback refused.*cannot safely read/);
    }
    writeFileSync(file, "{broken");
    assert.equal(spawnSync(process.execPath, [script.pathname, file, "2"]).status, 1);
    assert.equal(readFileSync(file, "utf8"), "{broken");
    assert.equal(spawnSync(process.execPath, [script.pathname, join(dir, "absent.json"), "2"]).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
