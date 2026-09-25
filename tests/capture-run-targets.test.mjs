import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAuditRun, writeNewJson } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { targetInventoryErrors } from "../codex/skills/information-accessibility-practice/scripts/lib/run-targets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-capture-targets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const artifactRoot = path.join(dir, "artifacts");
  fs.mkdirSync(artifactRoot);
  fs.writeFileSync(path.join(dir, "page.html"), "<main>Fixture</main>");
  const runFile = path.join(dir, "run.json");
  const run = createAuditRun({ runFile, artifactRoot, runId: "RUN-20260918T000000Z-CAPTURE1", profile: "web-modern",
    inspectionMode: "quick", inspectionPurpose: "Measure fixture identity",
    targetName: "Private fixture", targetVersion: "1", targetRefs: ["page.html"], network: "none", interaction: "safe_read_only", sourceWrite: "none" });
  writeNewJson(runFile, run);
  const specs = path.join(dir, "specs.json");
  writeNewJson(specs, [{ kind: "file", target_ref: "page.html" }]);
  return { dir, artifactRoot, runFile, run, specs, output: path.join(artifactRoot, "targets.json") };
}
function capture(f, extras = []) {
  return spawnSync(process.execPath, [cli, "capture-targets", "--run", f.runFile, "--specs", f.specs, "--output", f.output, ...extras], { encoding: "utf8", shell: false });
}

test("capture-targets writes a private measured companion without changing the run or target", (t) => {
  const f = fixture(t);
  const runBytes = fs.readFileSync(f.runFile);
  const targetBytes = fs.readFileSync(path.join(f.dir, "page.html"));
  const result = capture(f);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: "PASS", snapshots: 1, registered: false });
  assert.doesNotMatch(result.stdout, /page\.html|Private fixture/);
  const inventory = JSON.parse(fs.readFileSync(f.output, "utf8"));
  assert.deepEqual(targetInventoryErrors(inventory, f.run), []);
  assert.deepEqual(fs.readFileSync(f.runFile), runBytes);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, "page.html")), targetBytes);
  const again = capture(f);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /overwrite/);
});

test("capture-targets refuses output outside the artifact root and extra or malformed target specifications", (t) => {
  const f = fixture(t);
  let result = capture({ ...f, output: path.join(f.dir, "outside.json") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private artifact root/);
  assert.equal(fs.existsSync(path.join(f.dir, "outside.json")), false);
  fs.writeFileSync(f.specs, JSON.stringify([{ kind: "file", target_ref: "unrequested.html" }]));
  result = capture(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly the run target/);
  assert.equal(fs.existsSync(f.output), false);
  result = capture(f, ["--allow-localhost", "yes"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit value true/);
});

test("capture-targets help clearly distinguishes capture from registration", () => {
  const result = spawnSync(process.execPath, [cli, "capture-targets", "--help"], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /unregistered private companion/);
  assert.match(result.stdout, /--allow-origin/);
});
