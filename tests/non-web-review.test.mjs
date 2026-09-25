import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compareNonWebReviews, initNonWebReview, validateNonWebReview } from "../codex/skills/information-accessibility-practice/scripts/non-web-review.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");
const run = (...args) => spawnSync(process.execPath, [cli, "non-web-review", ...args], { cwd: root, encoding: "utf8" });

test("four non-Web target templates each route all five participation perspectives", () => {
  for (const kind of ["document-slide", "media-content", "event-community", "participation-workflow"]) {
    const record = initNonWebReview({ kind, id: "case-01", name: kind, version: "v1", scope: "One named target" });
    assert.deepEqual(validateNonWebReview(record), []);
    assert.deepEqual(record.checks.map((item) => item.perspective), ["find", "receive", "understand", "participate", "continue"]);
    assert.ok(record.checks.every((item) => item.outcome === "not_tested" && item.question.length > 0));
    assert.equal(record.claim_boundary, "participation_review_only");
  }
});

test("CLI creates, validates, reports, and compares non-Web human reviews without overwriting", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-non-web-review-"));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const before = path.join(directory, "before.json");
  const after = path.join(directory, "after.json");
  const report = path.join(directory, "report.md");
  const comparison = path.join(directory, "comparison.json");
  const init = run("init", "--kind", "event-community", "--id", "event-01", "--name", "Workshop", "--version", "v1",
    "--scope", "Registration and event day", "--output", before);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(run("validate", "--input", before).status, 0);
  const globalLocale = spawnSync(process.execPath, [cli, "--locale", "ja", "non-web-review", "validate", "--input", before], {
    cwd: root, encoding: "utf8"
  });
  assert.equal(globalLocale.status, 0, globalLocale.stderr);
  assert.notEqual(run("init", "--kind", "event-community", "--id", "event-01", "--name", "Workshop", "--version", "v1",
    "--scope", "Registration and event day", "--output", before).status, 0);

  const oldRecord = JSON.parse(fs.readFileSync(before, "utf8"));
  const revised = structuredClone(oldRecord);
  revised.target.version = "v2";
  revised.review_date = "2026-09-25";
  revised.checks[0] = {
    ...revised.checks[0], outcome: "issue", observation: "The registration link is missing.",
    reviewer_id: "reviewer-01", evidence_refs: ["private/registration-note.txt"],
    improvement: "Add a visible registration link.", retest_method: "Open the invitation and follow the link."
  };
  fs.writeFileSync(after, JSON.stringify(revised, null, 2), "utf8");
  assert.equal(run("validate", "--input", after).status, 0);
  assert.equal(run("report", "--input", after, "--output", report).status, 0);
  assert.match(fs.readFileSync(report, "utf8"), /規格適合の判定ではありません/u);
  assert.match(fs.readFileSync(report, "utf8"), /Add a visible registration link/u);
  assert.equal(run("compare", "--before", before, "--after", after, "--output", comparison, "--format", "json").status, 0);
  const delta = JSON.parse(fs.readFileSync(comparison, "utf8"));
  assert.equal(delta.changes.find((item) => item.id === "find").change, "changed");
  assert.equal(delta.changes.find((item) => item.id === "receive").change, "unchanged");
  assert.equal(delta.claim_boundary, "participation_review_only");
  assert.notEqual(run("report", "--input", after, "--output", report).status, 0);
});

test("review validation rejects unsupported claims and unevidenced issue resolution", () => {
  const record = initNonWebReview({ kind: "document-slide", id: "doc-01", name: "Guide", version: "v1", scope: "One PDF" });
  const otherScope = structuredClone(record);
  otherScope.target.scope = "Another PDF";
  assert.throws(() => compareNonWebReviews(record, otherScope), /same target ID, kind, and scope/u);
  record.claim_boundary = "WCAG_conformant";
  assert.ok(validateNonWebReview(record).length > 0);
  record.claim_boundary = "participation_review_only";
  record.review_date = "2026-09-25";
  record.checks[0].outcome = "issue";
  assert.ok(validateNonWebReview(record).some((error) => /reviewer_id|evidence_refs|improvement/u.test(error)));
});
