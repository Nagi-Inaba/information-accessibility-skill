import { isDeepStrictEqual } from "node:util";
import { compareInstants } from "./date-time.mjs";
import { evidenceBindingErrors } from "./run-evidence.mjs";
import { verifyEvidenceReference } from "./evidence-reference.mjs";

const perspectives = ["find", "receive", "understand", "participate", "continue"];
const reviewerKinds = new Set(["participation", "limitation"]);
const ownerKinds = new Set(["next_review", "independent_audit", "dossier"]);

export function contextArtifacts(envelopesById) {
  return [...envelopesById.values()]
    .map((record) => record?.envelope ?? record)
    .filter((artifact) => artifact?.artifact_type === "audit-context")
    .sort((a, b) => String(a.artifact_id).localeCompare(String(b.artifact_id), "en"));
}

export function validateContextBindings(envelopesById, errors) {
  const seen = new Set();
  for (const artifact of contextArtifacts(envelopesById)) {
    if (!artifact.payload || !Array.isArray(artifact.inputs) || !Array.isArray(artifact.payload.source_artifact_ids)) {
      errors.push(`Invalid audit-context envelope: ${String(artifact.artifact_id)}.`);
      continue;
    }
    const { kind, value, source_artifact_ids: sources, declared_at: declaredAt } = artifact.payload;
    if (!value || typeof value !== "object") {
      errors.push(`Invalid audit-context value: ${String(artifact.artifact_id)}.`);
      continue;
    }
    const role = artifact.producer?.role_id;
    if ((reviewerKinds.has(kind) && role !== "declared_context_reviewer")
        || (ownerKinds.has(kind) && role !== "declared_context_owner")) {
      errors.push(`audit-context ${artifact.artifact_id}: ${role} cannot declare ${kind}.`);
    }
    const inputIds = artifact.inputs.map((input) => input?.artifact_id).sort();
    if (!isDeepStrictEqual([...sources].sort(), inputIds)) {
      errors.push(`audit-context ${artifact.artifact_id}: source_artifact_ids must exactly match its registered inputs.`);
    }
    if (compareInstants(declaredAt, artifact.created_at) > 0) {
      errors.push(`audit-context ${artifact.artifact_id}: declaration follows artifact creation.`);
    }
    const key = kind === "participation" ? `participation:${value.perspective}`
      : kind === "limitation" ? `limitation:${value.text}` : kind;
    if (seen.has(key)) errors.push(`Conflicting audit-context declaration: ${key}.`);
    seen.add(key);
    if (kind === "independent_audit" && value.performed && (!value.evaluator_independent || !value.scope_method || !value.report_location)) {
      errors.push("Performed independent audit requires independence, scope/method, and report location.");
    }
    if (kind === "dossier" && value.prepared && (!value.responsible_owner || !value.artifacts.length)) {
      errors.push("Prepared dossier requires a responsible owner and artifacts.");
    }
  }
}

export function collectContextEvidence(run, artifacts, readEvidence) {
  const errors = [];
  const snapshots = new Map();
  for (const artifact of artifacts.filter((item) => item?.artifact_type === "audit-context")) {
    if (!Array.isArray(artifact.payload?.evidence_refs)) {
      errors.push(`audit-context ${String(artifact.artifact_id)}: evidence_refs must be an array.`);
      continue;
    }
    const seen = new Set();
    for (const reference of artifact.payload.evidence_refs) {
      const label = `audit-context ${artifact.artifact_id}`;
      if (!["other", "screenshot"].includes(reference.evidence_type)) {
        errors.push(`${label}: context source must be saved document or screenshot evidence.`);
        continue;
      }
      errors.push(...evidenceBindingErrors(reference, run).map((error) => `${label}: ${error}`));
      if (seen.has(reference.path)) errors.push(`${label}: duplicate evidence path ${reference.path}.`);
      seen.add(reference.path);
      if (compareInstants(reference.captured_at, artifact.payload.declared_at) > 0) {
        errors.push(`${label}: evidence capture follows declaration.`);
      }
      try {
        const snapshot = snapshots.get(reference.path) ?? readEvidence?.(reference.path);
        if (!snapshot || !Buffer.isBuffer(snapshot.bytes)) throw new Error("Saved evidence bytes are required.");
        verifyEvidenceReference(reference, snapshot.bytes);
        if (snapshot.sha256 !== reference.sha256) throw new Error("Evidence snapshot hash mismatch.");
        snapshots.set(reference.path, snapshot);
      } catch (error) { errors.push(`${label}: ${error.message}`); }
    }
  }
  return { errors, snapshots };
}

export function projectAuditContext(envelopesById) {
  const coverage = Object.fromEntries(perspectives.map((key) => [key, "not_tested"]));
  const assurance = {
    independent_audit: { performed: false, evaluator_independent: false, scope_method: "", report_location: "" },
    legal_or_procurement_dossier: { prepared: false, responsible_owner: "", artifacts: [] }
  };
  const result = { coverage, assurance, limitations: [], next_review_at: null, next_review_owner: null,
    next_review_condition: null, declarations: [] };
  for (const artifact of contextArtifacts(envelopesById)) {
    const { kind, value, publication } = artifact.payload;
    result.declarations.push({ kind, publication, value: structuredClone(value) });
    if (kind === "participation") coverage[value.perspective] = value.outcome;
    if (kind === "limitation") result.limitations.push(value.text);
    if (kind === "next_review") {
      result.next_review_at = value.at;
      result.next_review_owner = value.owner;
      result.next_review_condition = value.condition;
    }
    if (kind === "independent_audit") assurance.independent_audit = structuredClone(value);
    if (kind === "dossier") assurance.legal_or_procurement_dossier = structuredClone(value);
  }
  return result;
}
