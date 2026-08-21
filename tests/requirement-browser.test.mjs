import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { requirementIndex, searchRequirements } from "../codex/skills/information-accessibility-practice/scripts/requirements.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");

test("requirement index exposes complete active profiles and WCAG/JIS relations", () => {
  const rows = requirementIndex();
  assert.equal(rows.filter((row) => row.profile_id === "web-modern").length, 55);
  assert.equal(rows.filter((row) => row.profile_id === "jp-public-web").length, 56);
  const jis = rows.find((row) => row.requirement_id === "JIS-X-8341-3-2016-SC-1.1.1");
  assert.ok(jis.related_requirement_ids.includes("WCAG-2.2-SC-1.1.1"));
});

test("search works with Japanese human terms instead of internal IDs", () => {
  const results = searchRequirements("フォーカス", { profile: "web-modern" });
  assert.ok(results.length > 0);
  assert.ok(results.every((row) => row.method_key === "navigation-and-focus"));
});

test("CLI show accepts a success-criterion number", () => {
  const result = spawnSync(process.execPath, [cli, "requirements", "show", "1.1.1", "--profile", "web-modern"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.index.requirement_id, "WCAG-2.2-SC-1.1.1");
  assert.ok(value.detail.procedure_binding);
});

test("CLI list filters by level and procedure availability", () => {
  const result = spawnSync(process.execPath, [cli, "requirements", "list", "--profile", "web-modern", "--level", "AA", "--procedure", "available"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.ok(value.every((row) => row.level === "AA" && row.procedure_available));
});
