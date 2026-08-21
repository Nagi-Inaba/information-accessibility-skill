import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectCapabilities } from "../codex/skills/information-accessibility-practice/scripts/show-runtime-capabilities.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");

test("preflight distinguishes the installed control plane from missing host inspection capabilities", () => {
  const result = inspectCapabilities([]);
  assert.equal(result.web_inspection_ready, false);
  assert.ok(result.capabilities.find((item) => item.id === "record_control_plane").available);
  assert.ok(result.missing_required.includes("accessibility_tree"));
});

test("declared Web capabilities satisfy the preflight without claiming a screen reader runtime", () => {
  const provided = ["network_fetch", "browser_dom", "accessibility_tree", "keyboard_input", "responsive_viewport"];
  const result = inspectCapabilities(provided);
  assert.equal(result.web_inspection_ready, true);
  assert.deepEqual(result.missing_required, []);
  assert.deepEqual(result.missing_recommended, ["screen_reader_runtime"]);
});

test("unified CLI fails closed when required Web capabilities are absent", () => {
  const result = spawnSync(process.execPath, [cli, "capabilities", "--require-web"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const value = JSON.parse(result.stdout);
  assert.equal(value.web_inspection_ready, false);
});
