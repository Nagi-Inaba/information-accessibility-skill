import assert from "node:assert/strict";
import test from "node:test";
import { planAuditRunMigration, supportedAuditRunVersions } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run-migration.mjs";

test("v5 to v6 planning is non-destructive and preserves claim boundaries", () => {
  const source = {
    schema_version: "5.0.0",
    run_id: "RUN-OLD",
    status: "initialized",
    target: { name: "Example", version_or_commit: "v1", urls_or_files: ["https://example.invalid/"] },
    profile: { id: "web-modern", registry_version: "1.0.0" },
    permissions: { network: "denied", interaction: "read_only", source_write: "denied" },
    artifacts: [],
    history: [],
    limitations: [],
    claim: { requested_tier: "reference_only" }
  };
  const before = structuredClone(source);
  const plan = planAuditRunMigration(source, { migratedAt: "2026-08-22T00:00:00Z" });
  assert.deepEqual(source, before);
  assert.equal(plan.record.source_schema_version, "5.0.0");
  assert.equal(plan.record.target_schema_version, "6.0.0");
  assert.equal(plan.candidate.schema_version, "6.0.0");
  assert.equal(plan.candidate.claim.requested_tier, "reference_only");
  assert.equal(plan.record.claim_policy, "preserve_or_lower");
  assert.match(plan.record.source_sha256, /^[a-f0-9]{64}$/u);
});

test("current runs produce an explicit no-op plan", () => {
  const plan = planAuditRunMigration({ schema_version: "6.0.0", run_id: "RUN-CURRENT" });
  assert.equal(plan.record.mode, "no_op");
  assert.equal(plan.candidate.schema_version, "6.0.0");
});

test("unsupported versions fail closed", () => {
  assert.deepEqual(supportedAuditRunVersions, ["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0", "6.0.0"]);
  assert.throws(() => planAuditRunMigration({ schema_version: "7.0.0" }), /Unsupported audit-run schema/u);
});
