import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadAuditResources } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const schemaPath = path.join(skill, "references/screening-observations.schema.json");
const schemaBytes = fs.readFileSync(schemaPath);
const schema = JSON.parse(schemaBytes.toString("utf8"));

function payload(profileRequirementId) {
  return {
    schema_version: "2.0.0",
    observations: [{
      requirement_id: "SCREEN-ADDITIONAL-FOCUS",
      evidence_level: "E1",
      method: "browser inspection",
      location: "https://example.invalid/",
      observation: "The focus indicator was obscured.",
      captured_at: "2026-08-21T00:00:00Z",
      profile_requirement_id: profileRequirementId,
      report_outcome: "fail",
      applicability: "applicable",
      report_rationale: "The visible focus indicator was obscured."
    }]
  };
}

test("screening schema accepts additional WCAG requirements registered by jp-public-web", () => {
  const errors = [];
  validateJsonSchema(payload("WCAG-2.2-ADDITIONAL-SC-2.4.11"), schema, "$", errors);
  assert.deepEqual(errors, []);

  const invalidErrors = [];
  validateJsonSchema(payload("WCAG-2.2-OTHER-SC-2.4.11"), schema, "$", invalidErrors);
  assert.ok(invalidErrors.some((error) => error.includes("profile_requirement_id")));
});

test("screening schema hash remains synchronized with the runtime manifest", () => {
  const resources = loadAuditResources(skill);
  const manifest = resources.orchestrationRegistry.artifact_types
    .find((artifactType) => artifactType.id === "screening-observations");
  const current = manifest.schema_versions.find((entry) => entry.mode === "current");
  const normalized = Buffer.from(schemaBytes.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
  assert.equal(crypto.createHash("sha256").update(normalized).digest("hex"), current.schema_sha256);
});
