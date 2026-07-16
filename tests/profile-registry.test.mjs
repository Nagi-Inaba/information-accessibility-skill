import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skill = path.join(root, "codex", "skills", "information-accessibility-practice");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath).replace(/^\uFEFF/u, ""));
}

const registry = readJson("codex/skills/information-accessibility-practice/references/standards-registry.json");
const catalog = readJson("codex/skills/information-accessibility-practice/references/criteria-catalog.json");
const helperPath = path.join(skill, "scripts", "lib", "profile-registry.mjs");
let helperModule;
let helperLoadError;
try {
  helperModule = await import(pathToFileURL(helperPath));
} catch (error) {
  helperLoadError = error;
  helperModule = {};
}

function helper(name) {
  assert.equal(helperLoadError, undefined, `profile registry helper must load: ${helperLoadError?.message}`);
  assert.equal(typeof helperModule[name], "function", `${name} must be exported`);
  return helperModule[name];
}

test("active profiles declare their catalog and report configuration", () => {
  for (const id of ["web-modern", "jp-public-web"]) {
    const profile = registry.profiles.find((item) => item.id === id);
    assert.equal(profile.assessment_configuration.active, true);
    assert.equal(profile.assessment_configuration.requires_web_interaction_evidence, true);
    assert.ok(profile.assessment_configuration.catalog_keys.length > 0);
    assert.ok(profile.assessment_configuration.groups.length > 0);
  }
});

test("profiles without generated catalogs are explicitly inactive", () => {
  for (const id of ["participation-practice", "authoring-agent"]) {
    const profile = registry.profiles.find((item) => item.id === id);
    assert.deepEqual(profile.assessment_configuration, { active: false });
  }
});

test("generation and reporting do not branch on active profile IDs", () => {
  for (const file of ["generate-assessment.mjs", "validate-assessment.mjs", "render-audit-report.mjs"]) {
    const source = read(`codex/skills/information-accessibility-practice/scripts/${file}`);
    assert.doesNotMatch(source, /profileId === "web-modern"|profileId === "jp-public-web"|profile\.id === "jp-public-web"/);
  }
});

test("Web interaction evidence is controlled separately from catalog activation", () => {
  const source = read("codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs");
  assert.match(source, /requiresWebInteractionEvidence = configuration\?\.requires_web_interaction_evidence === true/);
  assert.doesNotMatch(source, /requiresWebInteractionEvidence = configuration\?\.active === true/);
});

test("profile configuration is read from the registry profile", () => {
  const profileConfiguration = helper("profileConfiguration");
  const expected = registry.profiles.find((item) => item.id === "web-modern").assessment_configuration;
  assert.deepEqual(profileConfiguration(registry, "web-modern"), expected);
  assert.throws(() => profileConfiguration(registry, "missing-profile"), /Unknown profile/);
});

test("profile records concatenate configured catalogs in order and reject missing keys", () => {
  const recordsForProfile = helper("recordsForProfile");
  const profile = registry.profiles.find((item) => item.id === "jp-public-web");
  const records = recordsForProfile({ profile, catalog });
  assert.equal(records.length, 56);
  assert.deepEqual(
    records.map((item) => item.id),
    [...catalog.catalogs.jis_x_8341_3_2016, ...catalog.catalogs.jp_wcag_2_2_additional].map((item) => item.id)
  );
  assert.throws(
    () => recordsForProfile({
      profile: {
        ...profile,
        assessment_configuration: { ...profile.assessment_configuration, catalog_keys: ["missing_catalog"] }
      },
      catalog
    }),
    /missing_catalog/
  );
});

test("each registered requirement resolves to exactly one report group", () => {
  const groupForRequirement = helper("groupForRequirement");
  const profile = registry.profiles.find((item) => item.id === "jp-public-web");
  assert.equal(groupForRequirement(profile, "JIS-X-8341-3-2016-SC-4.1.1"), "jis_x_8341_3_2016");
  assert.equal(groupForRequirement(profile, "WCAG-2.2-ADDITIONAL-SC-4.1.3"), "jp_wcag_2_2_additional");

  const ungrouped = {
    ...profile,
    requirement_ids: ["UNMATCHED-1"]
  };
  assert.throws(() => groupForRequirement(ungrouped, "UNMATCHED-1"), /exactly one/);

  const overlapping = {
    ...profile,
    requirement_ids: ["DUPLICATE-1"],
    assessment_configuration: {
      ...profile.assessment_configuration,
      groups: [
        { id: "one", label: "One", requirement_id_prefixes: ["DUPLICATE-"] },
        { id: "two", label: "Two", requirement_id_prefixes: ["DUPLICATE-"] }
      ]
    }
  };
  assert.throws(() => groupForRequirement(overlapping, "DUPLICATE-1"), /exactly one/);
});

test("report groups preserve registry order and labels", () => {
  const reportGroups = helper("reportGroups");
  const profile = registry.profiles.find((item) => item.id === "jp-public-web");
  assert.deepEqual(reportGroups(profile), profile.assessment_configuration.groups);
});

test("registry schema requires catalogs and groups for active configurations", () => {
  const schemaPath = path.join(skill, "references", "standards-registry.schema.json");
  assert.equal(fs.existsSync(schemaPath), true, "standards-registry.schema.json must exist");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const configuration = schema.$defs.assessment_configuration;
  assert.ok(configuration.required.includes("active"));
  const activeRule = configuration.allOf.find((rule) => rule.if?.properties?.active?.const === true);
  assert.ok(activeRule, "active configuration must have a conditional schema rule");
  assert.ok(activeRule.then.required.includes("catalog_keys"));
  assert.ok(activeRule.then.required.includes("groups"));
  assert.ok(activeRule.then.required.includes("requires_web_interaction_evidence"));
});
