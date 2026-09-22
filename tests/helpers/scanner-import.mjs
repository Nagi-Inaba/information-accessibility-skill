import { createHumanReviewQueue } from "../../codex/skills/information-accessibility-practice/scripts/lib/human-review-queue.mjs";
import { screeningMappings } from "../../codex/skills/information-accessibility-practice/scripts/lib/review-details.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAuditRun, bindTargetInventory, writeNewJson, readStableFile } from "../../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { observeRunTargets, targetSnapshotIds } from "../../codex/skills/information-accessibility-practice/scripts/lib/run-targets.mjs";
import { lookupRequirement } from "../../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";

export const cliFile = fileURLToPath(new URL("../../codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs", import.meta.url));
export const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export function cli(args) {
  return spawnSync(process.execPath, [cliFile, ...args], { encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
}
export function pass(result) { assert.equal(result.status, 0, result.stderr || result.stdout); }

export async function measuredScannerRun(root, bundleFile, targetRef) {
  const artifactRoot = path.dirname(bundleFile);
  const runFile = path.join(root, "run.json");
  const run = createAuditRun({ runFile, artifactRoot, runId: "RUN-20260919T000000Z-IMPORT01", profile: "web-modern",
    targetName: "Scanner fixture", targetVersion: "fixture-v1", targetRefs: [targetRef], network: "none", interaction: "safe_read_only", sourceWrite: "none",
    inspectionMode: "quick", inspectionPurpose: "Review imported machine signals" });
  const inventory = await observeRunTargets(run, [{ kind: "web_state", target_ref: targetRef, bundle_path: bundleFile,
    locale: "ja-JP", authentication_state_id: "fixture-state", feature_flags: [] }]);
  const bound = bindTargetInventory(run, inventory, { runFile });
  writeNewJson(runFile, bound);
  return { root, artifactRoot, runFile, run: bound };
}

export function importedReport(f, artifactFile) {
  const screen = read(artifactFile);
  const screenedFile = path.join(f.root, "screened.json");
  pass(cli(["register", "--run", f.runFile, "--artifact", artifactFile, "--output", screenedFile]));
  const profileIds = [...new Set(screen.payload.observations.flatMap((row) => screeningMappings(row).map((mapping) => mapping.requirement_id)))];
  const items = profileIds.map((requirementId) => ({ requirement_id: requirementId, ...lookupRequirement("web-modern", requirementId).procedure_binding }));
  const queue = { schema_version: "3.0.0", artifact_id: "ART-IMPORT-QUEUE", artifact_type: "human-review-queue", run_id: f.run.run_id,
    target_snapshot_ids: targetSnapshotIds(f.run), producer: { role_id: "human_queue_planner", producer_kind: "ai_agent", origin: "import integration fixture" },
    created_at: new Date().toISOString(), inputs: [{ artifact_id: screen.artifact_id, run_id: f.run.run_id, sha256: readStableFile(artifactFile).sha256 }],
    payload: { schema_version: "2.0.0", items, procedure_coverage: { total_requirements: items.length,
      available_procedures: items.filter((item) => item.procedure_availability === "available").length,
      unavailable_procedures: items.filter((item) => item.procedure_availability === "unavailable").length } } };
  queue.payload = createHumanReviewQueue({ run: f.run, screenings: [screen] });
  const queueFile = path.join(f.artifactRoot, "queue.json");
  writeNewJson(queueFile, queue);
  const queuedFile = path.join(f.root, "queued.json");
  pass(cli(["register", "--run", screenedFile, "--artifact", queueFile, "--output", queuedFile]));
  const baseline = path.join(f.root, "baseline.json");
  pass(cli(["assessment", "--profile", "web-modern", "--target-name", f.run.target.name, "--target-version", f.run.target.version_or_commit,
    "--target-ref", f.run.target.urls_or_files[0], "--evaluator", "Import fixture", "--evaluated-at", "2026-09-19", "--output", baseline]));
  const assessment = read(baseline);
  assessment.assessment.scope = structuredClone(f.run.scope);
  assessment.assessment.environment = structuredClone(f.run.environment);
  fs.writeFileSync(baseline, JSON.stringify(assessment), "utf8");
  const merged = path.join(f.root, "merged.json");
  pass(cli(["merge", "--run", queuedFile, "--assessment", baseline, "--artifact", artifactFile, "--artifact", queueFile, "--output", merged]));
  const report = path.join(f.root, "report.md");
  pass(cli(["report", "--run", queuedFile, "--assessment", merged, "--output", report]));
  return { report: fs.readFileSync(report, "utf8"), assessment: read(merged), runFile: queuedFile };
}
