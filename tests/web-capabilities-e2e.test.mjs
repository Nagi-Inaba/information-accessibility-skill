import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const cli = path.resolve("codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");
const enabled = process.env.RUN_WEB_CAPABILITIES_E2E === "1";
function run(extra = []) {
  return spawnSync(process.execPath, [cli, "preflight-web", "--format", "json",
    ...(process.env.A11Y_BROWSER_CHANNEL ? ["--browser-channel", process.env.A11Y_BROWSER_CHANNEL] : []), ...extra], {
    encoding: "utf8", timeout: 65_000
  });
}

test("real browser preflight measures DOM, AX, Tab, viewport and blocked request channels on an isolated fixture", { skip: !enabled }, () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "ready");
  for (const id of ["browser_dom", "accessibility_tree", "keyboard_input", "responsive_viewport", "network_fetch"]) {
    assert.equal(report.capabilities.find((item) => item.id === id).status, "available", id);
  }
  assert.equal(report.runtime.playwright_version, "1.62.1");
  assert.ok(report.runtime.browser_version.length > 0);
  assert.equal(report.target_inspected, false);
  assert.equal(report.inspection_complete, false);
  assert.equal(report.profile_outcomes_written, false);
  assert.ok(report.capabilities.every((item) => item.target_check_status === "unconfirmed"));
  assert.deepEqual(report.unconfirmed_checks.map((item) => item.capability), ["screen_reader_runtime"]);
});

test("an explicitly required screen-reader session blocks even when real browser fixture checks succeed", { skip: !enabled }, () => {
  const result = run(["--require", "browser_dom,screen_reader_runtime"]);
  assert.equal(result.status, 4, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.capabilities.find((item) => item.id === "browser_dom").status, "available");
  assert.deepEqual(report.missing_required, ["screen_reader_runtime"]);
  assert.match(report.unconfirmed_checks[0].next_test, /human screen-reader session/);
});
