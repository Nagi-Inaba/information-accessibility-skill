import { isDeepStrictEqual } from "node:util";
import { compareText } from "./text-order.mjs";

export const auditRunRegistryCompatibility = new Map([
  ["1.0.0", "1.0.0"],
  ["2.0.0", "1.0.0"],
  ["3.0.0", "2.0.0"],
  ["4.0.0", "3.0.0"],
  ["5.0.0", "4.0.0"],
  ["6.0.0", "5.0.0"],
  ["7.0.0", "6.0.0"],
  ["8.0.0", "7.0.0"],
  ["9.0.0", "8.0.0"],
  ["10.0.0", "9.0.0"],
  ["11.0.0", "10.0.0"],
  ["12.0.0", "11.0.0"],
  ["13.0.0", "12.0.0"],
  ["14.0.0", "13.0.0"],
  ["15.0.0", "14.0.0"],
  ["16.0.0", "15.0.0"],
  ["17.0.0", "16.0.0"]
]);
export const auditRunEnvelopeCompatibility = new Map([
  ["1.0.0", "1.0.0"],
  ["2.0.0", "1.0.0"],
  ["3.0.0", "1.0.0"],
  ["4.0.0", "1.0.0"],
  ["5.0.0", "2.0.0"],
  ["6.0.0", "2.0.0"],
  ["7.0.0", "2.0.0"],
  ["8.0.0", "3.0.0"],
  ["9.0.0", "3.0.0"],
  ["10.0.0", "3.0.0"],
  ["11.0.0", "3.0.0"],
  ["12.0.0", "3.0.0"],
  ["13.0.0", "3.0.0"],
  ["14.0.0", "3.0.0"],
  ["15.0.0", "3.0.0"],
  ["16.0.0", "3.0.0"],
  ["17.0.0", "3.0.0"]
]);
const currentAuditRunManifestContract = {
  "id": "audit-run",
  "latest_schema_version": "17.0.0",
  "schema_versions": [
    {
      "version": "1.0.0",
      "schema_file": "audit-run-1.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "2.0.0",
      "schema_file": "audit-run-2.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "3.0.0",
      "schema_file": "audit-run-3.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "4.0.0",
      "schema_file": "audit-run-4.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "5.0.0",
      "schema_file": "audit-run-5.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "6.0.0",
      "schema_file": "audit-run-6.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "7.0.0",
      "schema_file": "audit-run-7.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "8.0.0",
      "schema_file": "audit-run-8.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "9.0.0",
      "schema_file": "audit-run-9.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "10.0.0",
      "schema_file": "audit-run-10.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "11.0.0",
      "schema_file": "audit-run-11.0.0.schema.json",
      "schema_sha256": "62b7906ef2cf5a489bb0260cea57beffd2a306b70dfcc88bf067dd4594fe3cbe",
      "mode": "read_only"
    },
    {
      "version": "12.0.0",
      "schema_file": "audit-run-12.0.0.schema.json",
      "schema_sha256": "836344169a4f237e4d724ce26501ad43712fb7b2e5028be73ad279e389788cce",
      "mode": "read_only"
    },
    {
      "version": "13.0.0",
      "schema_file": "audit-run-13.0.0.schema.json",
      "schema_sha256": "2c4b852b3599e036fda577f52b04933f4ddb7ab53a3e8f399f2b99c30713e187",
      "mode": "read_only"
    },
    {
      "version": "14.0.0",
      "schema_file": "audit-run-14.0.0.schema.json",
      "schema_sha256": "8a5c491996266461da52a9adb87642b5899f1035b0755c8398e4f6b52898e92b",
      "mode": "read_only"
    },
    {
      "version": "15.0.0",
      "schema_file": "audit-run-15.0.0.schema.json",
      "schema_sha256": "41b6084e4fd0215e52513593002d0bed572a4a9d1ee664179b28a82a6a573bcc",
      "mode": "read_only"
    },
    {
      "version": "16.0.0",
      "schema_file": "audit-run-16.0.0.schema.json",
      "schema_sha256": "8bcde1ab78b5dffeb75112b31eb12aa7d8186275ea239f347ff87ea5551846fa",
      "mode": "read_only"
    },
    {
      "version": "17.0.0",
      "schema_file": "audit-run.schema.json",
      "schema_sha256": "d0743603d79d416ff454a9969bbe35dbbf11495dd6174884183417ccd8c740a7",
      "mode": "current"
    }
  ]
};
const currentQueueManifestContract = {
  "id": "human-review-queue",
  "latest_schema_version": "3.0.0",
  "schema_versions": [
    {
      "version": "1.0.0",
      "schema_file": "human-review-queue-1.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "2.0.0",
      "schema_file": "human-review-queue-2.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "3.0.0",
      "schema_file": "human-review-queue.schema.json",
      "schema_sha256": "65144521b4ae8723e0188f6b71ad2d64b42077eacdf2a0f36675b19c071e2827",
      "mode": "current"
    }
  ]
};
const currentScreeningManifestContract = {
  "id": "screening-observations",
  "latest_schema_version": "4.0.0",
  "schema_versions": [
    {
      "version": "1.0.0",
      "schema_file": "screening-observations-1.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "2.0.0",
      "schema_file": "screening-observations-2.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "3.0.0",
      "schema_file": "screening-observations-3.0.0.schema.json",
      "schema_sha256": "268da46d8988039e5ff272166fa2ab13c3492a6a164ecadbb3ac07f47691e33b",
      "mode": "read_only"
    },
    {
      "version": "4.0.0",
      "schema_file": "screening-observations.schema.json",
      "schema_sha256": "0d1836dd7fa397ec46688810c2d1403320da9fb499a4c1d5746681873803c315",
      "mode": "current"
    }
  ]
};
const currentRemediationManifestContract = {
  "id": "remediation-plan",
  "latest_schema_version": "3.0.0",
  "schema_versions": [
    {
      "version": "1.0.0",
      "schema_file": "remediation-plan-1.0.0.schema.json",
      "mode": "read_only"
    },
    {
      "version": "2.0.0",
      "schema_file": "remediation-plan-2.0.0.schema.json",
      "schema_sha256": "b8036ca3587b1a91a89baa034ac4807f5f228ed6bbb1d6e898e96c5ce6b79f92",
      "mode": "read_only"
    },
    {
      "version": "3.0.0",
      "schema_file": "remediation-plan.schema.json",
      "schema_sha256": "a0758d53df985a561f49219d556f564894676743b960919f2187298f2059f934",
      "mode": "current"
    }
  ]
};
const currentHumanReviewManifestContract = {
  "id": "declared-human-review",
  "latest_schema_version": "3.0.0",
  "schema_versions": [
    {
      "version": "1.0.0",
      "schema_file": "declared-human-review-1.0.0.schema.json",
      "schema_sha256": "f4732affdb197ae02d56bf1cdccda2978422b127a1b8c5f173ed452ba1198f7a",
      "mode": "read_only"
    },
    {
      "version": "2.0.0",
      "schema_file": "declared-human-review-2.0.0.schema.json",
      "schema_sha256": "4474360f5eb63e75485acfa45bf832fe4bc2d2cc92d7beaf87beae059ed0c41e",
      "mode": "read_only"
    },
    {
      "version": "3.0.0",
      "schema_file": "declared-human-review.schema.json",
      "schema_sha256": "e8fd6e691a184f1261e716aea7c22902d9a01e32d95dc365374ad6783d1841e3",
      "mode": "current"
    }
  ]
};
// Additive timestamp support in the current payloads. Keep every other
// manifest field, especially frozen versions and role bindings, pinned.
const currentTimestampPayloadSchemaHashes = new Map([
  ["fix-authorization", "13579db07d5c0f86f70fd41bb490ad61167051372072ad633ed0c9c1775a5e62"]
]);
const currentChangeManifestContract = {
  id: "change-record", latest_schema_version: "3.0.0", schema_versions: [
    { version: "1.0.0", schema_file: "change-record-1.0.0.schema.json", mode: "read_only" },
    { version: "2.0.0", schema_file: "change-record-2.0.0.schema.json",
      schema_sha256: "0e7318a19b0a7e8b69ab2c30ab613866666cd4892f04721c419cb128a10fcb84", mode: "read_only" },
    { version: "3.0.0", schema_file: "change-record.schema.json",
      schema_sha256: "bc6ff9de4c38ffc6a0dbe936b1469663f0674cb8d397889daa57a539f4d40407", mode: "current" }
  ]
};

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareText);
}

function canonicalComparableManifest(installedManifest, canonicalManifest) {
  const canonicalSchemas = new Map((canonicalManifest?.schema_versions ?? []).map((entry) => [entry.version, entry]));
  return {
    ...installedManifest,
    schema_versions: (installedManifest?.schema_versions ?? []).map((entry) => {
      if (canonicalSchemas.get(entry.version)?.schema_sha256) return entry;
      const { schema_sha256: _schemaSha256, ...withoutAddedHash } = entry;
      return withoutAddedHash;
    })
  };
}

export function validateOrchestrationRegistrySemantics(registry, canonicalRegistry) {
  const errors = [];
  const executorContract = registry?.schema_version === "17.0.0";
  const roles = Array.isArray(registry?.roles) ? registry.roles : [];
  const artifactTypes = Array.isArray(registry?.artifact_types) ? registry.artifact_types : [];
  const transitions = Array.isArray(registry?.transitions) ? registry.transitions : [];
  const roleIds = roles.map((role) => role?.id);
  const agentIds = roles.map((role) => role?.agent_id).filter((agentId) => agentId !== null && agentId !== undefined);
  const artifactTypeIds = artifactTypes.map((artifactType) => artifactType?.id);
  for (const duplicate of duplicateValues(roleIds)) errors.push(`Duplicate role ID: ${String(duplicate)}.`);
  for (const duplicate of duplicateValues(agentIds)) errors.push(`Duplicate agent ID: ${String(duplicate)}.`);
  for (const duplicate of duplicateValues(artifactTypeIds)) errors.push(`Duplicate artifact type ID: ${String(duplicate)}.`);

  const roleById = new Map(roles.map((role) => [role?.id, role]));
  const artifactTypeSet = new Set(artifactTypeIds);
  const canonicalRoles = new Map((canonicalRegistry?.roles ?? []).map((role) => [role.id, role]));
  for (const [roleId, canonicalRole] of canonicalRoles) {
    const installedRole = roleById.get(roleId);
    const expectedRole = roleId === "orchestrator"
      ? { ...canonicalRole, input_types: [...canonicalRole.input_types, "audit-context", "participant-usability-observation", "declared-change-record"] }
      : roleId === "authorized_fixer" && executorContract
        ? { ...canonicalRole, output_type: "fix-handoff", can_write_target: false }
      : canonicalRole;
    if (!installedRole) errors.push(`Missing canonical role: ${roleId}.`);
    else if (!isDeepStrictEqual(installedRole, expectedRole)) errors.push(`Canonical role contract changed: ${roleId}.`);
  }
  const installedArtifactTypes = new Map(artifactTypes.map((artifactType) => [artifactType?.id, artifactType]));
  for (const canonicalArtifactType of canonicalRegistry?.artifact_types ?? []) {
    const installedArtifactType = installedArtifactTypes.get(canonicalArtifactType.id);
    if (!installedArtifactType) errors.push(`Missing canonical artifact type: ${canonicalArtifactType.id}.`);
    else if (canonicalArtifactType.id === "audit-run") {
      if (!isDeepStrictEqual(installedArtifactType, currentAuditRunManifestContract)) errors.push("Canonical audit-run manifest changed.");
    } else if (canonicalArtifactType.id === "screening-observations") {
      if (!isDeepStrictEqual(installedArtifactType, currentScreeningManifestContract)) errors.push("Canonical screening-observations manifest changed.");
    } else if (canonicalArtifactType.id === "human-review-queue") {
      if (!isDeepStrictEqual(installedArtifactType, currentQueueManifestContract)) errors.push("Canonical human-review-queue manifest changed.");
    } else if (canonicalArtifactType.id === "remediation-plan") {
      if (!isDeepStrictEqual(installedArtifactType, currentRemediationManifestContract)) errors.push("Canonical remediation-plan manifest changed.");
    } else if (canonicalArtifactType.id === "declared-human-review") {
      if (!isDeepStrictEqual(installedArtifactType, currentHumanReviewManifestContract)) errors.push("Canonical declared-human-review manifest changed.");
    } else if (canonicalArtifactType.id === "change-record" && executorContract) {
      if (!isDeepStrictEqual(installedArtifactType, currentChangeManifestContract)) errors.push("Canonical change-record manifest changed.");
    } else {
      const currentHash = currentTimestampPayloadSchemaHashes.get(canonicalArtifactType.id);
      const expected = currentHash ? {
        ...canonicalArtifactType,
        schema_versions: canonicalArtifactType.schema_versions.map((entry) => entry.mode === "current" ? { ...entry, schema_sha256: currentHash } : entry)
      } : canonicalArtifactType;
      if (!isDeepStrictEqual(canonicalComparableManifest(installedArtifactType, expected), expected)) {
        errors.push(`Canonical artifact type manifest changed: ${canonicalArtifactType.id}.`);
      }
    }
  }

  for (const role of roles) {
    const roleId = String(role?.id);
    if (!artifactTypeSet.has(role?.output_type)) errors.push(`Role ${roleId} has an unregistered output artifact type: ${String(role?.output_type)}.`);
    for (const inputType of Array.isArray(role?.input_types) ? role.input_types : []) {
      if (!artifactTypeSet.has(inputType)) errors.push(`Role ${roleId} has an unregistered input artifact type: ${String(inputType)}.`);
    }
    if (role?.producer_kind === "ai_agent") {
      if (!['E0', 'E1'].includes(role?.max_ai_evidence_level)) errors.push(`AI role ${roleId} must not exceed E1 evidence.`);
      if (role?.can_record_profile_outcome) errors.push(`AI role ${roleId} cannot record profile outcomes.`);
    }
    if (role?.can_record_profile_outcome && roleId !== "declared_external_human") {
      errors.push(`Only declared_external_human may record profile outcomes; received ${roleId}.`);
    }
    if (role?.can_write_target && roleId !== (executorContract ? "trusted_fix_executor" : "authorized_fixer")) {
      errors.push(`Only the designated executor may write the target; received ${roleId}.`);
    }
    if (role?.can_write_target && role?.install_by_default) errors.push(`A target-writing role cannot be installed by default: ${roleId}.`);
    if (role?.output_type === "fix-authorization" && roleId !== "declared_authorizer") {
      errors.push(`Only declared_authorizer may produce fix-authorization; received ${roleId}.`);
    }
    if (role?.id === "trusted_fix_executor" && executorContract) {
      if (role.agent_id !== null || role.producer_kind !== "trusted_runtime"
          || !isDeepStrictEqual(role.input_types, ["remediation-plan", "fix-authorization", "fix-handoff"])
          || role.output_type !== "change-record" || role.max_ai_evidence_level !== null
          || role.can_record_profile_outcome !== false || role.can_write_target !== true
          || role.install_by_default !== false) errors.push("Invalid trusted fix executor contract.");
    } else if (["declared_change_reviewer", "declared_change_owner"].includes(role?.id)) {
      const kind = role.id === "declared_change_reviewer" ? "external_human" : "external_requester";
      if (role.producer_kind !== kind || role.agent_id !== null || role.output_type !== "declared-change-record"
          || role.can_record_profile_outcome !== false || role.can_write_target !== false
          || role.install_by_default !== false || role.max_ai_evidence_level !== null
          || !isDeepStrictEqual(role.input_types, ["remediation-plan"])) {
        errors.push(`Invalid declared change producer contract: ${role.id}.`);
      }
    } else if (role?.id === "declared_participant_facilitator") {
      if (role.producer_kind !== "external_human" || role.agent_id !== null
          || role.output_type !== "participant-usability-observation"
          || role.can_record_profile_outcome !== false || role.can_write_target !== false
          || role.install_by_default !== false || role.max_ai_evidence_level !== null
          || !isDeepStrictEqual(role.input_types, ["declared-human-review", "remediation-plan"])) {
        errors.push("Invalid participant facilitator producer contract.");
      }
    } else if (["declared_context_reviewer", "declared_context_owner"].includes(role?.id)) {
      const expectedKind = role.id === "declared_context_reviewer" ? "external_human" : "external_requester";
      const reviewerInputs = ["screening-observations", "human-review-queue", "declared-human-review", "remediation-plan"];
      const expectedInputs = role.id === "declared_context_owner" ? [...reviewerInputs, "audit-context"] : reviewerInputs;
      if (role.producer_kind !== expectedKind || role.agent_id !== null || role.output_type !== "audit-context"
          || role.can_record_profile_outcome !== false || role.can_write_target !== false
          || role.install_by_default !== false || role.max_ai_evidence_level !== null
          || !isDeepStrictEqual(role.input_types, expectedInputs)) {
        errors.push(`Invalid audit-context producer contract: ${role.id}.`);
      }
    } else if (!canonicalRoles.has(role?.id)) {
      if (role?.producer_kind !== "ai_agent"
          || !['E0', 'E1'].includes(role?.max_ai_evidence_level)
          || role?.can_record_profile_outcome !== false
          || role?.can_write_target !== false
          || ["audit-run", "fix-authorization", "fix-handoff", "change-record", "declared-change-record"].includes(role?.output_type)) {
        errors.push(`Extension role ${roleId} must remain a safe read-only AI role without orchestration, authorization, or change output.`);
      }
    }
  }
  const writers = roles.filter((role) => role?.can_write_target).map((role) => role.id);
  if (!isDeepStrictEqual(writers, [executorContract ? "trusted_fix_executor" : "authorized_fixer"])) {
    errors.push("The registry must contain exactly one trusted target writer.");
  }
  const authorizers = roles.filter((role) => role?.output_type === "fix-authorization").map((role) => role.id);
  if (!isDeepStrictEqual(authorizers, ["declared_authorizer"])) errors.push("The registry must contain exactly one fix authorizer: declared_authorizer.");
  if (executorContract && !isDeepStrictEqual(roles.filter((role) => role?.output_type === "fix-handoff").map((role) => role.id), ["authorized_fixer"])) {
    errors.push("Only the AI handoff role may produce fix-handoff.");
  }
  const changeDeclarants = roles.filter((role) => role?.output_type === "declared-change-record").map((role) => role.id);
  if (!isDeepStrictEqual(changeDeclarants, ["declared_change_reviewer", "declared_change_owner"])) {
    errors.push("Only the two external declaration roles may produce declared-change-record.");
  }
  if (executorContract) {
    const handoff = installedArtifactTypes.get("fix-handoff");
    const expected = { id: "fix-handoff", latest_schema_version: "1.0.0", schema_versions: [
      { version: "1.0.0", schema_file: "fix-handoff.schema.json",
        schema_sha256: "bf68ce1f29a71b342590c0c7fe3b05ba2b14092c8f1787571efd4675bb7f87a7", mode: "current" }
    ] };
    if (!isDeepStrictEqual(handoff, expected)) errors.push("Invalid fix-handoff manifest.");
  }

  const transitionKeys = [];
  const routeKeys = [];
  const states = new Set(["initialized"]);
  const adjacency = new Map();
  const transitionArtifactTypes = new Set();
  const canonicalTransitions = [...(canonicalRegistry?.transitions ?? []),
    { from: "initialized", to: "human_queue_ready", required_artifact_types: ["human-review-queue"] }];
  const canonicalStates = new Set([
    "initialized",
    ...canonicalTransitions.flatMap((transition) => [transition.from, transition.to])
  ]);
  for (const canonicalTransition of canonicalTransitions) {
    if (!transitions.some((transition) => isDeepStrictEqual(transition, canonicalTransition))) {
      errors.push(`Missing or changed canonical transition: ${canonicalTransition.from} -> ${canonicalTransition.to}.`);
    }
  }
  for (const transition of transitions) {
    const isCanonicalTransition = canonicalTransitions.some((canonicalTransition) => isDeepStrictEqual(transition, canonicalTransition));
    const required = Array.isArray(transition?.required_artifact_types) ? transition.required_artifact_types : [];
    if (required.length !== 1) errors.push(`Transition ${String(transition?.from)} -> ${String(transition?.to)} must require exactly one artifact type.`);
    const artifactType = required[0];
    if (artifactType && !artifactTypeSet.has(artifactType)) errors.push(`Transition requires an unregistered artifact type: ${artifactType}.`);
    if (artifactType && !roles.some((role) => role?.output_type === artifactType)) errors.push(`Transition artifact type has no producer role: ${artifactType}.`);
    if (transition?.from === transition?.to) errors.push(`Transition cannot form a self-cycle: ${String(transition?.from)}.`);
    if (["fix-authorization", "change-record"].includes(artifactType) && !isCanonicalTransition) {
      errors.push(`Privileged artifact type cannot define an extension transition: ${String(artifactType)}.`);
    }
    const declaredChangeTransition = transition?.from === "remediation_ready" && transition?.to === "retest_required"
      && isDeepStrictEqual(required, ["declared-change-record"]);
    if (!isCanonicalTransition && canonicalStates.has(transition?.to) && !declaredChangeTransition) {
      errors.push(`Extension transition cannot enter canonical orchestration state: ${String(transition?.to)}.`);
    }
    if (artifactType === "declared-change-record" && !declaredChangeTransition) {
      errors.push("Declared change records may only advance remediation_ready to retest_required.");
    }
    transitionKeys.push(`${String(transition?.from)}\u0000${String(artifactType)}`);
    routeKeys.push(`${String(transition?.from)}\u0000${String(transition?.to)}`);
    states.add(transition?.from);
    states.add(transition?.to);
    if (!adjacency.has(transition?.from)) adjacency.set(transition?.from, []);
    adjacency.get(transition?.from).push(transition?.to);
    if (artifactType) transitionArtifactTypes.add(artifactType);
  }
  for (const duplicate of duplicateValues(transitionKeys)) errors.push(`Ambiguous transition for state and artifact type: ${duplicate.replace("\u0000", " + ")}.`);
  for (const duplicate of duplicateValues(routeKeys)) errors.push(`Duplicate transition route: ${duplicate.replace("\u0000", " -> ")}.`);
  for (const artifactType of artifactTypeIds.filter((id) => !["audit-run", "audit-context", "participant-usability-observation", "fix-handoff"].includes(id))) {
    if (!roles.some((role) => role?.output_type === artifactType)) errors.push(`Registered artifact type has no producer role: ${artifactType}.`);
    if (!transitionArtifactTypes.has(artifactType)) errors.push(`Registered artifact type has no transition: ${artifactType}.`);
  }

  const reachable = new Set();
  const queue = ["initialized"];
  while (queue.length) {
    const state = queue.shift();
    if (reachable.has(state)) continue;
    reachable.add(state);
    queue.push(...(adjacency.get(state) ?? []));
  }
  for (const state of states) if (!reachable.has(state)) errors.push(`Unreachable orchestration state: ${String(state)}.`);

  const visiting = new Set();
  const visited = new Set();
  function visit(state) {
    if (visiting.has(state)) {
      errors.push(`Orchestration transition cycle detected at state: ${String(state)}.`);
      return;
    }
    if (visited.has(state)) return;
    visiting.add(state);
    for (const next of adjacency.get(state) ?? []) visit(next);
    visiting.delete(state);
    visited.add(state);
  }
  visit("initialized");
  return errors;
}
