import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const validatorUrl = pathToFileURL(path.join(
  root,
  "codex",
  "skills",
  "information-accessibility-practice",
  "scripts",
  "lib",
  "json-schema.mjs"
));
const referenceRoot = path.join(root, "codex", "skills", "information-accessibility-practice", "references");
const sha256 = "a".repeat(64);
const runId = "RUN-20260717T010203Z-ABC12345";
const createdAt = "2026-07-17T01:02:03Z";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readReferenceJson(name) {
  return JSON.parse(fs.readFileSync(path.join(referenceRoot, name), "utf8").replace(/^\uFEFF/u, ""));
}

function schemaErrors(value, schemaName) {
  return import(validatorUrl).then(({ validateJsonSchema }) => validateJsonSchema(value, readReferenceJson(schemaName)));
}

function validAuditRun() {
  return {
    schema_version: "4.0.0",
    run_id: runId,
    supersedes_run_id: null,
    status: "initialized",
    target: {
      name: "Example audited target",
      version_or_commit: "abc1234",
      urls_or_files: ["https://example.com/"]
    },
    profile: {
      id: "web-modern",
      registry_version: "1.0.0"
    },
    scope: {
      included: ["https://example.com/"],
      excluded: [],
      complete_processes: ["Submit the example form"],
      third_party_content: [],
      full_pages_reviewed: false
    },
    environment: {
      os: ["Windows 11"],
      browsers: ["Chrome"],
      assistive_technologies: ["NVDA"],
      input_modes: ["keyboard"]
    },
    permissions: {
      network: "denied",
      interaction: "read_only",
      source_write: "denied",
      command_execution: "denied",
      allowed_actions: ["inspect_without_mutation"],
      forbidden_actions: ["execute_commands", "network_access", "write_target"]
    },
    resource_versions: {
      standards_registry_version: "1.0.0",
      orchestration_registry_version: "3.0.0",
      orchestration_registry_sha256: sha256,
      criteria_catalog_sha256: sha256,
      criterion_procedures_sha256: sha256,
      audit_methods_sha256: sha256
    },
    artifact_root: ".audit/runs/example",
    artifacts: [],
    history: [],
    limitations: ["Human identity is declared, not authenticated."]
  };
}

function validRunArtifact() {
  return {
    artifact_id: "ART-SCREENING-001",
    artifact_type: "screening-observations",
    path: ".audit/runs/example/screening-observations.json",
    sha256,
    producer_role: "e1_inspector",
    created_at: createdAt,
    validation_status: "valid"
  };
}

function validScreeningPayload() {
  return {
    schema_version: "1.0.0",
    observations: [{
      requirement_id: "SCREEN-AXE-SERIOUS",
      evidence_level: "E1",
      method: "Automated scan followed by read-only inspection",
      location: "target/index.html#main",
      observation: "A candidate issue requires human review.",
      captured_at: createdAt
    }]
  };
}

function validHumanQueuePayload() {
  return {
    schema_version: "2.0.0",
    items: [{
      requirement_id: "WCAG-2.2-SC-1.1.1",
      procedure_availability: "available",
      procedure_ref: "criterion-procedures:1.0.0#wcag22-sc-1-1-1-non-text-content",
      generic_method_ref: null,
      official_sources: [
        "https://www.w3.org/TR/WCAG22/#non-text-content",
        "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html"
      ],
      human_actions: ["Inspect the target-specific alternative and visible purpose."],
      required_evidence_types: ["browser_inspection", "manual_observation"],
      cant_tell_conditions: ["The computed accessible name cannot be inspected."]
    }],
    procedure_coverage: {
      total_requirements: 55,
      available_procedures: 2,
      unavailable_procedures: 53
    }
  };
}

function validDeclaredHumanReviewPayload(availability = "available") {
  const available = availability === "available";
  return {
    schema_version: "1.0.0",
    declaration: "I declare that I performed the described target-specific review.",
    reviewer_name: "Declared Reviewer",
    review_date: "2026-07-17",
    identity_authenticated: false,
    reviews: [{
      requirement_id: "WCAG-2.2-SC-1.1.1",
      procedure_availability: availability,
      criterion_procedure_ref: available
        ? "criterion-procedures:1.0.0#wcag22-sc-1-1-1-non-text-content"
        : null,
      generic_method_ref: available ? null : "web-audit-methods:1.0.0#non-text-content",
      official_sources: available ? [] : ["https://www.w3.org/TR/WCAG22/#non-text-content"],
      target_specific_evidence: [{
        type: "manual_observation",
        location: "target/index.html#logo",
        observation: "The visible purpose and computed name were compared.",
        captured_at: createdAt
      }],
      profile_outcome: "pass",
      rationale: "The target-specific evidence met the declared procedure expectation."
    }]
  };
}

function validRemediationPayload() {
  return {
    schema_version: "2.0.0",
    items: [{
      remediation_id: "REM-ABC12345",
      basis: "unverified_screening_candidate",
      requirement_id: "SCREEN-AXE-SERIOUS",
      source_artifact_ids: ["ART-SCREENING-001"],
      priority: "P1",
      location: "target/index.html#main",
      affected_users: ["Screen reader users"],
      issue: "A candidate issue needs confirmation before any profile claim.",
      proposed_change: "Add an accessible name if the candidate is verified.",
      verification: "Retest the target and repeat the relevant human procedure.",
      owner: "Frontend team",
      residual_limitation: "The candidate remains unverified until target-specific review is completed."
    }]
  };
}

test("current queue and remediation schemas are version 2 while frozen version 1 schemas remain readable", async () => {
  const currentQueue = readReferenceJson("human-review-queue.schema.json");
  const legacyQueue = readReferenceJson("human-review-queue-1.0.0.schema.json");
  const currentRemediation = readReferenceJson("remediation-plan.schema.json");
  const legacyRemediation = readReferenceJson("remediation-plan-1.0.0.schema.json");
  assert.equal(currentQueue.properties.schema_version.const, "2.0.0");
  assert.equal(legacyQueue.properties.schema_version.const, "1.0.0");
  assert.equal(currentRemediation.properties.schema_version.const, "2.0.0");
  assert.equal(legacyRemediation.properties.schema_version.const, "1.0.0");

  const legacyQueueValue = structuredClone(validHumanQueuePayload());
  legacyQueueValue.schema_version = "1.0.0";
  delete legacyQueueValue.items[0].generic_method_ref;
  delete legacyQueueValue.items[0].official_sources;
  assert.deepEqual(await schemaErrors(legacyQueueValue, "human-review-queue-1.0.0.schema.json"), []);
  assert.notDeepEqual(await schemaErrors(legacyQueueValue, "human-review-queue.schema.json"), []);

  const legacyRemediationValue = structuredClone(validRemediationPayload());
  legacyRemediationValue.schema_version = "1.0.0";
  for (const field of ["priority", "location", "affected_users", "owner", "residual_limitation"]) {
    delete legacyRemediationValue.items[0][field];
  }
  assert.deepEqual(await schemaErrors(legacyRemediationValue, "remediation-plan-1.0.0.schema.json"), []);
  assert.notDeepEqual(await schemaErrors(legacyRemediationValue, "remediation-plan.schema.json"), []);
});

test("Task 8A freezes Task 7 contracts and makes run 4 plus payload 2 current", async () => {
  const versions = [
    ["orchestration-registry.json", "schema_version", "3.0.0"],
    ["orchestration-registry-2.0.0.json", "schema_version", "2.0.0"],
    ["orchestration-registry.schema.json", "schema", "3.0.0"],
    ["orchestration-registry-2.0.0.schema.json", "schema", "2.0.0"],
    ["audit-run.schema.json", "schema", "4.0.0"],
    ["audit-run-3.0.0.schema.json", "schema", "3.0.0"],
    ["fix-authorization.schema.json", "schema", "2.0.0"],
    ["fix-authorization-1.0.0.schema.json", "schema", "1.0.0"],
    ["change-record.schema.json", "schema", "2.0.0"],
    ["change-record-1.0.0.schema.json", "schema", "1.0.0"]
  ];
  for (const [file, kind, expected] of versions) {
    const value = readReferenceJson(file);
    const actual = kind === "schema" ? value.properties.schema_version.const : value.schema_version;
    assert.equal(actual, expected, file);
  }

  const currentAuthorization = validFixAuthorizationPayload();
  const legacyAuthorization = validLegacyFixAuthorizationPayload();
  assert.deepEqual(await schemaErrors(currentAuthorization, "fix-authorization.schema.json"), []);
  assert.notDeepEqual(await schemaErrors(currentAuthorization, "fix-authorization-1.0.0.schema.json"), []);
  assert.deepEqual(await schemaErrors(legacyAuthorization, "fix-authorization-1.0.0.schema.json"), []);
  assert.notDeepEqual(await schemaErrors(legacyAuthorization, "fix-authorization.schema.json"), []);

  const currentChange = validChangeRecordPayload();
  const legacyChange = validLegacyChangeRecordPayload();
  assert.deepEqual(await schemaErrors(currentChange, "change-record.schema.json"), []);
  assert.notDeepEqual(await schemaErrors(currentChange, "change-record-1.0.0.schema.json"), []);
  assert.deepEqual(await schemaErrors(legacyChange, "change-record-1.0.0.schema.json"), []);
  assert.notDeepEqual(await schemaErrors(legacyChange, "change-record.schema.json"), []);
});

function validFixAuthorizationPayload() {
  return {
    schema_version: "2.0.0",
    authorization_id: "AUTH-20260717-ABC12345",
    run_id: runId,
    authorizer_role: "declared_authorizer",
    authorizer_kind: "external_requester",
    approved_by: "Declared Requester",
    identity_authenticated: false,
    declaration: "I authorize only the listed target-relative changes and structured commands.",
    approved_at: createdAt,
    source_root: "C:\\work\\target",
    allowed_paths: ["index.html"],
    allowed_operations: ["modify"],
    verification_commands: [{
      command_id: "VERIFY-001",
      executable: "node",
      args: ["scripts/verify-target.mjs", "--target", "index.html"],
      cwd: "."
    }],
    remediation_artifact: {
      artifact_id: "ART-REMEDIATION-001",
      sha256
    }
  };
}

function validChangeRecordPayload() {
  return {
    schema_version: "2.0.0",
    change_id: "CHANGE-20260717-ABC12345",
    run_id: runId,
    authorization_id: "AUTH-20260717-ABC12345",
    authorization_artifact: {
      artifact_id: "ART-AUTHORIZATION-001",
      sha256
    },
    changed_files: [{
      path: "index.html",
      operation: "modify",
      before_sha256: sha256,
      after_sha256: "b".repeat(64),
      description: "Added the authorized accessible name."
    }],
    diff_sha256: "c".repeat(64),
    command_results: [{
      command_id: "VERIFY-001",
      executable: "node",
      args: ["scripts/verify-target.mjs", "--target", "index.html"],
      cwd: ".",
      status: "exited",
      exit_code: 0,
      signal: null,
      stdout_sha256: "d".repeat(64),
      stderr_sha256: "e".repeat(64),
      started_at: "2026-07-17T01:02:04Z",
      completed_at: "2026-07-17T01:02:05Z"
    }],
    lease: {
      lease_id: "LEASE-20260717-ABC12345",
      source_root_sha256: "f".repeat(64),
      acquired_at: "2026-07-17T01:02:03Z",
      expires_at: "2026-07-17T01:07:03Z",
      recovery: null
    },
    next_status: "retest_required"
  };
}

function validLegacyFixAuthorizationPayload() {
  return {
    schema_version: "1.0.0",
    authorization_id: "AUTH-20260717-ABC12345",
    run_id: runId,
    authorizer_role: "declared_authorizer",
    authorizer_kind: "external_requester",
    authorized_by: "Declared Requester",
    identity_authenticated: false,
    declaration: "I authorize only the listed target-relative changes and structured commands.",
    issued_at: createdAt,
    target_root: "target",
    allowed_files: ["target/index.html"],
    commands: [{ executable: "node", args: ["scripts/fix-target.mjs"], cwd: "." }],
    remediation_artifact: { artifact_id: "ART-REMEDIATION-001", sha256 }
  };
}

function validLegacyChangeRecordPayload() {
  return {
    schema_version: "1.0.0",
    change_id: "CHANGE-20260717-ABC12345",
    run_id: runId,
    authorization_id: "AUTH-20260717-ABC12345",
    authorization_artifact: { artifact_id: "ART-AUTHORIZATION-001", sha256 },
    changed_files: [{
      path: "target/index.html",
      before_sha256: sha256,
      after_sha256: "b".repeat(64),
      description: "Added the authorized accessible name."
    }],
    verification: ["The changed file was parsed successfully."],
    next_status: "retest_required"
  };
}

function validEnvelope(artifactType = "screening-observations") {
  const producerByType = {
    "screening-observations": ["e1_inspector", "ai_agent", "information-accessibility-e1-inspector"],
    "human-review-queue": ["human_queue_planner", "ai_agent", "information-accessibility-human-queue-planner"],
    "declared-human-review": ["declared_external_human", "external_human", "declared-reviewer"],
    "remediation-plan": ["remediation_planner", "ai_agent", "information-accessibility-remediation-planner"],
    "fix-authorization": ["declared_authorizer", "external_requester", "declared-requester"],
    "change-record": ["authorized_fixer", "ai_agent", "information-accessibility-authorized-fixer"]
  };
  const [role_id, producer_kind, origin] = producerByType[artifactType];
  return {
    schema_version: "1.0.0",
    artifact_id: "ART-SCREENING-001",
    artifact_type: artifactType,
    run_id: runId,
    producer: { role_id, producer_kind, origin },
    created_at: createdAt,
    inputs: [],
    payload: validScreeningPayload()
  };
}

test("the extracted JSON Schema validator preserves existing rejection behavior", async () => {
  const { validateJsonSchema } = await import(validatorUrl);
  assert.equal(typeof validateJsonSchema, "function");

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "labels"],
    properties: {
      kind: { const: "example" },
      label: { type: "string", minLength: 1 },
      labels: { type: "array", items: { enum: ["one", "two"] } }
    }
  };

  const errors = validateJsonSchema({
    kind: "wrong",
    label: "",
    labels: ["three"],
    unexpected: true
  }, schema);

  assert.ok(errors.some((error) => error.includes("$.kind must equal")));
  assert.ok(errors.some((error) => error.includes("$.label must not be empty")));
  assert.ok(errors.some((error) => error.includes("$.labels[0] must be one of")));
  assert.ok(errors.some((error) => error.includes("$.unexpected is not allowed")));
});

test("the bundled validator enforces every security-relevant contract keyword", async () => {
  const { validateJsonSchema } = await import(validatorUrl);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "items", "count", "mode", "details"],
    properties: {
      id: { type: "string", pattern: "^SAFE-[A-Z0-9]+$" },
      items: { type: "array", minItems: 2, maxItems: 3, uniqueItems: true, items: { type: "string" } },
      count: { type: "integer", minimum: 0, maximum: 5 },
      mode: { enum: ["declared", "automatic"] },
      details: { $ref: "#/$defs/details" }
    },
    allOf: [{
      if: { properties: { mode: { const: "declared" } }, required: ["mode"] },
      then: { properties: { details: { required: ["declaration"] } } }
    }],
    $defs: {
      details: {
        type: "object",
        additionalProperties: false,
        properties: { declaration: { type: "string", minLength: 1 } }
      }
    }
  };

  const errors = validateJsonSchema({
    id: "UNSAFE",
    items: ["duplicate", "duplicate", "three", "four"],
    count: 5.5,
    mode: "declared",
    details: {}
  }, schema);

  for (const fragment of ["pattern", "at most 3", "unique", "integer", "declaration is required"]) {
    assert.ok(errors.some((error) => error.includes(fragment)), `expected ${fragment}: ${errors.join("; ")}`);
  }
});

test("the bundled validator fails closed for unsupported and external-reference schemas", async () => {
  const { validateJsonSchema } = await import(validatorUrl);
  assert.ok(validateJsonSchema("value", { securityBoundary: "must-be-enforced" })
    .some((error) => error.includes("unsupported schema keyword")));
  assert.ok(validateJsonSchema("value", { $ref: "https://example.invalid/security.schema.json" })
    .some((error) => error.includes("external schema reference")));
  assert.ok(validateJsonSchema("value", { type: "string", pattern: "(" })
    .some((error) => error.includes("invalid regular expression")));
  assert.ok(validateJsonSchema("value", {
    $ref: "#/$defs/loop",
    $defs: { loop: { $ref: "#/$defs/loop" } }
  }).some((error) => error.includes("cyclic schema reference")));
});

test("boolean and malformed schema branches fail closed without throwing", async () => {
  const { validateJsonSchema } = await import(validatorUrl);
  assert.ok(validateJsonSchema(["value"], { type: "array", items: false })
    .some((error) => error.includes("rejected by schema")));
  assert.ok(validateJsonSchema("value", { if: false, else: { const: "other" } })
    .some((error) => error.includes("must equal")));

  let malformedErrors;
  assert.doesNotThrow(() => {
    malformedErrors = validateJsonSchema("value", { allOf: { const: "value" } });
  });
  assert.ok(malformedErrors.some((error) => error.includes("allOf must be an array")));
});

test("schema preflight rejects empty, duplicate, unknown, and malformed type declarations", async () => {
  const { validateJsonSchema } = await import(validatorUrl);
  for (const [label, schema] of [
    ["empty union", { type: [] }],
    ["duplicate union member", { type: ["string", "string"] }],
    ["unknown scalar type", { type: "mystery" }],
    ["unknown union type", { type: ["string", "mystery"] }],
    ["non-string union member", { type: ["string", 42] }]
  ]) {
    const errors = validateJsonSchema("value", schema);
    assert.ok(errors.some((error) => error.startsWith("$schema")), `${label}: ${errors.join("; ")}`);
  }

  assert.deepEqual(validateJsonSchema("value", { type: ["string", "null"] }), []);
});

test("schema preflight validates every supported keyword shape before instance evaluation", async () => {
  const { validateJsonSchema } = await import(validatorUrl);
  const malformed = [
    ["schema-valued additionalProperties", {}, { type: "object", additionalProperties: { type: "string" } }],
    ["negative minItems", [], { type: "array", minItems: -1 }],
    ["fractional minItems", [], { type: "array", minItems: 1.5 }],
    ["negative maxItems", [], { type: "array", maxItems: -1 }],
    ["fractional maxItems", [], { type: "array", maxItems: 1.5 }],
    ["inverted item bounds", [], { type: "array", minItems: 2, maxItems: 1 }],
    ["non-boolean uniqueItems", [], { type: "array", uniqueItems: "true" }],
    ["malformed required", {}, { type: "object", required: "id" }],
    ["non-string required entry", {}, { type: "object", required: [42] }],
    ["duplicate required entry", { id: "x" }, { type: "object", required: ["id", "id"], properties: { id: { type: "string" } } }],
    ["malformed properties", {}, { type: "object", properties: [] }],
    ["malformed items", [], { type: "array", items: 42 }],
    ["malformed allOf", "value", { allOf: { type: "string" } }],
    ["empty allOf", "value", { allOf: [] }],
    ["malformed if", "value", { if: 42, then: true }],
    ["malformed then", "value", { if: true, then: 42 }],
    ["malformed else", "value", { if: false, else: 42 }],
    ["then without if", "value", { then: { const: "value" } }],
    ["else without if", "value", { else: { const: "value" } }],
    ["if without branch", "value", { if: { const: "value" } }],
    ["non-string pattern", "42", { type: "string", pattern: 42 }],
    ["negative minLength", "", { type: "string", minLength: -1 }],
    ["fractional minLength", "", { type: "string", minLength: 1.5 }],
    ["non-number minimum", 1, { type: "number", minimum: "0" }],
    ["non-number maximum", 1, { type: "number", maximum: "2" }],
    ["inverted numeric bounds", 1, { type: "number", minimum: 2, maximum: 1 }]
  ];

  for (const [label, value, schema] of malformed) {
    const errors = validateJsonSchema(value, schema);
    assert.ok(errors.some((error) => error.startsWith("$schema")), `${label}: ${errors.join("; ")}`);
  }
});

test("schema preflight resolves local refs in conditionals and definitions without false cycles", async () => {
  const { validateJsonSchema } = await import(validatorUrl);
  for (const [label, schema] of [
    ["conditional ref", {
      if: { $ref: "#/$defs/missing" },
      then: { const: "value" },
      $defs: {}
    }],
    ["unused definition ref", {
      type: "string",
      $defs: { unused: { $ref: "#/$defs/missing" } }
    }]
  ]) {
    const errors = validateJsonSchema("value", schema);
    assert.ok(errors.some((error) => error.includes("unresolved local schema reference")), `${label}: ${errors.join("; ")}`);
  }

  const reusedRef = {
    type: "object",
    required: ["left", "right"],
    properties: {
      left: { $ref: "#/$defs/text" },
      right: { $ref: "#/$defs/text" }
    },
    $defs: { text: { type: "string", minLength: 1 } }
  };
  assert.deepEqual(validateJsonSchema({ left: "one", right: "two" }, reusedRef), []);
});

test("the orchestration registry fixes the complete role, artifact, and transition contract", async () => {
  const registry = readReferenceJson("orchestration-registry.json");
  const expectedRoles = [
    ["orchestrator", "information-accessibility-reviewer", "ai_agent", "audit-run", false, false, true],
    ["e1_inspector", "information-accessibility-e1-inspector", "ai_agent", "screening-observations", false, false, true],
    ["human_queue_planner", "information-accessibility-human-queue-planner", "ai_agent", "human-review-queue", false, false, true],
    ["declared_external_human", null, "external_human", "declared-human-review", true, false, false],
    ["remediation_planner", "information-accessibility-remediation-planner", "ai_agent", "remediation-plan", false, false, true],
    ["declared_authorizer", null, "external_requester", "fix-authorization", false, false, false],
    ["authorized_fixer", "information-accessibility-authorized-fixer", "ai_agent", "change-record", false, true, false]
  ];
  assert.deepEqual(registry.roles.map((role) => [
    role.id,
    role.agent_id,
    role.producer_kind,
    role.output_type,
    role.can_record_profile_outcome,
    role.can_write_target,
    role.install_by_default
  ]), expectedRoles);

  const aiRoles = registry.roles.filter((role) => role.producer_kind === "ai_agent");
  for (const role of aiRoles) {
    assert.equal(role.can_record_profile_outcome, false, role.id);
    assert.ok(["E0", "E1"].includes(role.max_ai_evidence_level), role.id);
    assert.notEqual(role.output_type, "fix-authorization", role.id);
  }
  const writers = registry.roles.filter((role) => role.can_write_target);
  assert.deepEqual(writers.map((role) => role.id), ["authorized_fixer"]);
  assert.equal(writers[0].install_by_default, false);

  assert.deepEqual(registry.artifact_types, [
    {
      id: "audit-run",
      latest_schema_version: "4.0.0",
      schema_versions: [
        { version: "1.0.0", schema_file: "audit-run-1.0.0.schema.json", mode: "read_only" },
        { version: "2.0.0", schema_file: "audit-run-2.0.0.schema.json", mode: "read_only" },
        { version: "3.0.0", schema_file: "audit-run-3.0.0.schema.json", mode: "read_only" },
        { version: "4.0.0", schema_file: "audit-run.schema.json", mode: "current" }
      ]
    },
    {
      id: "screening-observations",
      latest_schema_version: "1.0.0",
      schema_versions: [{ version: "1.0.0", schema_file: "screening-observations.schema.json", mode: "current" }]
    },
    {
      id: "human-review-queue",
      latest_schema_version: "2.0.0",
      schema_versions: [
        { version: "1.0.0", schema_file: "human-review-queue-1.0.0.schema.json", mode: "read_only" },
        { version: "2.0.0", schema_file: "human-review-queue.schema.json", mode: "current" }
      ]
    },
    {
      id: "declared-human-review",
      latest_schema_version: "1.0.0",
      schema_versions: [{ version: "1.0.0", schema_file: "declared-human-review.schema.json", mode: "current" }]
    },
    {
      id: "remediation-plan",
      latest_schema_version: "2.0.0",
      schema_versions: [
        { version: "1.0.0", schema_file: "remediation-plan-1.0.0.schema.json", mode: "read_only" },
        { version: "2.0.0", schema_file: "remediation-plan.schema.json", mode: "current" }
      ]
    },
    {
      id: "fix-authorization",
      latest_schema_version: "2.0.0",
      schema_versions: [
        { version: "1.0.0", schema_file: "fix-authorization-1.0.0.schema.json", mode: "read_only" },
        { version: "2.0.0", schema_file: "fix-authorization.schema.json", mode: "current" }
      ]
    },
    {
      id: "change-record",
      latest_schema_version: "2.0.0",
      schema_versions: [
        { version: "1.0.0", schema_file: "change-record-1.0.0.schema.json", mode: "read_only" },
        {
          version: "2.0.0",
          schema_file: "change-record.schema.json",
          schema_sha256: "304927774cbdb78f8f770736b0cbfa4b591b858ab78b3f1f2ad310c036b631da",
          mode: "current"
        }
      ]
    }
  ]);
  assert.deepEqual(registry.transitions, [
    { from: "initialized", to: "screened", required_artifact_types: ["screening-observations"] },
    { from: "screened", to: "human_queue_ready", required_artifact_types: ["human-review-queue"] },
    { from: "human_queue_ready", to: "human_review_recorded", required_artifact_types: ["declared-human-review"] },
    { from: "human_queue_ready", to: "remediation_ready", required_artifact_types: ["remediation-plan"] },
    { from: "human_review_recorded", to: "remediation_ready", required_artifact_types: ["remediation-plan"] },
    { from: "remediation_ready", to: "fix_authorized", required_artifact_types: ["fix-authorization"] },
    { from: "fix_authorized", to: "retest_required", required_artifact_types: ["change-record"] }
  ]);
  for (const transition of registry.transitions) {
    for (const artifactType of transition.required_artifact_types) {
      const producers = registry.roles.filter((role) => role.output_type === artifactType);
      assert.equal(producers.length, 1, `${artifactType} must have exactly one producer`);
      if (artifactType === "fix-authorization") assert.notEqual(producers[0].producer_kind, "ai_agent");
    }
  }
  assert.deepEqual(await schemaErrors(registry, "orchestration-registry.schema.json"), []);
});

test("the registry schema rejects AI elevation, unauthorized writers, and unauthorized authorizers", async () => {
  const registry = readReferenceJson("orchestration-registry.json");
  const mutations = [
    ["AI profile outcome", (value) => { value.roles.find((role) => role.id === "e1_inspector").can_record_profile_outcome = true; }],
    ["AI evidence elevation", (value) => { value.roles.find((role) => role.id === "e1_inspector").max_ai_evidence_level = "E2"; }],
    ["unauthorized writer", (value) => { value.roles.find((role) => role.id === "remediation_planner").can_write_target = true; }],
    ["default fixer", (value) => { value.roles.find((role) => role.id === "authorized_fixer").install_by_default = true; }],
    ["AI authorizer", (value) => { value.roles.find((role) => role.id === "declared_authorizer").producer_kind = "ai_agent"; }],
    ["AI fix authorization output", (value) => { value.roles.find((role) => role.id === "e1_inspector").output_type = "fix-authorization"; }]
  ];
  for (const [label, mutate] of mutations) {
    const value = structuredClone(registry);
    mutate(value);
    assert.notDeepEqual(await schemaErrors(value, "orchestration-registry.schema.json"), [], label);
  }
});

test("the registry schema rejects duplicate, missing, and replaced canonical roles", async () => {
  const registry = readReferenceJson("orchestration-registry.json");

  const duplicateAndMissing = structuredClone(registry);
  duplicateAndMissing.roles[6] = structuredClone(duplicateAndMissing.roles[0]);
  assert.notDeepEqual(await schemaErrors(duplicateAndMissing, "orchestration-registry.schema.json"), [], "duplicate orchestrator and missing authorized_fixer");

  const replacement = structuredClone(registry);
  const index = replacement.roles.findIndex((role) => role.id === "e1_inspector");
  replacement.roles[index] = {
    ...replacement.roles[index],
    agent_id: "unrelated-agent",
    input_types: ["change-record"],
    output_type: "audit-run"
  };
  assert.notDeepEqual(await schemaErrors(replacement, "orchestration-registry.schema.json"), [], "same-length role replacement");
});

test("the registry schema pins each role agent and input contract", async () => {
  const registry = readReferenceJson("orchestration-registry.json");
  const acceptedAgentMutations = [];
  const acceptedInputMutations = [];

  for (let index = 0; index < registry.roles.length; index += 1) {
    const role = registry.roles[index];

    const wrongAgent = structuredClone(registry);
    wrongAgent.roles[index].agent_id = role.agent_id === null ? "unrelated-agent" : `${role.agent_id}-unrelated`;
    if ((await schemaErrors(wrongAgent, "orchestration-registry.schema.json")).length === 0) acceptedAgentMutations.push(role.id);

    const wrongInputs = structuredClone(registry);
    wrongInputs.roles[index].input_types = role.input_types.length === 0 ? ["screening-observations"] : [];
    if ((await schemaErrors(wrongInputs, "orchestration-registry.schema.json")).length === 0) acceptedInputMutations.push(role.id);
  }

  assert.deepEqual(acceptedAgentMutations, [], `accepted unrelated agent IDs for: ${acceptedAgentMutations.join(", ")}`);
  assert.deepEqual(acceptedInputMutations, [], `accepted wrong input types for: ${acceptedInputMutations.join(", ")}`);

  const reorderedInputs = structuredClone(registry);
  const orchestrator = reorderedInputs.roles.find((role) => role.id === "orchestrator");
  orchestrator.input_types.reverse();
  assert.notDeepEqual(
    await schemaErrors(reorderedInputs, "orchestration-registry.schema.json"),
    [],
    "input_types order is part of the canonical serialized role contract"
  );
});

test("the registry schema pins the output type for every canonical role", async () => {
  const registry = readReferenceJson("orchestration-registry.json");
  const outputs = registry.artifact_types.map((item) => item.id);
  const acceptedOutputMutations = [];

  for (let index = 0; index < registry.roles.length; index += 1) {
    const role = registry.roles[index];
    const value = structuredClone(registry);
    value.roles[index].output_type = outputs.find((output) => output !== role.output_type);
    if ((await schemaErrors(value, "orchestration-registry.schema.json")).length === 0) acceptedOutputMutations.push(role.id);
  }

  assert.deepEqual(acceptedOutputMutations, [], `accepted wrong output types for: ${acceptedOutputMutations.join(", ")}`);
});

test("the immutable audit-run schema accepts a bounded initial run", async () => {
  assert.deepEqual(await schemaErrors(validAuditRun(), "audit-run.schema.json"), []);
});

test("audit-run 4 permissions grant only authorized verification command execution with authorized source writes", async () => {
  const denied = validAuditRun();
  assert.deepEqual(await schemaErrors(denied, "audit-run.schema.json"), []);

  const authorized = validAuditRun();
  authorized.permissions = {
    network: "denied",
    interaction: "read_only",
    source_write: "authorized_only",
    command_execution: "authorized_verification_only",
    allowed_actions: ["execute_authorized_verification_commands", "inspect_without_mutation", "write_authorized_files"],
    forbidden_actions: ["execute_unapproved_commands", "network_access"]
  };
  assert.deepEqual(await schemaErrors(authorized, "audit-run.schema.json"), []);

  for (const [label, mutate] of [
    ["commands enabled while writes denied", (value) => { value.permissions.command_execution = "authorized_verification_only"; }],
    ["commands denied while writes authorized", (value) => { value.permissions = structuredClone(authorized.permissions); value.permissions.command_execution = "denied"; }],
    ["generic execute command grant", (value) => { value.permissions = structuredClone(authorized.permissions); value.permissions.allowed_actions.push("execute_commands"); }],
    ["missing unapproved-command prohibition", (value) => { value.permissions = structuredClone(authorized.permissions); value.permissions.forbidden_actions = ["network_access"]; }]
  ]) {
    const value = validAuditRun();
    mutate(value);
    assert.notDeepEqual(await schemaErrors(value, "audit-run.schema.json"), [], label);
  }
});

test("audit-run rejects malformed IDs, hashes, paths, artifacts, and transition history", async () => {
  const mutations = [
    ["run id", (value) => { value.run_id = "run-1"; }],
    ["predecessor id", (value) => { value.supersedes_run_id = "../prior"; }],
    ["status", (value) => { value.status = "completed"; }],
    ["absolute artifact root", (value) => { value.artifact_root = "/tmp/audit"; }],
    ["invalid resource hash", (value) => { value.resource_versions.criteria_catalog_sha256 = "abc123"; }],
    ["absolute artifact path", (value) => {
      value.artifacts = [validRunArtifact()];
      value.artifacts[0].path = "C:\\audit\\screening.json";
    }],
    ["traversal artifact path", (value) => {
      value.artifacts = [validRunArtifact()];
      value.artifacts[0].path = "../outside.json";
    }],
    ["invalid artifact hash", (value) => {
      value.artifacts = [validRunArtifact()];
      value.artifacts[0].sha256 = "not-a-sha";
    }],
    ["invalid artifact id", (value) => {
      value.artifacts = [validRunArtifact()];
      value.artifacts[0].artifact_id = "bad id";
    }],
    ["malformed artifact", (value) => { value.artifacts = [{
      artifact_id: "bad id",
      artifact_type: "screening-observations",
      path: "../outside.json",
      sha256: "not-a-sha",
      producer_role: "unknown_role",
      created_at: createdAt,
      validation_status: "valid"
    }]; }],
    ["URL artifact path", (value) => {
      value.artifacts = [validRunArtifact()];
      value.artifacts[0].path = "https://example.com/artifact.json";
    }],
    ["malformed transition", (value) => { value.history = [{
      from: "initialized",
      to: "fix_authorized",
      at: createdAt,
      actor_role: "orchestrator",
      artifact_ids: ["ART-SCREENING-001"]
    }]; }],
    ["malformed transition actor", (value) => { value.history = [{
      from: "initialized",
      to: "screened",
      at: createdAt,
      actor_role: "root",
      artifact_ids: ["ART-SCREENING-001"]
    }]; }],
    ["malformed transition artifact reference", (value) => { value.history = [{
      from: "initialized",
      to: "screened",
      at: createdAt,
      actor_role: "orchestrator",
      artifact_ids: ["../artifact"]
    }]; }]
  ];
  for (const [label, mutate] of mutations) {
    const value = validAuditRun();
    mutate(value);
    assert.notDeepEqual(await schemaErrors(value, "audit-run.schema.json"), [], label);
  }
});

test("artifact envelopes bind each artifact type to its only permitted producer role", async () => {
  for (const type of [
    "screening-observations",
    "human-review-queue",
    "declared-human-review",
    "remediation-plan",
    "fix-authorization",
    "change-record"
  ]) {
    assert.deepEqual(await schemaErrors(validEnvelope(type), "audit-artifact-envelope.schema.json"), [], type);
  }

  const unauthorized = validEnvelope("fix-authorization");
  unauthorized.producer = {
    role_id: "e1_inspector",
    producer_kind: "ai_agent",
    origin: "information-accessibility-e1-inspector"
  };
  assert.notDeepEqual(await schemaErrors(unauthorized, "audit-artifact-envelope.schema.json"), []);

  const elevated = validEnvelope("screening-observations");
  elevated.producer.role_id = "declared_authorizer";
  elevated.producer.producer_kind = "external_requester";
  assert.notDeepEqual(await schemaErrors(elevated, "audit-artifact-envelope.schema.json"), []);
});

test("artifact envelope inputs reject malformed IDs, run references, and SHA-256 values", async () => {
  const valid = validEnvelope();
  valid.inputs = [{ artifact_id: "ART-INPUT-001", run_id: runId, sha256 }];
  assert.deepEqual(await schemaErrors(valid, "audit-artifact-envelope.schema.json"), []);

  for (const [label, mutate] of [
    ["artifact id", (value) => { value.inputs[0].artifact_id = "../artifact"; }],
    ["run id", (value) => { value.inputs[0].run_id = "run-one"; }],
    ["hash", (value) => { value.inputs[0].sha256 = "A".repeat(64); }]
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.notDeepEqual(await schemaErrors(value, "audit-artifact-envelope.schema.json"), [], label);
  }
});

test("type-specific payload schemas accept complete bounded records", async () => {
  const fixtures = [
    [validScreeningPayload(), "screening-observations.schema.json"],
    [validHumanQueuePayload(), "human-review-queue.schema.json"],
    [validDeclaredHumanReviewPayload(), "declared-human-review.schema.json"],
    [validDeclaredHumanReviewPayload("unavailable"), "declared-human-review.schema.json"],
    [validRemediationPayload(), "remediation-plan.schema.json"],
    [validFixAuthorizationPayload(), "fix-authorization.schema.json"],
    [validChangeRecordPayload(), "change-record.schema.json"]
  ];
  for (const [value, schemaName] of fixtures) {
    assert.deepEqual(await schemaErrors(value, schemaName), [], schemaName);
  }
});

test("AI-authored payloads cannot carry profile outcomes or elevated screening evidence", async () => {
  const screeningOutcome = validScreeningPayload();
  screeningOutcome.observations[0].profile_outcome = "pass";
  assert.notDeepEqual(await schemaErrors(screeningOutcome, "screening-observations.schema.json"), []);

  const elevated = validScreeningPayload();
  elevated.observations[0].evidence_level = "E2";
  assert.notDeepEqual(await schemaErrors(elevated, "screening-observations.schema.json"), []);

  const badId = validScreeningPayload();
  badId.observations[0].requirement_id = "WCAG-2.2-SC-1.1.1";
  assert.notDeepEqual(await schemaErrors(badId, "screening-observations.schema.json"), []);

  for (const [value, schemaName] of [
    [validHumanQueuePayload(), "human-review-queue.schema.json"],
    [validRemediationPayload(), "remediation-plan.schema.json"],
    [validChangeRecordPayload(), "change-record.schema.json"]
  ]) {
    value.profile_outcome = "pass";
    assert.notDeepEqual(await schemaErrors(value, schemaName), [], schemaName);
  }
});

test("human queue and declared review enforce procedure completeness and identity declaration", async () => {
  const queue = validHumanQueuePayload();
  queue.items[0].procedure_ref = null;
  assert.notDeepEqual(await schemaErrors(queue, "human-review-queue.schema.json"), []);

  const fractionalCoverage = validHumanQueuePayload();
  fractionalCoverage.procedure_coverage.available_procedures = 1.5;
  assert.notDeepEqual(await schemaErrors(fractionalCoverage, "human-review-queue.schema.json"), []);

  const authenticated = validDeclaredHumanReviewPayload();
  authenticated.identity_authenticated = true;
  assert.notDeepEqual(await schemaErrors(authenticated, "declared-human-review.schema.json"), []);

  const missingProcedure = validDeclaredHumanReviewPayload();
  missingProcedure.reviews[0].criterion_procedure_ref = null;
  assert.notDeepEqual(await schemaErrors(missingProcedure, "declared-human-review.schema.json"), []);

  const missingFallback = validDeclaredHumanReviewPayload("unavailable");
  missingFallback.reviews[0].generic_method_ref = null;
  missingFallback.reviews[0].official_sources = [];
  assert.notDeepEqual(await schemaErrors(missingFallback, "declared-human-review.schema.json"), []);

  const noEvidence = validDeclaredHumanReviewPayload();
  noEvidence.reviews[0].target_specific_evidence = [];
  assert.notDeepEqual(await schemaErrors(noEvidence, "declared-human-review.schema.json"), []);
});

test("remediation basis keeps verified failures separate from unverified screening candidates", async () => {
  const verified = validRemediationPayload();
  verified.items[0].basis = "verified_failure";
  verified.items[0].requirement_id = "WCAG-2.2-SC-1.1.1";
  assert.deepEqual(await schemaErrors(verified, "remediation-plan.schema.json"), []);

  const fakeVerified = structuredClone(verified);
  fakeVerified.items[0].requirement_id = "SCREEN-AXE-SERIOUS";
  assert.notDeepEqual(await schemaErrors(fakeVerified, "remediation-plan.schema.json"), []);

  const elevatedCandidate = validRemediationPayload();
  elevatedCandidate.items[0].requirement_id = "WCAG-2.2-SC-1.1.1";
  assert.notDeepEqual(await schemaErrors(elevatedCandidate, "remediation-plan.schema.json"), []);
});

test("fix authorization 2 requires declared identity, absolute source root, bounded paths, operations, and structured verification commands", async () => {
  const valid = validFixAuthorizationPayload();
  assert.deepEqual(await schemaErrors(valid, "fix-authorization.schema.json"), []);

  const mutations = [
    ["shell command property", (value) => {
      value.verification_commands[0] = { command: "node scripts/verify-target.mjs", cwd: "." };
    }],
    ["shell syntax in executable", (value) => { value.verification_commands[0].executable = "node && whoami"; }],
    ["shell launcher string", (value) => { value.verification_commands[0].executable = "cmd /c node"; }],
    ["absolute cwd", (value) => { value.verification_commands[0].cwd = "C:\\target"; }],
    ["UNC cwd", (value) => { value.verification_commands[0].cwd = "\\\\server\\share"; }],
    ["URL cwd", (value) => { value.verification_commands[0].cwd = "https://example.com/"; }],
    ["traversal cwd", (value) => { value.verification_commands[0].cwd = "../target"; }],
    ["shell command instead of args array", (value) => { value.verification_commands[0].args = "scripts/verify-target.mjs && whoami"; }],
    ["duplicate command ID", (value) => { value.verification_commands.push(structuredClone(value.verification_commands[0])); }],
    ["relative source root", (value) => { value.source_root = "target"; }],
    ["control character in source root", (value) => { value.source_root = "C:\\target\nother"; }],
    ["absolute allowed path", (value) => { value.allowed_paths[0] = "/tmp/target.html"; }],
    ["UNC allowed path", (value) => { value.allowed_paths[0] = "\\\\server\\share\\target.html"; }],
    ["traversal allowed path", (value) => { value.allowed_paths[0] = "target/../../outside.html"; }],
    ["duplicate allowed path", (value) => { value.allowed_paths.push(value.allowed_paths[0]); }],
    ["unknown operation", (value) => { value.allowed_operations[0] = "rename"; }],
    ["bad remediation hash", (value) => { value.remediation_artifact.sha256 = "1234"; }],
    ["authenticated identity claim", (value) => { value.identity_authenticated = true; }],
    ["AI authorizer kind", (value) => { value.authorizer_kind = "ai_agent"; }]
  ];
  for (const [label, mutate] of mutations) {
    const value = validFixAuthorizationPayload();
    mutate(value);
    assert.notDeepEqual(await schemaErrors(value, "fix-authorization.schema.json"), [], label);
  }
});

test("change record 2 enforces operation hashes, structured command results, lease evidence, and retest_required", async () => {
  const create = validChangeRecordPayload();
  create.changed_files[0].operation = "create";
  create.changed_files[0].before_sha256 = null;
  assert.deepEqual(await schemaErrors(create, "change-record.schema.json"), []);

  const deleted = validChangeRecordPayload();
  deleted.changed_files[0].operation = "delete";
  deleted.changed_files[0].after_sha256 = null;
  assert.deepEqual(await schemaErrors(deleted, "change-record.schema.json"), []);

  const signaled = validChangeRecordPayload();
  signaled.command_results[0].status = "signaled";
  signaled.command_results[0].exit_code = null;
  signaled.command_results[0].signal = "SIGTERM";
  assert.deepEqual(await schemaErrors(signaled, "change-record.schema.json"), []);

  const spawnError = validChangeRecordPayload();
  spawnError.command_results[0].status = "spawn_error";
  spawnError.command_results[0].exit_code = null;
  spawnError.command_results[0].signal = null;
  assert.deepEqual(await schemaErrors(spawnError, "change-record.schema.json"), []);

  const mutations = [
    ["absolute path", (value) => { value.changed_files[0].path = "C:\\target\\index.html"; }],
    ["traversal path", (value) => { value.changed_files[0].path = "../index.html"; }],
    ["bad hash", (value) => { value.changed_files[0].after_sha256 = "not-a-sha"; }],
    ["create with before hash", (value) => { value.changed_files[0].operation = "create"; }],
    ["modify without before hash", (value) => { value.changed_files[0].before_sha256 = null; }],
    ["delete with after hash", (value) => { value.changed_files[0].operation = "delete"; }],
    ["command string", (value) => { value.command_results[0].command = "node scripts/verify-target.mjs"; }],
    ["duplicate command ID", (value) => { value.command_results.push(structuredClone(value.command_results[0])); }],
    ["unknown command status", (value) => { value.command_results[0].status = "unknown"; }],
    ["exited without exit code", (value) => { value.command_results[0].exit_code = null; }],
    ["exited with signal", (value) => { value.command_results[0].signal = "SIGTERM"; }],
    ["signaled with exit code", (value) => { value.command_results[0].status = "signaled"; value.command_results[0].signal = "SIGTERM"; }],
    ["signaled without signal", (value) => { value.command_results[0].status = "signaled"; value.command_results[0].exit_code = null; }],
    ["spawn error with exit code", (value) => { value.command_results[0].status = "spawn_error"; }],
    ["spawn error with signal", (value) => { value.command_results[0].status = "spawn_error"; value.command_results[0].exit_code = null; value.command_results[0].signal = "SIGTERM"; }],
    ["missing lease evidence", (value) => { delete value.lease.source_root_sha256; }],
    ["terminal status", (value) => { value.next_status = "completed"; }],
    ["profile outcome", (value) => { value.profile_outcome = "pass"; }],
    ["conformance wording", (value) => { value.conformance_statement = "conforms"; }],
    ["human verified", (value) => { value.human_verified = true; }]
  ];
  for (const [label, mutate] of mutations) {
    const value = validChangeRecordPayload();
    mutate(value);
    assert.notDeepEqual(await schemaErrors(value, "change-record.schema.json"), [], label);
  }
});

test("the internal/public boundary prohibits orchestration metadata leakage", () => {
  const boundary = read("codex/skills/information-accessibility-practice/references/agent-orchestration.md");
  assert.match(boundary, /`audit-run` and all role artifacts are internal traceability records/i);
  assert.match(boundary, /`render-audit-report\.mjs`[^]*`--run`[^]*`--assessment`[^]*`--output`/i);
  for (const prohibited of ["internal agent identifiers", "local paths", "Git branches", "run IDs", "transition history", "state history"]) {
    assert.match(boundary, new RegExp(`(?:must not|never)[^.]*${prohibited}`, "i"), prohibited);
  }
  assert.match(boundary, /schema validation does not authenticate identity or grant authorization/i);
  assert.match(boundary, /does not execute commands or write the audited target/i);
  assert.match(boundary, /same run[^.]*exact SHA-256[^.]*registered artifact/i);
  assert.match(boundary, /`input_types` array order is part of the canonical serialized role contract/i);
});
