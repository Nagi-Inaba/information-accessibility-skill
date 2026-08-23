import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lookupRequirement as lookupCodexRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { lookupRequirement as lookupClaudeRequirement } from "../claude/skills/information-accessibility-practice/scripts/show-requirement.mjs";

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
  ["JIS-X-8341-3-2016-SC-2.1.1", "WCAG-2.2-SC-2.1.1"],
  ["JIS-X-8341-3-2016-SC-4.1.2", "WCAG-2.2-SC-4.1.2"]
];

test("equivalent JIS requirements reuse detailed WCAG procedures without losing JIS provenance", () => {
  for (const distribution of distributions) {
    const availableResults = equivalentRequirements.map(([jisRequirementId, wcagRequirementId]) => {
      const result = distribution.lookup("jp-public-web", jisRequirementId, distribution.skillRoot);

      assert.equal(result.profile.id, "jp-public-web", `${distribution.name}: selected profile must remain JIS`);
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

      return result;
    });

    assert.equal(availableResults.length, 4, `${distribution.name}: exactly four existing detailed procedures are reused`);
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

test("Codex and Claude expose the same JIS procedure bindings", () => {
  for (const [jisRequirementId] of equivalentRequirements) {
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
