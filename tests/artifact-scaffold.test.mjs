import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactScaffold, scaffoldArtifactTypes } from "../codex/skills/information-accessibility-practice/scripts/lib/artifact-scaffold.mjs";

test("screening and human-review scaffolds preserve run and producer identity", () => {
  const screening = createArtifactScaffold({
    run: { run_id: "RUN-1" },
    artifactType: "screening-observations",
    artifactId: "ART-SCREEN-1",
    producerRole: "e1_inspector",
    createdAt: "2026-08-22T00:00:00Z",
    inputArtifactIds: ["ART-BASE", "ART-BASE"]
  });
  assert.equal(screening.run_id, "RUN-1");
  assert.deepEqual(screening.input_artifact_ids, ["ART-BASE"]);
  assert.deepEqual(screening.payload, { observations: [] });
  assert.equal(screening.scaffold.status, "incomplete");

  const queue = createArtifactScaffold({
    run: { run_id: "RUN-1" },
    artifactType: "human-review-queue",
    artifactId: "ART-QUEUE-1",
    producerRole: "human_queue_planner",
    createdAt: "2026-08-22T00:00:00Z"
  });
  assert.deepEqual(queue.payload, { items: [] });
});

test("producer-role mismatches and unknown artifact types fail closed", () => {
  assert.ok(scaffoldArtifactTypes.includes("change-record"));
  assert.throws(() => createArtifactScaffold({
    run: { run_id: "RUN-1" }, artifactType: "declared-human-review", artifactId: "A", producerRole: "e1_inspector", createdAt: "2026-08-22T00:00:00Z"
  }), /must be produced by declared_external_human/u);
  assert.throws(() => createArtifactScaffold({
    run: { run_id: "RUN-1" }, artifactType: "unknown", artifactId: "A", producerRole: "x", createdAt: "2026-08-22T00:00:00Z"
  }), /Unsupported artifact type/u);
});
