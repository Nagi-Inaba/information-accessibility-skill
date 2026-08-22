import assert from "node:assert/strict";
import test from "node:test";
import { createDeclaredChangeRecord, declaredChangeSupportsRetest } from "../codex/skills/information-accessibility-practice/scripts/lib/declared-change-record.mjs";

const base = {
  runId: "RUN-OLD",
  changeId: "CHANGE-1",
  actor: { producer_kind: "external_human", actor_id: "developer@example.invalid" },
  sourceTargetSnapshotId: "TARGET-BEFORE",
  changedTargetSnapshotId: "TARGET-AFTER",
  oldVersion: "v1",
  newVersion: "v2",
  changedFiles: ["src/dialog.js", "src/dialog.js"],
  actions: ["Associated the dialog heading with aria-labelledby."],
  evidenceReferences: [{ path: "evidence/change.diff", sha256: "a".repeat(64) }],
  declaredAt: "2026-08-22T03:04:05Z"
};

test("an external change record supports a fresh retest without carrying outcomes", () => {
  const record = createDeclaredChangeRecord(base);
  assert.equal(record.producer.producer_kind, "external_human");
  assert.deepEqual(record.payload.changed_files, ["src/dialog.js"]);
  assert.equal(record.payload.outcome_carryover, "forbidden");
  assert.equal(record.payload.retest_requirement, "fresh_current_run");
  assert.equal(declaredChangeSupportsRetest(record), true);
});

test("AI agents cannot claim external changes and target snapshots must change", () => {
  assert.throws(() => createDeclaredChangeRecord({ ...base, actor: { producer_kind: "ai_agent", actor_id: "model" } }), /external human or manual operator/u);
  assert.throws(() => createDeclaredChangeRecord({ ...base, changedTargetSnapshotId: "TARGET-BEFORE" }), /distinct target snapshot/u);
});

test("unsafe files, weak evidence hashes, and unchanged versions fail closed", () => {
  assert.throws(() => createDeclaredChangeRecord({ ...base, changedFiles: ["../secret.txt"] }), /normalized relative paths/u);
  assert.throws(() => createDeclaredChangeRecord({ ...base, evidenceReferences: [{ path: "evidence/x", sha256: "abc" }] }), /SHA-256/u);
  assert.throws(() => createDeclaredChangeRecord({ ...base, newVersion: "v1" }), /distinct non-empty values/u);
});
