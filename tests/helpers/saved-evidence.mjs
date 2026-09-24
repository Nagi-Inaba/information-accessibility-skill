import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRunEvidenceReference } from "../../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";
import { fixtureBytes, fixtureEvidenceBytes } from "./measured-targets.mjs";

export { fixtureBytes } from "./measured-targets.mjs";
export const fixturePath = "captured-dom.html";
export function fixtureReference(run, capturedAt) {
  return createRunEvidenceReference({ run, targetRef: run.target.urls_or_files[0], evidenceType: "dom_snapshot", relativePath: fixturePath, bytes: fixtureEvidenceBytes(run), capturedAt });
}
export function saveFixtureEvidence(root, run) {
  const file = path.join(root, fixturePath);
  if (!fs.existsSync(file)) fs.writeFileSync(file, run ? fixtureEvidenceBytes(run) : fixtureBytes);
}
export function bindFixtureEvidence(artifact, run, root) {
  artifact.payload.schema_version = ["12.0.0", "13.0.0", "14.0.0", "15.0.0"].includes(run.schema_version) ? "4.0.0" : "3.0.0";
  for (const observation of artifact.payload.observations) observation.evidence_refs = [fixtureReference(run, observation.captured_at)];
  if (root) saveFixtureEvidence(root, run);
  return artifact;
}
export function fixtureEvidenceSnapshots(root) {
  const bytes = fs.readFileSync(path.join(root, fixturePath));
  return new Map([[fixturePath, { bytes, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }]]);
}
export function schemaFixtureReference(capturedAt) {
  return fixtureReference({ run_id: "RUN-20260717T120000Z-TEST0001", target: { name: "Fixture", version_or_commit: "fixture-v1", urls_or_files: ["fixture.html"] }, environment: { os: [], browsers: [], assistive_technologies: [], input_modes: [] } }, capturedAt);
}
