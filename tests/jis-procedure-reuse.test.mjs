import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lookupRequirement as lookupCodexRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { lookupRequirement as lookupClaudeRequirement } from "../claude/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { validateReviewBindings } from "../codex/skills/information-accessibility-practice/scripts/lib/assessment-provenance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributions = [
  {
    name: "Codex",
    lookup: lookupCodexRequirement,
    skillRoot: path.join(root, "codex/skills/information-accessibility-practice")
  },
  {
    name: "Claude",
    lookup: lookupClaudeRequirement,
    skillRoot: path.join(root, "claude/skills/information-accessibility-practice")
  }
];

const equivalentRequirements = [
  ["JIS-X-8341-3-2016-SC-1.1.1", "WCAG-2.2-SC-1.1.1"],
  ["JIS-X-8341-3-2016-SC-1.3.1", "WCAG-2.2-SC-1.3.1"],
  ["JIS-X-8341-3-2016-SC-1.3.2", "WCAG-2.2-SC-1.3.2"],
  ["JIS-X-8341-3-2016-SC-1.3.3", "WCAG-2.2-SC-1.3.3"],
  ["JIS-X-8341-3-2016-SC-1.4.1", "WCAG-2.2-SC-1.4.1"],
  ["JIS-X-8341-3-2016-SC-1.4.3", "WCAG-2.2-SC-1.4.3"],
  ["JIS-X-8341-3-2016-SC-1.4.4", "WCAG-2.2-SC-1.4.4"],
  ["JIS-X-8341-3-2016-SC-2.1.1", "WCAG-2.2-SC-2.1.1"],
  ["JIS-X-8341-3-2016-SC-2.1.2", "WCAG-2.2-SC-2.1.2"],
  ["JIS-X-8341-3-2016-SC-2.2.1", "WCAG-2.2-SC-2.2.1"],
  ["JIS-X-8341-3-2016-SC-2.4.1", "WCAG-2.2-SC-2.4.1"],
  ["JIS-X-8341-3-2016-SC-2.4.2", "WCAG-2.2-SC-2.4.2"],
  ["JIS-X-8341-3-2016-SC-2.4.3", "WCAG-2.2-SC-2.4.3"],
  ["JIS-X-8341-3-2016-SC-2.4.4", "WCAG-2.2-SC-2.4.4"],
  ["JIS-X-8341-3-2016-SC-2.4.5", "WCAG-2.2-SC-2.4.5"],
  ["JIS-X-8341-3-2016-SC-2.4.6", "WCAG-2.2-SC-2.4.6"],
  ["JIS-X-8341-3-2016-SC-2.4.7", "WCAG-2.2-SC-2.4.7"],
  ["JIS-X-8341-3-2016-SC-3.1.1", "WCAG-2.2-SC-3.1.1"],
  ["JIS-X-8341-3-2016-SC-3.1.2", "WCAG-2.2-SC-3.1.2"],
  ["JIS-X-8341-3-2016-SC-3.2.1", "WCAG-2.2-SC-3.2.1"],
  ["JIS-X-8341-3-2016-SC-3.2.2", "WCAG-2.2-SC-3.2.2"],
  ["JIS-X-8341-3-2016-SC-3.2.3", "WCAG-2.2-SC-3.2.3"],
  ["JIS-X-8341-3-2016-SC-3.2.4", "WCAG-2.2-SC-3.2.4"],
  ["JIS-X-8341-3-2016-SC-3.3.1", "WCAG-2.2-SC-3.3.1"],
  ["JIS-X-8341-3-2016-SC-3.3.2", "WCAG-2.2-SC-3.3.2"],
  ["JIS-X-8341-3-2016-SC-3.3.3", "WCAG-2.2-SC-3.3.3"],
  ["JIS-X-8341-3-2016-SC-3.3.4", "WCAG-2.2-SC-3.3.4"],
  ["JIS-X-8341-3-2016-SC-4.1.2", "WCAG-2.2-SC-4.1.2"]
];

const additionalRequirements = [
  ["WCAG-2.2-ADDITIONAL-SC-1.3.4", "WCAG-2.2-SC-1.3.4"],
  ["WCAG-2.2-ADDITIONAL-SC-1.3.5", "WCAG-2.2-SC-1.3.5"],
  ["WCAG-2.2-ADDITIONAL-SC-1.4.10", "WCAG-2.2-SC-1.4.10"],
  ["WCAG-2.2-ADDITIONAL-SC-1.4.11", "WCAG-2.2-SC-1.4.11"],
  ["WCAG-2.2-ADDITIONAL-SC-1.4.12", "WCAG-2.2-SC-1.4.12"],
  ["WCAG-2.2-ADDITIONAL-SC-1.4.13", "WCAG-2.2-SC-1.4.13"],
  ["WCAG-2.2-ADDITIONAL-SC-2.1.4", "WCAG-2.2-SC-2.1.4"],
  ["WCAG-2.2-ADDITIONAL-SC-2.4.11", "WCAG-2.2-SC-2.4.11"],
  ["WCAG-2.2-ADDITIONAL-SC-2.5.1", "WCAG-2.2-SC-2.5.1"],
  ["WCAG-2.2-ADDITIONAL-SC-2.5.2", "WCAG-2.2-SC-2.5.2"],
  ["WCAG-2.2-ADDITIONAL-SC-2.5.3", "WCAG-2.2-SC-2.5.3"],
  ["WCAG-2.2-ADDITIONAL-SC-2.5.4", "WCAG-2.2-SC-2.5.4"],
  ["WCAG-2.2-ADDITIONAL-SC-2.5.7", "WCAG-2.2-SC-2.5.7"],
  ["WCAG-2.2-ADDITIONAL-SC-2.5.8", "WCAG-2.2-SC-2.5.8"],
  ["WCAG-2.2-ADDITIONAL-SC-3.2.6", "WCAG-2.2-SC-3.2.6"],
  ["WCAG-2.2-ADDITIONAL-SC-3.3.7", "WCAG-2.2-SC-3.3.7"],
  ["WCAG-2.2-ADDITIONAL-SC-3.3.8", "WCAG-2.2-SC-3.3.8"],
  ["WCAG-2.2-ADDITIONAL-SC-4.1.3", "WCAG-2.2-SC-4.1.3"]
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

test("equivalent JIS requirements reuse detailed WCAG procedures without losing JIS provenance", () => {
  for (const distribution of distributions) {
    const registry = readJson(path.join(distribution.skillRoot, "references/standards-registry.json"));
    const jisProfile = registry.profiles.find((profile) => profile.id === "jp-public-web");
    assert.ok(jisProfile, `${distribution.name}: jp-public-web profile must exist`);

    for (const [jisRequirementId, wcagRequirementId] of equivalentRequirements) {
      const result = distribution.lookup("jp-public-web", jisRequirementId, distribution.skillRoot);

      assert.equal(result.profile.id, "jp-public-web", `${distribution.name}: selected profile must remain JIS`);
      assert.equal(
        result.profile.claim_ceiling,
        jisProfile.claim_rules.claim_ceiling,
        `${distribution.name}: selected JIS claim boundary must remain unchanged`
      );
      assert.equal(result.criterion.id, jisRequirementId, `${distribution.name}: selected criterion must remain the JIS record`);
      assert.equal(result.criterion_procedure_status, "available", `${distribution.name}: ${jisRequirementId}`);
      assert.equal(result.procedure_binding.procedure_availability, "available", `${distribution.name}: ${jisRequirementId}`);
      assert.equal(result.criterion_procedure.requirement_id, wcagRequirementId, `${distribution.name}: ${jisRequirementId}`);
      assert.ok(
        result.procedure_binding.official_sources.includes(result.criterion.checklist_source_url),
        `${distribution.name}: ${jisRequirementId} must retain its JIS checklist source`
      );
      assert.ok(
        result.procedure_binding.official_sources.some((source) => source.startsWith("https://waic.jp/")),
        `${distribution.name}: ${jisRequirementId} must retain a WAIC source`
      );
    }
  }
});

test("the public-web profile exposes exactly the mapped JIS and additional procedures", () => {
  const expectedRequirementIds = [...equivalentRequirements, ...additionalRequirements]
    .map(([jisRequirementId]) => jisRequirementId)
    .sort();

  for (const distribution of distributions) {
    const registry = readJson(path.join(distribution.skillRoot, "references/standards-registry.json"));
    const jisProfile = registry.profiles.find((profile) => profile.id === "jp-public-web");
    assert.ok(jisProfile, `${distribution.name}: jp-public-web profile must exist`);

    const availableRequirementIds = jisProfile.requirement_ids
      .map((requirementId) => distribution.lookup("jp-public-web", requirementId, distribution.skillRoot))
      .filter((result) => result.criterion_procedure_status === "available")
      .map((result) => result.criterion.id)
      .sort();

    assert.deepEqual(availableRequirementIds, expectedRequirementIds, distribution.name);
  }
});

test("additional WCAG requirements reuse the same procedure in both distributions", () => {
  for (const distribution of distributions) {
    for (const [additionalId, wcagId] of additionalRequirements) {
      const result = distribution.lookup("jp-public-web", additionalId, distribution.skillRoot);
      assert.equal(result.criterion.id, additionalId);
      assert.equal(result.criterion_procedure_status, "available");
      assert.equal(result.criterion_procedure.requirement_id, wcagId);
      assert.ok(result.procedure_binding.official_sources.includes(result.criterion.official_method_sources[0]));
      assert.ok(result.procedure_binding.official_sources.includes(result.criterion_procedure.primary_sources[0]));
    }
  }
});

test("standalone review validation accepts mapped JIS and additional bindings", () => {
  const references = path.join(root, "codex/skills/information-accessibility-practice/references");
  const catalog = readJson(path.join(references, "criteria-catalog.json"));
  const methods = readJson(path.join(references, "web-audit-methods.json"));
  const procedures = readJson(path.join(references, "criterion-procedures.json"));
  const profileRows = [...catalog.catalogs.jis_x_8341_3_2016, ...catalog.catalogs.jp_wcag_2_2_additional];
  for (const id of ["JIS-X-8341-3-2016-SC-1.4.3", "WCAG-2.2-ADDITIONAL-SC-3.3.7"]) {
    const binding = lookupCodexRequirement("jp-public-web", id).procedure_binding;
    const review = { requirement_id: id, procedure_availability: binding.procedure_availability,
      criterion_procedure_ref: binding.procedure_ref, generic_method_ref: binding.generic_method_ref,
      official_sources: binding.official_sources,
      target_specific_evidence: binding.required_evidence_types.map((type) => ({ type })),
      profile_outcome: "pass" };
    const record = { schema_version: "2.0.0", assessment: { human_review_records: [{ review: { reviews: [review] } }] } };
    assert.deepEqual(validateReviewBindings(record, profileRows, methods, procedures), [], id);
    review.criterion_procedure_ref = null;
    assert.match(validateReviewBindings(record, profileRows, methods, procedures).join(" "), /must use registered criterion procedure/u);
  }
});

test("JIS-specific SC 4.1.1 does not inherit an unrelated WCAG procedure", () => {
  for (const distribution of distributions) {
    const result = distribution.lookup(
      "jp-public-web",
      "JIS-X-8341-3-2016-SC-4.1.1",
      distribution.skillRoot
    );

    assert.equal(result.profile.id, "jp-public-web", distribution.name);
    assert.equal(result.criterion.id, "JIS-X-8341-3-2016-SC-4.1.1", distribution.name);
    assert.equal(result.criterion_procedure_status, "not_available", distribution.name);
    assert.equal(result.procedure_binding.procedure_availability, "unavailable", distribution.name);
    assert.equal("criterion_procedure" in result, false, distribution.name);
  }
});

test("Codex and Claude expose the same public-web procedure bindings", () => {
  for (const [jisRequirementId] of [...equivalentRequirements, ...additionalRequirements]) {
    const codexResult = lookupCodexRequirement(
      "jp-public-web",
      jisRequirementId,
      path.join(root, "codex/skills/information-accessibility-practice")
    );
    const claudeResult = lookupClaudeRequirement(
      "jp-public-web",
      jisRequirementId,
      path.join(root, "claude/skills/information-accessibility-practice")
    );

    assert.deepEqual(claudeResult, codexResult, jisRequirementId);
  }
});
