import assert from "node:assert/strict";
import test from "node:test";
import { createFixHandoff, recordExecutedChange } from "../codex/skills/information-accessibility-practice/scripts/lib/change-provenance.mjs";

const handoff = createFixHandoff({
  handoffId: "HANDOFF-1",
  runId: "RUN-1",
  planner: { role_id: "remediation_planner", producer_kind: "ai_agent", producer_id: "planner-agent" },
  findingIds: ["FINDING-1"],
  proposedChanges: ["Associate the dialog heading with aria-labelledby."],
  createdAt: "2026-08-22T00:00:00Z"
});

test("the change record producer is the executor while planning provenance remains separate", () => {
  const record = recordExecutedChange({
    changeId: "CHANGE-1",
    runId: "RUN-1",
    handoff,
    executor: { producer_kind: "external_human", role_id: "developer", actor_id: "dev@example.invalid" },
    targetBeforeSnapshotId: "TARGET-1",
    targetAfterSnapshotId: "TARGET-2",
    changedFiles: ["src/dialog.js"],
    executedActions: ["Updated aria-labelledby."],
    verificationEvidenceRefs: ["EVIDENCE-DIFF-1"],
    executedAt: "2026-08-22T01:00:00Z"
  });
  assert.equal(record.producer.actor_id, "dev@example.invalid");
  assert.equal(record.payload.executor.actor_id, "dev@example.invalid");
  assert.equal(record.payload.planning_source.producer.role_id, "remediation_planner");
  assert.notDeepEqual(record.producer, record.payload.planning_source.producer);
  assert.equal(record.payload.retest_status, "required");
});

test("a remediation planner cannot be recorded as the executor", () => {
  assert.throws(() => recordExecutedChange({
    changeId: "CHANGE-AI",
    runId: "RUN-1",
    handoff,
    executor: { producer_kind: "ai_agent", role_id: "remediation_planner", actor_id: "planner-agent" },
    targetBeforeSnapshotId: "TARGET-1",
    targetAfterSnapshotId: "TARGET-2",
    changedFiles: ["src/dialog.js"],
    executedAt: "2026-08-22T01:00:00Z"
  }), /change executor|Change producer/u);
});

test("changes require a matching handoff run and a changed target", () => {
  assert.throws(() => recordExecutedChange({
    changeId: "CHANGE-2",
    runId: "RUN-OTHER",
    handoff,
    executor: { producer_kind: "authorized_fixer", role_id: "authorized_fixer", actor_id: "fixer-1" },
    targetBeforeSnapshotId: "TARGET-1",
    targetAfterSnapshotId: "TARGET-2",
    changedFiles: ["src/dialog.js"],
    executedAt: "2026-08-22T01:00:00Z"
  }), /same run/u);
  assert.throws(() => recordExecutedChange({
    changeId: "CHANGE-3",
    runId: "RUN-1",
    handoff,
    executor: { producer_kind: "authorized_fixer", role_id: "authorized_fixer", actor_id: "fixer-1" },
    targetBeforeSnapshotId: "TARGET-1",
    targetAfterSnapshotId: "TARGET-1",
    changedFiles: ["src/dialog.js"],
    executedAt: "2026-08-22T01:00:00Z"
  }), /changed target/u);
});
