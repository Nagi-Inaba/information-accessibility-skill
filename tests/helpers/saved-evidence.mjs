import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRunEvidenceReference } from "../../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";

export const fixtureBytes = Buffer.from("<!doctype html><html lang=\"en\"><title>Fixture</title><main><h1>Fixture</h1></main></html>\n");
export const fixturePath = "captured-dom.html";
export function fixtureReference(run, capturedAt) {
  return createRunEvidenceReference({ run, targetRef: run.target.urls_or_files[0], evidenceType: "dom_snapshot", relativePath: fixturePath, bytes: fixtureBytes, capturedAt });
}
export function saveFixtureEvidence(root) {
  const file = path.join(root, fixturePath);
  if (!fs.existsSync(file)) fs.writeFileSync(file, fixtureBytes);
}
export function bindFixtureEvidence(artifact, run, root) {
  artifact.payload.schema_version = "3.0.0";
  for (const observation of artifact.payload.observations) observation.evidence_refs = [fixtureReference(run, observation.captured_at)];
  if (root) saveFixtureEvidence(root);
  return artifact;
}
export function fixtureEvidenceSnapshots(root) {
  const bytes = fs.readFileSync(path.join(root, fixturePath));
  return new Map([[fixturePath, { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }]]);
}
export function schemaFixtureReference(capturedAt) {
  return fixtureReference({ run_id: "RUN-20260717T120000Z-TEST0001", target: { name: "Fixture", version_or_commit: "fixture-v1", urls_or_files: ["fixture.html"] }, environment: { os: [], browsers: [], assistive_technologies: [], input_modes: [] } }, capturedAt);
}
