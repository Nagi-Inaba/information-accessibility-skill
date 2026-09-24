import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cli, pass, read } from "./helpers/scanner-import.mjs";
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";

const example = fileURLToPath(new URL("../examples/run-backed-web-audit/run.mjs", import.meta.url));
const statusSchema = read(fileURLToPath(new URL("../codex/skills/information-accessibility-practice/references/audit-status.schema.json", import.meta.url)));
const save = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const reject = (result, pattern) => { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); };

test("finding lifecycle keeps a hash-linked history, private ownership and separate overdue/exception alerts", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "finding-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  pass(spawnSync(process.execPath, [example, "--output", root], { encoding: "utf8", shell: false }));
  const scenario = path.join(root, "human-reviewed"), artifacts = path.join(scenario, "artifacts");
  const run = path.join(scenario, "audit-run.json"), assessment = path.join(scenario, "merged-assessment.json");
  const first = path.join(artifacts, "lifecycle-1.json");
  pass(cli(["lifecycle", "init", "--run", run, "--finding", "REM-EXAMP002", "--updated-at", "2026-09-20T00:00:00Z", "--output", first]));
  assert.equal(read(first).state.status, "open");
  const initialStatus = cli(["status", "--run", run, "--lifecycle", first, "--as-of", "2026-09-26", "--format", "json"]);
  pass(initialStatus);
  assert.equal(JSON.parse(initialStatus.stdout).lifecycle[0].owner_missing, true);

  const patchFile = path.join(artifacts, "lifecycle-patch.json");
  save(patchFile, { status: "planned", assignee: "Private Assignee", accountable_owner: "Private Owner",
    due_on: "2026-09-22", target_release: "v1.4", external_issues: [{ system: "tracker", id: "SECRET-123" }],
    updated_at: "2026-09-21T00:00:00Z" });
  const second = path.join(artifacts, "lifecycle-2.json");
  pass(cli(["lifecycle", "advance", "--run", run, "--before", first, "--input", patchFile, "--output", second]));
  const planned = JSON.parse(cli(["status", "--run", run, "--lifecycle", second, "--as-of", "2026-09-26", "--format", "json"]).stdout).lifecycle[0];
  assert.equal(planned.overdue, true);
  assert.equal(planned.owner_missing, false);
  assert.deepEqual(planned.external_issues, [{ system: "tracker", id: "SECRET-123" }]);

  save(patchFile, { status: "in_progress", decision: { type: "accepted_risk", approved_by: "Private Approver",
    rationale: "Missing expiry", expires_on: null, review_on: null }, updated_at: "2026-09-22T00:00:00Z" });
  reject(cli(["lifecycle", "advance", "--run", run, "--before", second, "--input", patchFile,
    "--output", path.join(artifacts, "invalid-exception.json")]), /expiry and review date/);
  save(patchFile, { status: "in_progress", decision: { type: "accepted_risk", approved_by: "Private Approver",
    rationale: "Time-limited decision", expires_on: "2026-09-24", review_on: "2026-09-23" },
  updated_at: "2026-09-22T00:00:00Z" });
  const third = path.join(artifacts, "lifecycle-3.json");
  pass(cli(["lifecycle", "advance", "--run", run, "--before", second, "--input", patchFile, "--output", third]));
  const statusResult = JSON.parse(cli(["status", "--run", run, "--lifecycle", third, "--as-of", "2026-09-26", "--format", "json"]).stdout);
  const status = statusResult.lifecycle[0];
  assert.equal(status.exception_expired, true);
  assert.equal(status.resolution_claim, "not_resolved");
  assert.deepEqual(status.history.map((item) => item.status), ["open", "planned", "in_progress"]);
  assert.deepEqual(validateJsonSchema(statusResult, statusSchema), []);

  const reportFile = path.join(scenario, "lifecycle-report.md");
  pass(cli(["report", "--run", run, "--assessment", assessment, "--lifecycle", third, "--as-of", "2026-09-26", "--output", reportFile]));
  const report = fs.readFileSync(reportFile, "utf8");
  assert.match(report, /改善管理状況[\s\S]*期限超過[\s\S]*accepted_risk[\s\S]*期限切れ/);
  assert.doesNotMatch(report, /Private Owner|Private Approver|SECRET-123/);
  const htmlFile = path.join(scenario, "lifecycle-report.html");
  pass(cli(["report", "--run", run, "--assessment", assessment, "--lifecycle", third, "--as-of", "2026-09-26",
    "--format", "html", "--output", htmlFile]));
  const html = fs.readFileSync(htmlFile, "utf8");
  assert.match(html, /<section id="finding-lifecycle">[\s\S]*期限超過[\s\S]*<\/main>/);
  assert.doesNotMatch(html, /Private Owner|Private Approver|SECRET-123/);

  save(patchFile, { status: "closed", decision: null, updated_at: "2026-09-23T00:00:00Z" });
  reject(cli(["lifecycle", "advance", "--run", run, "--before", third, "--input", patchFile,
    "--output", path.join(artifacts, "invalid-transition.json")]), /Invalid lifecycle transition/);
  save(patchFile, { status: "fixed", decision: null, updated_at: "2026-09-23T00:00:00Z" });
  const fixed = path.join(artifacts, "lifecycle-fixed.json");
  pass(cli(["lifecycle", "advance", "--run", run, "--before", third, "--input", patchFile, "--output", fixed]));
  save(patchFile, { status: "verified", updated_at: "2026-09-24T00:00:00Z" });
  reject(cli(["lifecycle", "advance", "--run", run, "--before", fixed, "--input", patchFile,
    "--output", path.join(artifacts, "missing-closure.json")]), /requires change, retest and verification evidence/);

  const changed = read(second); changed.state.due_on = "2026-10-01"; save(second, changed);
  reject(cli(["status", "--run", run, "--lifecycle", third, "--format", "json"]), /predecessor hash mismatch/);
});
