import assert from "node:assert/strict";
import test from "node:test";
import { buildRetestDelta, renderRetestDelta } from "../codex/skills/information-accessibility-practice/scripts/lib/retest-delta.mjs";

const run = (id, version, predecessor = null) => ({ run_id: id, supersedes_run_id: predecessor,
  status: predecessor ? "initialized" : "retest_required", profile: { id: "web-modern" },
  target: { name: "Fixture", version_or_commit: version, urls_or_files: ["https://example.test/"] },
  scope: { included: ["https://example.test/"] }, environment: { os: ["fixture"] }, target_inventory: null });
const review = (id, outcome, findingId) => ({ requirement_id: id, profile_outcome: outcome,
  ...(findingId ? { finding: { id: findingId } } : {}) });
const envelope = (id, type, payload) => ({ artifact_id: id, artifact_type: type, payload });
const validation = (records) => ({ resources: { standardsRegistry: { profiles: [{ id: "web-modern", requirement_ids: ["R1", "R2", "R3", "R4"] }] } },
  envelopesById: new Map(records.map((record) => [record.artifact_id, { envelope: record }])) });
const screening = (id, signal_class, hash) => ({ requirement_id: id, signal_class,
  evidence_refs: hash ? [{ target_ref: "https://example.test/", evidence_type: "dom_snapshot", sha256: hash,
    captured_at: "2026-09-25T00:00:00Z", target_version: "fixture", target_snapshot_id: "SNAP", environment_ref: "fixture",
    target_context_sha256: "context" }] : [] });

test("retest delta separates human findings, profile outcomes, screening signals and declared changes", () => {
  const beforeRun = run("OLD", "v1"), afterRun = run("NEW", "v2", "OLD");
  const before = validation([
    envelope("H1", "declared-human-review", { schema_version: "2.0.0", reviews: [review("R1", "fail", "F1"), review("R2", "pass"), review("R3", "fail", "F3"), review("R4", "fail", "F4")] }),
    envelope("S1", "screening-observations", { observations: [screening("SCREEN-A", "candidate_issue"), screening("SCREEN-B", "no_automated_signal"), screening("SCREEN-C", "candidate_issue"), screening("SCREEN-E", "candidate_issue", "old-hash")] }),
    envelope("P1", "remediation-plan", { items: [{ remediation_id: "M1", finding_id: "F1", requirement_ids: ["R1"], basis: "verified_failure" }] }),
    envelope("P2", "remediation-plan", { items: [{ remediation_id: "M2", finding_id: "F1", requirement_ids: ["R1"], basis: "verified_failure" }] }),
    envelope("C1", "declared-change-record", { remediation_ids: ["M1"] }),
    envelope("A1", "fix-authorization", { remediation_artifact: { artifact_id: "P2" } }),
    envelope("C2", "change-record", { authorization_artifact: { artifact_id: "A1" } })
  ]);
  const after = validation([
    envelope("H2", "declared-human-review", { schema_version: "2.0.0", reviews: [review("R1", "pass"), review("R2", "fail", "F2"), review("R3", "fail", "F3-NEW")] }),
    envelope("S2", "screening-observations", { observations: [screening("SCREEN-A", "no_automated_signal"), screening("SCREEN-B", "candidate_issue"), screening("SCREEN-D", "candidate_issue"), screening("SCREEN-X", "candidate_issue", "new-hash")] })
  ]);
  const delta = buildRetestDelta(beforeRun, before, afterRun, after,
    { finding_ids: { F3: "F3-NEW" }, screening_ids: { "SCREEN-E": "SCREEN-X" } });
  assert.deepEqual(Object.fromEntries(delta.findings.map((row) => [row.before_finding_id, row.status])),
    { F1: "resolved", F3: "unresolved", F4: "not_retested" });
  assert.equal(delta.findings.find((row) => row.before_finding_id === "F3").relation, "explicit_mapping");
  assert.deepEqual(delta.new_findings.map((row) => [row.finding_id, row.status]), [["F2", "regressed"]]);
  assert.deepEqual(Object.fromEntries(delta.profile_outcomes.map((row) => [row.requirement_id, row.status])),
    { R1: "improved", R2: "regressed", R3: "unresolved", R4: "not_retested" });
  assert.deepEqual(Object.fromEntries(delta.screening_candidates.map((row) => [row.before_id, row.status])),
    { "SCREEN-A": "improved_unverified", "SCREEN-B": "regressed", "SCREEN-C": "not_retested", "SCREEN-E": "unresolved" });
  assert.deepEqual(delta.new_screening_candidates.map((row) => row.id), ["SCREEN-D"]);
  assert.deepEqual(delta.evidence_comparisons.map((row) => [row.requirement_id, row.status]), [["SCREEN-E", "bytes_changed"]]);
  assert.deepEqual(delta.remediation, [{ remediation_id: "M1", status: "declared_change_recorded" },
    { remediation_id: "M2", status: "authorized_plan_change_recorded" }]);
  assert.match(renderRetestDelta(delta), /旧指摘[\s\S]*F4[\s\S]*not_retested/);
});

test("unmapped new ID stays new, scope drift blocks resolution, and invalid mappings fail", () => {
  const beforeRun = run("OLD", "v1"), afterRun = run("NEW", "v2", "OLD");
  const before = validation([envelope("H1", "declared-human-review", { schema_version: "2.0.0", reviews: [review("R1", "fail", "F1")] })]);
  const after = validation([envelope("H2", "declared-human-review", { schema_version: "2.0.0", reviews: [review("R1", "fail", "F-NEW")] })]);
  const delta = buildRetestDelta(beforeRun, before, afterRun, after);
  assert.equal(delta.findings[0].status, "unresolved");
  assert.equal(delta.findings[0].basis, "related_criterion_fail");
  assert.deepEqual(delta.new_findings.map((row) => row.finding_id), ["F-NEW"]);
  afterRun.scope = { included: ["https://example.test/changed"] };
  const drift = buildRetestDelta(beforeRun, before, afterRun, after);
  assert.equal(drift.comparable, false);
  assert.equal(drift.findings[0].status, "not_retested");
  assert.equal(drift.profile_outcomes.find((row) => row.requirement_id === "R1").status, "not_comparable");
  const noLonger = validation([envelope("H3", "declared-human-review", { schema_version: "2.0.0", reviews: [review("R1", "not_applicable")] })]);
  afterRun.scope = beforeRun.scope;
  const noLongerDelta = buildRetestDelta(beforeRun, before, afterRun, noLonger);
  assert.equal(noLongerDelta.findings[0].status, "no_longer_applicable");
  assert.equal(noLongerDelta.profile_outcomes.find((row) => row.requirement_id === "R1").status, "no_longer_applicable");
  assert.throws(() => buildRetestDelta(beforeRun, before, afterRun, after, { finding_ids: { F1: "unknown" } }), /unknown ID/);
  assert.throws(() => buildRetestDelta(beforeRun, before, { ...afterRun, supersedes_run_id: "OTHER" }, after), /successor/);
});
