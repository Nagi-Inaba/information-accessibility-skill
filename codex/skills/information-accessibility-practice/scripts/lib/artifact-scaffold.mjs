const definitions = Object.freeze({
  "screening-observations": { producer_role: "e1_inspector", payload: { observations: [] } },
  "human-review-queue": { producer_role: "human_queue_planner", payload: { items: [] } },
  "declared-human-review": { producer_role: "declared_external_human", payload: { reviewer_name: "", review_date: "", reviews: [] } },
  "remediation-plan": { producer_role: "remediation_planner", payload: { items: [] } },
  "change-record": { producer_role: "authorized_fixer", payload: { changes: [], verification: [] } }
});

export const scaffoldArtifactTypes = Object.freeze(Object.keys(definitions));

export function createArtifactScaffold({ run, artifactType, artifactId, producerRole, createdAt, inputArtifactIds = [] }) {
  if (!run || typeof run.run_id !== "string" || !run.run_id) throw new Error("run.run_id is required");
  const definition = definitions[artifactType];
  if (!definition) throw new Error(`Unsupported artifact type: ${String(artifactType)}`);
  if (typeof artifactId !== "string" || !artifactId) throw new Error("artifactId is required");
  if (producerRole !== definition.producer_role) {
    throw new Error(`${artifactType} must be produced by ${definition.producer_role}`);
  }
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) throw new Error("createdAt must be an RFC 3339 instant");
  return {
    schema_version: "2.0.0",
    artifact_id: artifactId,
    artifact_type: artifactType,
    run_id: run.run_id,
    producer: { role_id: producerRole },
    created_at: createdAt,
    input_artifact_ids: [...new Set(inputArtifactIds)].sort(),
    payload: structuredClone(definition.payload),
    scaffold: {
      status: "incomplete",
      instructions: "Fill the payload, validate it against the current registered schema, then register a new immutable artifact file."
    }
  };
}
