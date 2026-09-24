import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cli, pass, read } from "./helpers/scanner-import.mjs";
import { createHumanReviewQueue } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-queue.mjs";
import { targetSnapshotIds } from "../codex/skills/information-accessibility-practice/scripts/lib/run-targets.mjs";

const example = fileURLToPath(new URL("../examples/run-backed-web-audit/run.mjs", import.meta.url));
const save = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const rejected = (result, pattern) => { assert.notEqual(result.status, 0); assert.match(result.stderr, pattern); };

test("core-only manual, vendor and pull-request changes require measured target drift before retest", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "declared-change-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  pass(spawnSync(process.execPath, [example, "--output", root], { encoding: "utf8", shell: false }));
  const scenario = path.join(root, "human-reviewed"), artifacts = path.join(scenario, "artifacts");
  const before = path.join(scenario, "audit-run.json"), old = read(before);
  assert.equal(old.status, "remediation_ready");
  assert.equal(old.permissions.source_write, "denied");
  const specsFile = path.join(artifacts, "target-specifications.json"), spec = read(specsFile)[0];
  const unchanged = path.join(artifacts, "unchanged.json");
  pass(cli(["capture-targets", "--run", before, "--specs", specsFile, "--after-version", "fixture-v2", "--output", unchanged]));
  const plan = read(path.join(artifacts, "remediation-plan.json"));
  const evidenceFile = path.join(artifacts, "change-declaration.txt");
  fs.writeFileSync(evidenceFile, "A human reports the saved target change for this synthetic fixture.\n", "utf8");
  const payloadFile = path.join(artifacts, "change-payload.json");
  const basePayload = { publication: "private_by_default", change_kind: "manual", actor_name: "Fixture editor",
    declarant_name: "Fixture reviewer", summary: "Updated the saved page content",
    before_version: old.target.version_or_commit, after_version: "fixture-v2",
    remediation_ids: [plan.payload.items[0].remediation_id] };
  const author = (kind, inventory, output) => {
    const timestamp = new Date().toISOString();
    save(payloadFile, { ...basePayload, change_kind: kind, declared_at: timestamp });
    return cli(["artifact", "init", "--run", before, "--type", "declared-change-record", "--payload", payloadFile,
      "--input", plan.artifact_id, "--role", "declared_change_reviewer", "--after-inventory", inventory,
      "--evidence-file", evidenceFile, "--target-ref", old.target.urls_or_files[0], "--captured-at", timestamp,
      "--output", output]);
  };
  rejected(author("manual", unchanged, path.join(artifacts, "unchanged-artifact.json")), /measured target identity did not change/);

  const originalBundle = read(spec.bundle_path), bundle = structuredClone(originalBundle);
  bundle.captured_at = new Date().toISOString();
  bundle.evidence.dom += "\n<!-- repaired fixture state -->\n";
  bundle.target.dom_sha256 = crypto.createHash("sha256").update(bundle.evidence.dom).digest("hex");
  const newBundlePath = path.join(artifacts, "repaired-state.json"), afterSpecs = path.join(artifacts, "after-specs.json");
  save(newBundlePath, bundle); save(afterSpecs, [{ ...spec, bundle_path: newBundlePath }]);
  const identicalBundle = { ...structuredClone(originalBundle), captured_at: bundle.captured_at };
  const identicalPath = path.join(artifacts, "identical-state.json"), identicalSpecs = path.join(artifacts, "identical-specs.json");
  save(identicalPath, identicalBundle); save(identicalSpecs, [{ ...spec, bundle_path: identicalPath }]);
  const identicalInventory = path.join(artifacts, "identical-inventory.json");
  pass(cli(["capture-targets", "--run", before, "--specs", identicalSpecs, "--after-version", "fixture-v2", "--output", identicalInventory]));
  rejected(author("manual", identicalInventory, path.join(artifacts, "identical-artifact.json")), /measured target identity did not change/);
  const swappedSpecs = path.join(artifacts, "swapped-specs.json");
  save(swappedSpecs, [{ ...spec, bundle_path: newBundlePath, authentication_state_id: "unrelated-state" }]);
  const swappedInventory = path.join(artifacts, "swapped-inventory.json");
  pass(cli(["capture-targets", "--run", before, "--specs", swappedSpecs, "--after-version", "fixture-v2", "--output", swappedInventory]));
  rejected(author("manual", swappedInventory, path.join(artifacts, "swapped-artifact.json")), /same target specification/);
  for (const kind of ["manual", "vendor", "pull_request"]) {
    const inventory = path.join(artifacts, `after-${kind}.json`);
    pass(cli(["capture-targets", "--run", before, "--specs", afterSpecs, "--after-version", "fixture-v2", "--output", inventory]));
    const candidate = path.join(artifacts, `declared-${kind}.json`);
    pass(author(kind, inventory, candidate));
    const recorded = read(candidate);
    assert.equal(recorded.producer.producer_kind, "external_human");
    assert.equal(recorded.payload.change_kind, kind);
    if (kind !== "manual") continue;
    const forged = structuredClone(recorded), forgedFile = path.join(artifacts, "forged-ai.json");
    forged.producer.producer_kind = "ai_agent"; save(forgedFile, forged);
    rejected(cli(["artifact", "validate", "--run", before, "--artifact", forgedFile]), /Producer kind/);
    const after = path.join(scenario, "declared-run.json");
    save(newBundlePath, identicalBundle);
    rejected(cli(["register", "--run", before, "--artifact", candidate, "--output", after]), /Target drift/);
    save(newBundlePath, bundle);
    pass(cli(["register", "--run", before, "--artifact", candidate, "--output", after]));
    assert.equal(read(after).status, "retest_required");
    const retestRoot = path.join(scenario, "retest-artifacts"); fs.mkdirSync(retestRoot);
    const retest = path.join(scenario, "retest-run.json");
    const args = ["retest", "--supersedes-run", after, "--run-id", "RUN-20260924T170000Z-RETEST01",
      "--profile", old.profile.id, "--target-name", old.target.name, "--target-version", "fixture-v2",
      ...old.target.urls_or_files.flatMap((ref) => ["--target-ref", ref]), "--artifact-root", retestRoot,
      "--network", "none", "--interaction", "safe_read_only", "--source-write", "none", "--output", retest];
    pass(cli(args));
    assert.equal(read(retest).target_inventory, null);
    const invalidArgs = args.map((value) => value === "fixture-v2" ? "unrecorded-v3" : value);
    invalidArgs[invalidArgs.length - 1] = path.join(scenario, "invalid-retest-run.json");
    rejected(cli(invalidArgs), /registered declared change/);
    const deltaFile = path.join(retestRoot, "retest-delta.json"), reportFile = path.join(retestRoot, "retest-delta.md");
    pass(cli(["compare-runs", "--before", after, "--after", retest, "--output", deltaFile, "--report", reportFile]));
    const delta = read(deltaFile);
    assert.equal(delta.before_run_id, read(after).run_id);
    assert.equal(delta.after_run_id, read(retest).run_id);
    assert.ok(delta.findings.every((finding) => finding.status === "not_retested"));
    assert.ok(delta.remediation.some((item) => item.remediation_id === plan.payload.items[0].remediation_id && item.status === "declared_change_recorded"));
    assert.match(fs.readFileSync(reportFile, "utf8"), /再検査の前後比較/);
    rejected(cli(["compare-runs", "--before", before, "--after", retest, "--output", path.join(retestRoot, "wrong.json"),
      "--report", path.join(retestRoot, "wrong.md")]), /successor/);
    rejected(cli(["compare-runs", "--before", after, "--after", retest, "--output", path.join(scenario, "outside-delta.json"),
      "--report", path.join(retestRoot, "inside-report.md")]), /private artifact root/);

    const retestBundle = path.join(retestRoot, "retest-state.json"), retestSpecs = path.join(retestRoot, "retest-specs.json");
    save(retestBundle, bundle); save(retestSpecs, [{ ...spec, bundle_path: retestBundle }]);
    const retestInventory = path.join(retestRoot, "retest-inventory.json"), boundRetest = path.join(scenario, "retest-bound.json");
    pass(cli(["capture-targets", "--run", retest, "--specs", retestSpecs, "--output", retestInventory]));
    pass(cli(["bind-targets", "--run", retest, "--targets", retestInventory, "--output", boundRetest]));
    const bound = read(boundRetest), ids = targetSnapshotIds(bound);
    const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const sourceScreen = read(path.join(artifacts, "screening-observations.json"));
    const screen = structuredClone(sourceScreen), screenFile = path.join(retestRoot, "retest-screen.json");
    screen.artifact_id = "ART-RETEST-SCREEN"; screen.run_id = bound.run_id; screen.target_snapshot_ids = ids;
    screen.created_at = "2026-09-25T02:00:01Z";
    screen.payload.observations[0].captured_at = screen.created_at;
    screen.payload.observations[0].evidence_level = "E0";
    screen.payload.observations[0].evidence_refs = [];
    screen.payload.observations[0].report_outcome = "not_tested";
    save(screenFile, screen);
    const screenedRetest = path.join(scenario, "retest-screened.json");
    pass(cli(["register", "--run", boundRetest, "--artifact", screenFile, "--output", screenedRetest]));
    const queue = read(path.join(artifacts, "human-review-queue.json")), queueFile = path.join(retestRoot, "retest-queue.json");
    queue.artifact_id = "ART-RETEST-QUEUE"; queue.run_id = bound.run_id; queue.target_snapshot_ids = ids;
    queue.created_at = "2026-09-25T02:00:02Z";
    queue.inputs = [{ artifact_id: screen.artifact_id, run_id: bound.run_id, sha256: hash(screenFile) }];
    queue.payload = createHumanReviewQueue({ run: bound, screenings: [screen] });
    save(queueFile, queue);
    const queuedRetest = path.join(scenario, "retest-queued.json");
    pass(cli(["register", "--run", screenedRetest, "--artifact", queueFile, "--output", queuedRetest]));
    const human = read(path.join(artifacts, "declared-human-review.json")), humanFile = path.join(retestRoot, "retest-human.json");
    human.artifact_id = "ART-RETEST-HUMAN"; human.run_id = bound.run_id; human.target_snapshot_ids = ids;
    human.created_at = "2026-09-25T02:00:03Z";
    human.inputs = [{ artifact_id: queue.artifact_id, run_id: bound.run_id, sha256: hash(queueFile) }];
    human.payload.reviews[0].review_id = "HR-RETEST-PASS";
    human.payload.reviews[0].profile_outcome = "pass";
    human.payload.reviews[0].rationale = "External human verification of the repaired fixture.";
    human.payload.reviews[0].target_specific_evidence.forEach((item) => { item.captured_at = human.created_at; });
    save(humanFile, human);
    const reviewedRetest = path.join(scenario, "retest-reviewed.json");
    pass(cli(["register", "--run", queuedRetest, "--artifact", humanFile, "--output", reviewedRetest]));

    const lifePatch = path.join(artifacts, "lifecycle-patch.json");
    let priorLife = path.join(artifacts, "lifecycle-1.json");
    const lifeBase = Date.now();
    const lifeAt = (step) => new Date(lifeBase + step).toISOString();
    pass(cli(["lifecycle", "init", "--run", after, "--finding", plan.payload.items[0].remediation_id,
      "--updated-at", lifeAt(1), "--output", priorLife]));
    const advance = (number, patch) => {
      const next = path.join(artifacts, `lifecycle-${number}.json`);
      save(lifePatch, patch);
      pass(cli(["lifecycle", "advance", "--run", after, "--before", priorLife, "--input", lifePatch, "--output", next]));
      priorLife = next;
    };
    advance(2, { status: "planned", updated_at: lifeAt(2) });
    advance(3, { status: "in_progress", updated_at: lifeAt(3) });
    advance(4, { status: "fixed", updated_at: lifeAt(4) });
    const verificationFile = path.join(retestRoot, "verification.txt");
    fs.writeFileSync(verificationFile, "External human checked the repaired image alternative.\n", "utf8");
    const closure = { change_artifact_id: recorded.artifact_id,
      retest_run_file: path.relative(scenario, reviewedRetest), retest_run_sha256: hash(reviewedRetest),
      verification_file: path.basename(verificationFile), verification_sha256: hash(verificationFile) };
    advance(5, { status: "verified", closure, updated_at: lifeAt(5) });
    advance(6, { status: "closed", updated_at: lifeAt(6) });
    const closedStatus = cli(["status", "--run", after, "--lifecycle", priorLife, "--as-of", "2026-09-26", "--format", "json"]);
    pass(closedStatus);
    assert.equal(JSON.parse(closedStatus.stdout).lifecycle[0].resolution_claim, "verified_closure");
  }
});
