import assert from "node:assert/strict";
import test from "node:test";
import { compareAssessmentResults } from "../codex/skills/information-accessibility-practice/scripts/lib/run-comparison.mjs";

const row = (id, outcome, evidence = []) => ({ requirement_id: id, requirement_kind: "profile_requirement", mapping_status: outcome === "not_tested" ? "unverified" : "human_verified", outcome, evidence });
const record = (rows) => ({ assessment: { results: rows } });

test("resolved, persistent, regressed, and newly evaluated failures are separated", () => {
  const result = compareAssessmentResults(
    record([
      row("A", "fail", [{ old: true }]),
      row("B", "fail", [{ old: true }]),
      row("C", "pass", [{ old: true }]),
      row("D", "not_tested")
    ]),
    record([
      row("A", "pass", [{ current: true }]),
      row("B", "fail", [{ current: true }]),
      row("C", "fail", [{ current: true }]),
      row("D", "fail", [{ current: true }])
    ]),
    { beforeTargetSnapshotId: "TARGET-V1", afterTargetSnapshotId: "TARGET-V2" }
  );
  const byId = new Map(result.rows.map((item) => [item.requirement_id, item]));
  assert.equal(byId.get("A").classification, "resolved");
  assert.equal(byId.get("B").classification, "still_failing");
  assert.equal(byId.get("C").classification, "regressed");
  assert.equal(byId.get("D").classification, "newly_evaluated_failure");
  assert.equal(result.target_changed, true);
});

test("a current untested row never inherits the prior result or evidence", () => {
  const result = compareAssessmentResults(
    record([row("A", "fail", [{ prior: 1 }, { prior: 2 }])]),
    record([row("A", "not_tested", [])])
  );
  assert.equal(result.rows[0].classification, "not_retested");
  assert.equal(result.rows[0].after_outcome, "not_tested");
  assert.equal(result.rows[0].current_evidence_count, 0);
  assert.equal(result.rows[0].previous_evidence_count, 2);
  assert.equal(result.rows[0].evidence_used_for_current_result, "after_run_only");
  assert.equal(result.evidence_policy, "current_run_only");
});

test("duplicate requirement rows fail closed", () => {
  assert.throws(() => compareAssessmentResults(record([row("A", "pass"), row("A", "fail")]), record([])), /Duplicate requirement_id/u);
});
