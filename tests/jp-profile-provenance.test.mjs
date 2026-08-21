import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const registry = JSON.parse(fs.readFileSync("codex/skills/information-accessibility-practice/references/standards-registry.json", "utf8"));
const guide = fs.readFileSync("docs/jp-public-web-profile-provenance.md", "utf8");

test("Japanese composite profile identifies its organization-specific extension", () => {
  const profile = registry.profiles.find((item) => item.id === "jp-public-web");
  assert.ok(profile);
  assert.equal(profile.requirement_ids.length, 56);
  assert.match(profile.display_name, /Digital Agency/u);
  assert.match(profile.target_scope, /www\.digital\.go\.jp/u);
  assert.match(profile.target_scope, /not a universal Japanese public-Web requirement/iu);
  const groups = profile.assessment_configuration.groups;
  assert.deepEqual(groups.map((group) => group.id), ["jis_x_8341_3_2016", "jp_wcag_2_2_additional"]);
  assert.match(groups[1].label, /Digital Agency/u);
  const extension = profile.standards.find((standard) => standard.id === "WCAG-2.2-ADDITIONAL-A-AA-18");
  assert.match(extension.normative_status, /Organization-specific policy target/iu);
  assert.match(extension.normative_status, /not.*universal/iu);
});

test("provenance guide separates JIS, WCAG, and organizational selection", () => {
  for (const term of [
    "JIS X 8341-3:2016 A/AA",
    "Japan Digital Agency WCAG 2.2 extension",
    "organization-specific target set",
    "must not be described as a legal requirement",
    "reported separately",
    "profile-composition model"
  ]) assert.match(guide, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"));
  assert.match(guide, /www\.digital\.go\.jp/u);
  assert.doesNotMatch(guide, /Japanese public-Web profile requires 56 criteria/u);
});
