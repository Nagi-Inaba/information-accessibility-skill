import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cli, pass, read } from "./helpers/scanner-import.mjs";

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
  }
});
