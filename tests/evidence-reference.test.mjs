import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceReference, validateEvidenceReference, verifyEvidenceReference } from "../codex/skills/information-accessibility-practice/scripts/lib/evidence-reference.mjs";

test("bytes produce an immutable target-bound evidence reference", () => {
  const bytes = Buffer.from('{"role":"button","name":"Continue"}');
  const reference = createEvidenceReference({
    evidenceType: "accessibility_tree",
    relativePath: "evidence/checkout.ax.json",
    bytes,
    capturedAt: "2026-08-22T01:02:03Z",
    environmentRef: "ENV-WIN11-CHROME-NVDA",
    targetSnapshotId: "TARGET-ABC"
  });
  assert.equal(validateEvidenceReference(reference).length, 0);
  assert.equal(reference.sha256.length, 64);
  assert.equal(verifyEvidenceReference(reference, bytes), true);
  assert.throws(() => verifyEvidenceReference(reference, Buffer.from("changed")), /hash mismatch/u);
});

test("unsafe paths, weak hashes, and missing bindings are rejected", () => {
  const errors = validateEvidenceReference({
    evidence_type: "dom_snapshot",
    path: "../private.html",
    sha256: "abc",
    captured_at: "2026-08-22T01:02:03+09:00",
    environment_ref: "",
    target_snapshot_id: ""
  });
  assert.ok(errors.some((error) => error.includes("relative")));
  assert.ok(errors.some((error) => error.includes("SHA-256")));
  assert.ok(errors.some((error) => error.includes("UTC")));
  assert.ok(errors.some((error) => error.includes("environment_ref")));
  assert.ok(errors.some((error) => error.includes("target_snapshot_id")));
});

test("unknown evidence types are retained as explicit validation errors", () => {
  const errors = validateEvidenceReference({
    evidence_type: "magic",
    path: "evidence/value.bin",
    sha256: "0".repeat(64),
    captured_at: "2026-08-22T01:02:03Z",
    environment_ref: "ENV-1",
    target_snapshot_id: "TARGET-1"
  });
  assert.ok(errors.some((error) => error.includes("evidence_type")));
});
