import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import crypto from "node:crypto";
import { loadAuditResources } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { findingRetestSummary } from "../codex/skills/information-accessibility-practice/scripts/lib/run-findings.mjs";
import { createHumanReviewRecord } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-provenance.mjs";
import { reviewRecordSha256 } from "../codex/skills/information-accessibility-practice/scripts/lib/assessment-provenance.mjs";
import { cli, pass, read } from "./helpers/scanner-import.mjs";

test("finding plans link several observations and criteria without duplicating remedies", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "finding-relations-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  pass(spawnSync(process.execPath, [example, "--output", root], { encoding: "utf8", shell: false }));
  const scenario = path.join(root, "human-reviewed"), artifacts = path.join(scenario, "artifacts");
  let runFile = path.join(scenario, "audit-run.bound.json");
  const ids = ["WCAG-2.2-SC-1.1.1", "WCAG-2.2-SC-1.3.1", "WCAG-2.2-SC-4.1.2"], registered = [];
  function author(type, id, payload, inputs = [], register = true) {
    const input = path.join(artifacts, id + ".payload.json"), output = path.join(artifacts, id + ".json");
    write(input, payload);
    pass(cli(["artifact", "init", "--run", runFile, "--type", type, "--artifact-id", id, "--payload", input,
      ...inputs.flatMap((value) => ["--input", value]), "--output", output]));
    if (register) add(output);
    return output;
  }
  function add(file) {
    const next = path.join(scenario, "relations-" + registered.length + ".json");
    pass(cli(["register", "--run", runFile, "--artifact", file, "--output", next]));
    registered.push(file); runFile = next;
  }
  const screen = read(path.join(artifacts, "screening-observations.json")).payload;
  screen.observations = [0, 1].map((index) => {
    const observation = structuredClone(screen.observations[0]);
    observation.requirement_id = "SCREEN-RELATION-" + index;
    for (const key of ["profile_requirement_id", "report_outcome", "applicability", "report_rationale"]) delete observation[key];
    observation.profile_mappings = ids.map((id) => ({ requirement_id: id, report_outcome: "cant_tell", applicability: "undetermined", rationale: "Synthetic relation rationale " + index }));
    return observation;
  });
  author("screening-observations", "ART-RELATION-SCREEN", screen);
  const queueFile = path.join(artifacts, "relations-queue.json");
  pass(cli(["review-queue", "--run", runFile, "--artifact-id", "ART-RELATION-QUEUE", "--output", queueFile])); add(queueFile);
  const human = read(path.join(artifacts, "declared-human-review.json")).payload, original = human.reviews[0];
  human.reviews = read(queueFile).payload.items.map((item) => ({ ...structuredClone(original), requirement_id: item.requirement_id,
    review_id: `HR-RELATION-${item.requirement_id}`,
    procedure_availability: item.procedure_availability, criterion_procedure_ref: item.procedure_ref,
    generic_method_ref: item.generic_method_ref, official_sources: item.official_sources,
    target_specific_evidence: item.required_evidence_types.map((type) => ({ ...structuredClone(original.target_specific_evidence[0]), type, observation: "Synthetic evidence for relation validation only" })) }));
  const ref = (artifact_id, requirement_id) => ({ artifact_id, requirement_id });
  const finding = { finding_id: "FIND-RELATION-ONE", basis: "verified_failure", requirement_ids: ids,
    observation_refs: screen.observations.map((item) => ref("ART-RELATION-SCREEN", item.requirement_id)),
    human_review_refs: ids.map((id) => ref("ART-RELATION-HUMAN", id)), priority: "P1", locations: ["Main informative image", "Image caption"],
    affected_users: ["Screen reader users"], issue: "Shared synthetic image barrier" };
  const payload = { findings: [finding, { ...structuredClone(finding), finding_id: "FIND-RELATION-TWO", requirement_ids: [ids[0]],
      human_review_refs: [ref("ART-RELATION-HUMAN", ids[0])], issue: "A distinct synthetic image barrier" }],
    items: [
      { remediation_id: "REM-RELAT001", finding_id: finding.finding_id, proposed_change: "One shared remedy for both criteria",
        verification: "Check both criteria on the corrected image", residual_limitation: "Synthetic fixture", owner: "C:\\Users\\PrivateFinding\\team.txt" },
      { remediation_id: "REM-RELAT002", finding_id: "FIND-RELATION-TWO", proposed_change: "A separate remedy for the distinct barrier",
        verification: "Check the second location", residual_limitation: "Synthetic fixture" }
    ] };
  for (const review of human.reviews) {
    delete review.finding;
    review.findings = payload.findings.filter((item) => item.requirement_ids.includes(review.requirement_id)).map((item) => ({
      id: item.finding_id, priority: item.priority, location: item.locations.join("\n"), affected_users: item.affected_users, observation: item.issue
    }));
  }
  author("declared-human-review", "ART-RELATION-HUMAN", human, ["ART-RELATION-QUEUE"]);
  const planFile = author("remediation-plan", "ART-RELATION-PLAN", payload, ["ART-RELATION-SCREEN", "ART-RELATION-HUMAN"], false);
  const candidate = read(planFile), badFile = path.join(artifacts, "invalid-relations.json");
  for (const [mutate, pattern] of [
    [(value) => { value.payload.findings[1].finding_id = finding.finding_id; }, /Duplicate finding/],
    [(value) => { value.payload.items[1].remediation_id = "REM-RELAT001"; }, /Duplicate remediation/],
    [(value) => { value.payload.findings.push({ ...structuredClone(value.payload.findings[0]), finding_id: "FIND-COPY" }); }, /Duplicate finding content/],
    [(value) => { value.payload.items.push({ ...value.payload.items[0], remediation_id: "REM-RELAT003" }); }, /Duplicate remediation content/],
    [(value) => { value.payload.items[0].finding_id = "FIND-MISSING"; }, /unknown finding|no remediation/],
    [(value) => { value.payload.findings[0].observation_refs[0].requirement_id = "SCREEN-MISSING"; }, /unknown observation_refs/],
    [(value) => { value.payload.findings[0].human_review_refs.pop(); }, /lacks matching/],
    [(value) => { value.payload.findings[0].requirement_ids.push("JIS-X-8341-3-2016-SC-1.1.1"); }, /lacks matching/],
    [(value) => { value.payload.findings[0].observation_refs[0].artifact_id = "ART-FOREIGN"; }, /same-run registered/]
    ,[(value) => { value.payload.findings[0].issue = "Unsigned replacement"; }, /preserve the human-declared/]
  ]) {
    const invalid = structuredClone(candidate); mutate(invalid); write(badFile, invalid);
    reject(cli(["artifact", "validate", "--run", runFile, "--artifact", badFile]), pattern);
  }
  add(planFile);
  const baseline = path.join(scenario, "baseline-assessment.json"), merged = path.join(scenario, "relations-assessment.json");
  pass(cli(["merge", "--run", runFile, "--assessment", baseline, ...registered.flatMap((file) => ["--artifact", file]), "--output", merged]));
  for (const mutate of [
    (value) => { value.assessment.findings[0].observation = "Unsigned replacement"; },
    (value) => { value.assessment.findings[1].requirement_ids.push(ids[1]); }
  ]) {
    const value = read(merged); mutate(value); const altered = path.join(scenario, "altered-assessment.json"); write(altered, value);
    reject(cli(["report", "--run", runFile, "--assessment", altered, "--output", path.join(scenario, "rejected-report.md")]), /finding|differs/i);
  }
  const result = read(merged);
  assert.equal(result.assessment.findings.length, 2);
  assert.deepEqual(result.assessment.findings[0].requirement_ids, ids);
  assert.equal(result.assessment.findings.filter((item) => item.requirement_ids.includes(ids[0])).length, 2);
  assert.equal(result.assessment.findings[0].remediation, payload.items[0].proposed_change);
  assert.equal(result.assessment.results.filter((row) => row.requirement_kind === "profile_requirement" && row.outcome === "fail").length, 3);
  const status = cli(["status", "--run", runFile, "--format", "json"]); pass(status);
  assert.equal(JSON.parse(status.stdout).finding_retest.findings.length, 2);
  assert.ok(JSON.parse(status.stdout).finding_retest.findings.every((item) => item.status === "not_recorded"));
  reject(cli(["status", "--run", runFile, "--retest-of", runFile]), /linked predecessor/);
  const relations = payload.findings.map(({ finding_id, requirement_ids }) => ({ finding_id, requirement_ids }));
  const retestReviews = ids.map((requirement_id, index) => ({ requirement_id, profile_outcome: index === 1 ? "fail" : "pass" }));
  const retest = findingRetestSummary(relations, retestReviews, { comparison: true });
  assert.deepEqual(retest.findings.map((item) => item.status), ["related_requirement_failed", "all_related_requirements_pass_declared"]);
  assert.equal(findingRetestSummary(relations, [], { comparison: true }).findings[0].status, "pending");
  for (const [locale, format, visibility] of [["ja", "markdown", "public"], ["en", "html", "internal"]]) {
    const output = path.join(scenario, "relations-" + locale + "." + (format === "html" ? "html" : "md"));
    pass(cli(["report", "--run", runFile, "--assessment", merged, "--format", format, "--locale", locale, "--visibility", visibility,
      ...(visibility === "public" ? ["--reviewer-disclosure", "redact", "--redaction-manifest", output + ".redaction.json"] : []), "--output", output]));
    const report = fs.readFileSync(output, "utf8");
    for (const phrase of [payload.items[0].proposed_change, "Synthetic relation rationale 0", "Synthetic relation rationale 1"]) assert.ok(report.includes(phrase), phrase);
    assert.match(report, /1\.1\.1/); assert.match(report, /1\.3\.1/);
    if (visibility === "public") {
      assert.doesNotMatch(report, /PrivateFinding|ART-RELATION|FIND-RELATION/);
      assert.match(report, /人手の不適合申告に基づく指摘数: 2/);
      assert.match(report, /不適合が申告された達成基準数: 3/);
    }
    else assert.match(report, /PrivateFinding/);
  }
});

const example = fileURLToPath(new URL("../examples/run-backed-web-audit/run.mjs", import.meta.url));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), "utf8");
function reject(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

test("author four standard candidates, edit, validate, register, merge and report without agents", (t) => {
  const help = cli(["artifact", "--help"]); pass(help);
  assert.match(help.stdout, /artifact init.*--payload/s);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-authoring-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Reuse the published synthetic fixture, including its saved E1 evidence.
  pass(spawnSync(process.execPath, [example, "--output", root], { encoding: "utf8", shell: false }));
  const scenario = path.join(root, "human-reviewed"), artifacts = path.join(scenario, "artifacts");
  let runFile = path.join(scenario, "audit-run.bound.json");
  const types = ["screening-observations", "human-review-queue", "declared-human-review", "remediation-plan"];
  for (const [index, type] of types.entries()) {
    const source = read(path.join(artifacts, `${type}.json`)), payloadFile = path.join(artifacts, `payload-${index}.json`);
    const payload = structuredClone(source.payload); delete payload.schema_version; write(payloadFile, payload);
    const output = path.join(artifacts, `authored-${index}.json`), before = fs.readFileSync(runFile);
    const args = ["artifact", "init", "--run", runFile, "--type", type, "--payload", payloadFile,
      "--artifact-id", source.artifact_id, ...source.inputs.flatMap((input) => ["--input", input.artifact_id]), "--output", output];
    pass(cli(args));
    const authored = read(output), run = read(runFile);
    assert.equal(authored.run_id, run.run_id);
    assert.equal(authored.schema_version, source.schema_version);
    assert.equal(authored.payload.schema_version, source.payload.schema_version);
    assert.equal(authored.producer.role_id, source.producer.role_id);
    assert.match(authored.producer.origin, /no agent dispatch/);
    assert.match(authored.created_at, /Z$/);
    for (const input of authored.inputs) assert.equal(input.sha256, run.artifacts.find((entry) => entry.artifact_id === input.artifact_id).sha256);
    assert.deepEqual(fs.readFileSync(runFile), before);
    pass(cli(["artifact", "validate", "--run", runFile, "--artifact", output]));
    if (index === 0) {
      authored.payload.observations[0].observation += " Edited synthetic observation; literal $(never-execute).";
      write(output, authored);
      reject(cli(args), /exist/i);
      const outside = path.join(root, "outside.json");
      reject(cli([...args.slice(0, -1), outside]), /private artifact root/);
      assert.equal(fs.existsSync(outside), false);
      const generated = path.join(artifacts, "generated-id.json"), autoArgs = [...args];
      autoArgs.splice(autoArgs.indexOf("--artifact-id"), 2); autoArgs[autoArgs.length - 1] = generated;
      pass(cli(autoArgs)); assert.match(read(generated).artifact_id, /^ART-[A-F0-9-]{36}$/);
      write(payloadFile, { ...payload, schema_version: null });
      const invalidOutput = path.join(artifacts, "invalid-version.json");
      reject(cli([...args.slice(0, -1), invalidOutput]), /schema_version/);
      assert.equal(fs.existsSync(invalidOutput), false);
      write(payloadFile, payload);
    }
    if (index === 1) {
      const invalid = path.join(artifacts, "invalid.json");
      for (const [mutate, pattern] of [
        [(value) => { value.run_id = "RUN-20260823T120000Z-OTHER001"; }, /another run/],
        [(value) => { value.inputs[0].run_id = "RUN-20260823T120000Z-OTHER001"; }, /same run/],
        [(value) => { value.inputs[0].sha256 = "0".repeat(64); }, /hash mismatch/],
        [(value) => { value.inputs[0].artifact_id = "ART-UNREGISTERED"; }, /not registered/]
      ]) {
        const value = structuredClone(authored); mutate(value); write(invalid, value);
        reject(cli(["artifact", "validate", "--run", runFile, "--artifact", invalid]), pattern);
      }
      const rejectedOutput = path.join(artifacts, "rejected.json");
      reject(cli([...args.slice(0, -2), "--input", "ART-UNREGISTERED", "--output", rejectedOutput]), /not registered/);
      assert.equal(fs.existsSync(rejectedOutput), false);
      const registeredFile = path.join(artifacts, run.artifacts[0].path), registeredBytes = fs.readFileSync(registeredFile);
      try {
        fs.appendFileSync(registeredFile, " ");
        reject(cli(["artifact", "validate", "--run", runFile, "--artifact", output]), /SHA-256|hash/i);
      } finally { fs.writeFileSync(registeredFile, registeredBytes); }
    }
    pass(cli(["artifact", "validate", "--run", runFile, "--artifact", output]));
    const next = path.join(scenario, `authored-run-${index}.json`);
    pass(cli(["register", "--run", runFile, "--artifact", output, "--output", next]));
    assert.deepEqual(fs.readFileSync(runFile), before);
    runFile = next;
  }
  const merged = path.join(scenario, "authored-assessment.json"), report = path.join(scenario, "authored-report.md");
  pass(cli(["merge", "--run", runFile, "--assessment", path.join(scenario, "baseline-assessment.json"),
    ...read(runFile).artifacts.flatMap((entry) => ["--artifact", path.join(artifacts, entry.path)]), "--output", merged]));
  pass(cli(["report", "--run", runFile, "--assessment", merged, "--output", report]));
  assert.ok(fs.statSync(report).size > 0);
  // Read a frozen singular plan without migrating or changing the current run.
  const historical = read(runFile), oldPlan = read(path.join(artifacts, "authored-3.json"));
  historical.schema_version = "12.0.0";
  const frozen = loadAuditResources().orchestrationRegistries.get("11.0.0");
  historical.resource_versions.orchestration_registry_version = "11.0.0";
  historical.resource_versions.orchestration_registry_sha256 = frozen.sha256;
  const oldHuman = read(path.join(artifacts, "authored-2.json")); oldHuman.payload.schema_version = "1.0.0";
  delete oldHuman.payload.reviewer_id; delete oldHuman.payload.reviewer_role;
  for (const review of oldHuman.payload.reviews) { delete review.review_id; delete review.supersedes_review_id; }
  const oldHumanFile = path.join(artifacts, "old-human.json"); write(oldHumanFile, oldHuman);
  const oldHumanHash = crypto.createHash("sha256").update(fs.readFileSync(oldHumanFile)).digest("hex");
  Object.assign(historical.artifacts.find((entry) => entry.artifact_id === oldHuman.artifact_id), { path: path.basename(oldHumanFile), sha256: oldHumanHash });
  oldPlan.inputs.find((input) => input.artifact_id === oldHuman.artifact_id).sha256 = oldHumanHash;
  oldPlan.payload.schema_version = "2.0.0";
  const oldPlanFile = path.join(artifacts, "old-singular-plan.json"); write(oldPlanFile, oldPlan);
  Object.assign(historical.artifacts.find((entry) => entry.artifact_id === oldPlan.artifact_id), {
    path: path.basename(oldPlanFile), sha256: crypto.createHash("sha256").update(fs.readFileSync(oldPlanFile)).digest("hex") });
  const oldRunFile = path.join(scenario, "old-run12.json"); write(oldRunFile, historical);
  const oldAssessment = read(merged), originalRecord = oldAssessment.assessment.human_review_records[0];
  assert.equal(originalRecord.attestation, null);
  originalRecord.context.origin.artifact_sha256 = oldHumanHash;
  const oldRecord = createHumanReviewRecord({ reviewerId: originalRecord.reviewer_id, review: oldHuman.payload, context: originalRecord.context });
  oldAssessment.assessment.human_review_records = [oldRecord];
  for (const row of oldAssessment.assessment.results) if (row.review_record_sha256 || row.review_resolution) {
    delete row.review_resolution; row.review_record_sha256 = reviewRecordSha256(oldRecord);
  }
  const oldAssessmentFile = path.join(scenario, "old-assessment.json"); write(oldAssessmentFile, oldAssessment);
  pass(cli(["report", "--run", oldRunFile, "--assessment", oldAssessmentFile, "--output", path.join(scenario, "old-run12-report.md")]));
});
