import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadAuditResources,
  validateArtifact
} from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const references = path.join(skillRoot, "references");
const runId = "RUN-20260718T010203Z-EXT00001";
const createdAt = "2026-07-18T01:02:03Z";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256NormalizedText(file) {
  const normalized = fs.readFileSync(file, "utf8").replace(/\r\n/gu, "\n");
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourceEntry, destinationEntry);
    else fs.copyFileSync(sourceEntry, destinationEntry);
  }
}

function withSkillCopy(t, name, callback) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `accessibility-ext-${name}-`));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const copiedSkill = path.join(temp, "information-accessibility-practice");
  copyDirectory(skillRoot, copiedSkill);
  return callback(copiedSkill);
}

function mutateRegistry(skill, mutate) {
  const file = path.join(skill, "references/orchestration-registry.json");
  const registry = readJson(file);
  mutate(registry);
  writeJson(file, registry);
  return registry;
}

function readOnlyRole(overrides = {}) {
  return {
    id: "structure_inspector",
    agent_id: "information-accessibility-structure-inspector",
    producer_kind: "ai_agent",
    input_types: [],
    output_type: "screening-observations",
    max_ai_evidence_level: "E1",
    can_record_profile_outcome: false,
    can_write_target: false,
    install_by_default: false,
    ...overrides
  };
}

function screeningPayload() {
  return {
    schema_version: "3.0.0",
    observations: [{
      requirement_id: "SCREEN-EXTENSION",
      evidence_level: "E1",
      signal_class: "inconclusive",
      human_review_required: true,
      method: "Read-only structural inspection",
      location: "main",
      observation: "A structural relationship requires human review.",
      captured_at: createdAt,
      evidence_provenance: {
        collection_method: "static_inspection",
        tool_name: null,
        tool_version: null,
        rule_id: null,
        target_dom: "main",
        viewport: null
      },
      profile_requirement_id: null,
      report_outcome: null,
      applicability: "undetermined",
      report_rationale: "This extension observation is not mapped to an exact profile requirement."
    }]
  };
}

function envelope(overrides = {}) {
  return {
    schema_version: "2.0.0",
    artifact_id: "ART-STRUCTURE-001",
    artifact_type: "screening-observations",
    run_id: runId,
    producer: {
      role_id: "structure_inspector",
      producer_kind: "ai_agent",
      origin: "extension fixture"
    },
    created_at: createdAt,
    inputs: [],
    payload: screeningPayload(),
    ...overrides
  };
}

test("frozen orchestration contracts retain their normalized hashes across line-ending conventions", () => {
  const frozenHashes = [
    ["orchestration-registry-3.0.0.json", "f57534c1e430050b6f559d6ae5859171487647346c13624aa58fc18127ed2864"],
    ["orchestration-registry-3.0.0.schema.json", "19903e95a727cca2b4002fa9c9d35b1cf0ddc4d4ac4d658cd28c7820f45b4105"],
    ["audit-run-4.0.0.schema.json", "afc3f0449963d49d2834c13842cecbbc46060695fcf67ab53c133f626df86ecf"],
    ["audit-artifact-envelope-1.0.0.schema.json", "37d60f9882298141a61e5764c1e8efdd9530e128d89b78658e01941d3c508f9b"],
    ["orchestration-registry-4.0.0.json", "04386c98acb727bbd5525aa8a6130a009aad6646144b586fe583362b900b5f34"],
    ["orchestration-registry-4.0.0.schema.json", "3154318524c69847154f369e8194e1ba960c91114afaf48793320ab0ee032a14"],
    ["audit-run-5.0.0.schema.json", "8cafbb4e31b37144895d4bed9ecc52cff0f158018002c1ae384ac48ee44b77d2"],
    ["screening-observations-1.0.0.schema.json", "f72f3bba32171f55935a39c6d94cc996cb8ebbbec940db2f423608c6949a1ff2"],
    ["orchestration-registry-5.0.0.json", "e29b40d8f5fe05ed7687ae23224ad3db49b23025b59f249341c2b55f5db38836"],
    ["orchestration-registry-5.0.0.schema.json", "dacec8cf20a22895541b5c8d19a8e28301d41c5e1a0412f3db57051b5f66ae93"],
    ["audit-run-6.0.0.schema.json", "9809a64eeb9b93394cf0213e7291e8bdf489853f6e8d660a6756cae32f2178a4"],
    ["screening-observations-2.0.0.schema.json", "c1d50902738383184fe5ca27831f65f8f6926214bc7370a4ada6752b326033fa"]
  ];
  for (const [frozen, expectedSha256] of frozenHashes) {
    assert.equal(sha256NormalizedText(path.join(references, frozen)), expectedSha256, frozen);
  }
  assert.equal(readJson(path.join(references, "orchestration-registry-3.0.0.json")).schema_version, "3.0.0");
  assert.equal(readJson(path.join(references, "audit-run-4.0.0.schema.json")).properties.schema_version.const, "4.0.0");
  assert.equal(readJson(path.join(references, "orchestration-registry-4.0.0.json")).schema_version, "4.0.0");
  assert.equal(readJson(path.join(references, "audit-run-5.0.0.schema.json")).properties.schema_version.const, "5.0.0");
  assert.equal(readJson(path.join(references, "screening-observations-1.0.0.schema.json")).properties.schema_version.const, "1.0.0");
  assert.equal(readJson(path.join(references, "audit-artifact-envelope-1.0.0.schema.json")).properties.schema_version.const, "1.0.0");
  assert.equal(readJson(path.join(references, "orchestration-registry.json")).schema_version, "6.0.0");
  assert.equal(readJson(path.join(references, "audit-run.schema.json")).properties.schema_version.const, "7.0.0");
  assert.equal(readJson(path.join(references, "screening-observations.schema.json")).properties.schema_version.const, "3.0.0");
  assert.equal(readJson(path.join(references, "audit-artifact-envelope.schema.json")).properties.schema_version.const, "2.0.0");
});

test("an eighth safe read-only role can use an existing registered artifact type", (t) => withSkillCopy(t, "role", (copiedSkill) => {
  mutateRegistry(copiedSkill, (registry) => registry.roles.push(readOnlyRole()));
  const resources = loadAuditResources(copiedSkill);
  const artifact = envelope();
  assert.deepEqual(validateJsonSchema(artifact, resources.envelopeSchema), []);
  assert.deepEqual(validateArtifact(artifact, resources, {
    allowedPayloadVersions: resources.currentPayloadVersions
  }).errors, []);
}));

test("a new read-only artifact type loads when its payload schema, role, and transition agree", (t) => withSkillCopy(t, "artifact", (copiedSkill) => {
  const referenceRoot = path.join(copiedSkill, "references");
  writeJson(path.join(referenceRoot, "structure-observations.schema.json"), {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:information-accessibility:structure-observations:1.0.0",
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "evidence_level", "observations"],
    properties: {
      schema_version: { const: "1.0.0" },
      evidence_level: { enum: ["E0", "E1", "E2"] },
      observations: { type: "array", items: { type: "string", minLength: 1 } }
    }
  });
  const schemaSha256 = sha256NormalizedText(path.join(referenceRoot, "structure-observations.schema.json"));
  mutateRegistry(copiedSkill, (registry) => {
    registry.roles.push(readOnlyRole({ output_type: "structure-observations" }));
    registry.artifact_types.push({
      id: "structure-observations",
      latest_schema_version: "1.0.0",
      schema_versions: [{
        version: "1.0.0",
        schema_file: "structure-observations.schema.json",
        schema_sha256: schemaSha256,
        mode: "current"
      }]
    });
    registry.transitions.push({
      from: "initialized",
      to: "structure_screened",
      required_artifact_types: ["structure-observations"]
    });
  });
  const resources = loadAuditResources(copiedSkill);
  const artifact = envelope({
    artifact_type: "structure-observations",
    payload: { schema_version: "1.0.0", evidence_level: "E1", observations: ["The relationship needs human review."] }
  });
  assert.deepEqual(validateArtifact(artifact, resources, {
    allowedPayloadVersions: resources.currentPayloadVersions
  }).errors, []);

  const elevated = structuredClone(artifact);
  elevated.payload.evidence_level = "E2";
  assert.match(validateArtifact(elevated, resources, {
    allowedPayloadVersions: resources.currentPayloadVersions
  }).errors.join("\n"), /exceeds.*E1|evidence.*E1/i);

  fs.appendFileSync(path.join(referenceRoot, "structure-observations.schema.json"), " ", "utf8");
  assert.throws(() => loadAuditResources(copiedSkill), /schema SHA-256 mismatch/i);
}));

test("every current payload schema manifest requires a SHA-256 binding", (t) => withSkillCopy(t, "missing-hash", (copiedSkill) => {
  mutateRegistry(copiedSkill, (registry) => {
    delete registry.artifact_types
      .find((item) => item.id === "screening-observations")
      .schema_versions.find((entry) => entry.mode === "current").schema_sha256;
  });
  assert.throws(() => loadAuditResources(copiedSkill), /schema_sha256|required/i);
}));

test("a frozen canonical schema hash cannot be replaced together with its schema", (t) => withSkillCopy(t, "canonical-hash-swap", (copiedSkill) => {
  const schemaFile = path.join(copiedSkill, "references/fix-authorization.schema.json");
  fs.appendFileSync(schemaFile, " ", "utf8");
  mutateRegistry(copiedSkill, (registry) => {
    registry.artifact_types
      .find((item) => item.id === "fix-authorization")
      .schema_versions.find((entry) => entry.mode === "current").schema_sha256 = sha256NormalizedText(schemaFile);
  });
  assert.throws(() => loadAuditResources(copiedSkill), /canonical artifact type manifest changed.*fix-authorization/i);
}));

test("the audit-run control-plane manifest cannot redefine its version, schema file, or current mode", (t) => {
  const cases = [
    ["schema-file", (copiedSkill, manifest) => {
      const source = path.join(copiedSkill, "references/audit-run.schema.json");
      const alternate = path.join(copiedSkill, "references/audit-run-current.schema.json");
      fs.copyFileSync(source, alternate);
      manifest.schema_versions.find((entry) => entry.mode === "current").schema_file = "audit-run-current.schema.json";
    }],
    ["unknown-version", (copiedSkill, manifest) => {
      const nextSchemaFile = path.join(copiedSkill, "references/audit-run-8.0.0.schema.json");
      const nextSchema = readJson(path.join(copiedSkill, "references/audit-run.schema.json"));
      nextSchema.$id = "urn:information-accessibility:audit-run:8.0.0";
      nextSchema.properties.schema_version.const = "8.0.0";
      writeJson(nextSchemaFile, nextSchema);
      manifest.schema_versions.find((entry) => entry.mode === "current").mode = "read_only";
      manifest.schema_versions.push({
        version: "8.0.0",
        schema_file: "audit-run-8.0.0.schema.json",
        schema_sha256: sha256NormalizedText(nextSchemaFile),
        mode: "current"
      });
      manifest.latest_schema_version = "8.0.0";
    }],
    ["mode", (copiedSkill, manifest) => {
      const current = manifest.schema_versions.find((entry) => entry.version === "7.0.0");
      const prior = manifest.schema_versions.find((entry) => entry.version === "6.0.0");
      current.mode = "read_only";
      prior.mode = "current";
      prior.schema_sha256 = sha256NormalizedText(path.join(copiedSkill, `references/${prior.schema_file}`));
      manifest.latest_schema_version = "6.0.0";
    }]
  ];
  for (const [name, mutate] of cases) {
    withSkillCopy(t, `audit-run-${name}`, (copiedSkill) => {
      mutateRegistry(copiedSkill, (registry) => {
        mutate(copiedSkill, registry.artifact_types.find((item) => item.id === "audit-run"));
      });
      assert.throws(() => loadAuditResources(copiedSkill), /canonical audit-run manifest changed/i, name);
    });
  }
});

test("the current envelope is syntactic while runtime rejects undeclared roles and producer spoofing", () => {
  const resources = loadAuditResources();
  const unknown = envelope({ producer: { ...envelope().producer, role_id: "undeclared_probe" } });
  assert.deepEqual(validateJsonSchema(unknown, resources.envelopeSchema), []);
  assert.match(validateArtifact(unknown, resources).errors.join("\n"), /unknown producer role/i);

  const spoofed = envelope({ producer: { ...envelope().producer, role_id: "e1_inspector", producer_kind: "external_human" } });
  assert.match(validateArtifact(spoofed, resources).errors.join("\n"), /producer kind does not match/i);
});

test("registry semantic validation rejects privilege escalation and unsafe graph extensions", (t) => {
  const cases = [
    ["second writer", (registry) => registry.roles.push(readOnlyRole({ can_write_target: true }))],
    ["AI authorizer", (registry) => registry.roles.push(readOnlyRole({ output_type: "fix-authorization" }))],
    ["E2 role", (registry) => registry.roles.push(readOnlyRole({ max_ai_evidence_level: "E2" }))],
    ["profile outcome", (registry) => registry.roles.push(readOnlyRole({ can_record_profile_outcome: true }))],
    ["unknown input", (registry) => registry.roles.push(readOnlyRole({ input_types: ["missing-artifact"] }))],
    ["duplicate role ID", (registry) => registry.roles.push(readOnlyRole({ id: "e1_inspector" }))],
    ["duplicate agent ID", (registry) => registry.roles.push(readOnlyRole({ agent_id: "information-accessibility-e1-inspector" }))],
    ["duplicate artifact ID", (registry) => registry.artifact_types.push(structuredClone(registry.artifact_types.find((item) => item.id === "screening-observations")))],
    ["canonical artifact manifest", (registry) => registry.artifact_types.find((item) => item.id === "human-review-queue").schema_versions.reverse()],
    ["canonical transition", (registry) => { registry.transitions.find((item) => item.to === "fix_authorized").from = "initialized"; }],
    ["protected canonical state inflow", (registry) => registry.transitions.push({ from: "initialized", to: "fix_authorized", required_artifact_types: ["human-review-queue"] })],
    ["ambiguous transition", (registry) => registry.transitions.push({ from: "initialized", to: "alternate_screened", required_artifact_types: ["screening-observations"] })],
    ["multiple required artifacts", (registry) => registry.transitions[0].required_artifact_types.push("human-review-queue")],
    ["unreachable state", (registry) => registry.transitions.push({ from: "orphaned", to: "orphan_complete", required_artifact_types: ["screening-observations"] })],
    ["cycle", (registry) => registry.transitions.push({ from: "retest_required", to: "initialized", required_artifact_types: ["screening-observations"] })]
  ];
  for (const [name, mutate] of cases) {
    withSkillCopy(t, name.replaceAll(" ", "-"), (copiedSkill) => {
      mutateRegistry(copiedSkill, mutate);
      assert.throws(() => loadAuditResources(copiedSkill), /registry|role|artifact|transition|state|writer|authoriz|evidence|profile/i, name);
    });
  }
});
