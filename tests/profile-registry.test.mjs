import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skill = path.join(root, "codex", "skills", "information-accessibility-practice");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath).replace(/^\uFEFF/u, ""));
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(sourceEntry, destinationEntry);
    else fs.copyFileSync(sourceEntry, destinationEntry);
  }
}

const registry = readJson("codex/skills/information-accessibility-practice/references/standards-registry.json");
const catalog = readJson("codex/skills/information-accessibility-practice/references/criteria-catalog.json");
const assessmentSchema = readJson("codex/skills/information-accessibility-practice/references/assessment-record.schema.json");
const auditMethods = readJson("codex/skills/information-accessibility-practice/references/web-audit-methods.json");
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

test("active profiles fail closed when a required assessment field is missing", () => {
  const profileConfiguration = helper("profileConfiguration");
  for (const field of ["catalog_keys", "groups", "requires_web_interaction_evidence"]) {
    const invalidRegistry = structuredClone(registry);
    const profile = invalidRegistry.profiles.find((item) => item.id === "web-modern");
    delete profile.assessment_configuration[field];
    assert.throws(() => profileConfiguration(invalidRegistry, profile.id), new RegExp(field));
  }
});

test("malformed active assessment fields are rejected deterministically", () => {
  const profileConfiguration = helper("profileConfiguration");
  for (const [field, value] of [
    ["active", "true"],
    ["catalog_keys", "web_modern"],
    ["groups", {}],
    ["requires_web_interaction_evidence", "false"]
  ]) {
    const invalidRegistry = structuredClone(registry);
    const profile = invalidRegistry.profiles.find((item) => item.id === "web-modern");
    profile.assessment_configuration[field] = value;
    assert.throws(() => profileConfiguration(invalidRegistry, profile.id), new RegExp(field));
  }
});

test("an active non-Web profile may explicitly disable Web interaction evidence", () => {
  const profileConfiguration = helper("profileConfiguration");
  const recordsForProfile = helper("recordsForProfile");
  const reportGroups = helper("reportGroups");
  const futureRegistry = structuredClone(registry);
  const profile = futureRegistry.profiles.find((item) => item.id === "web-modern");
  profile.id = "future-document-profile";
  profile.assessment_configuration.requires_web_interaction_evidence = false;

  assert.equal(profileConfiguration(futureRegistry, profile.id).requires_web_interaction_evidence, false);
  assert.equal(recordsForProfile({ profile, catalog }).length, 55);
  assert.equal(reportGroups(profile).length, 1);
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

test("report groups reject duplicate IDs even when prefixes do not overlap", () => {
  const reportGroups = helper("reportGroups");
  const profile = structuredClone(registry.profiles.find((item) => item.id === "jp-public-web"));
  profile.assessment_configuration.groups[1].id = profile.assessment_configuration.groups[0].id;
  assert.throws(() => reportGroups(profile), /duplicate group id/i);
});

test("report groups reject unsafe property keys", () => {
  const reportGroups = helper("reportGroups");
  for (const unsafeId of ["__proto__", "constructor"]) {
    const profile = structuredClone(registry.profiles.find((item) => item.id === "web-modern"));
    profile.assessment_configuration.groups[0].id = unsafeId;
    assert.throws(() => reportGroups(profile), /group id/i);
  }
});

test("malicious group IDs cannot mutate Object.prototype during validation", () => {
  assert.equal(Object.hasOwn(Object.prototype, "not_tested"), false);
  const maliciousRegistry = structuredClone(registry);
  maliciousRegistry.profiles
    .find((item) => item.id === "web-modern")
    .assessment_configuration.groups[0].id = "__proto__";
  const record = generateAssessment("web-modern", {
    targetName: "Prototype safety target",
    targetVersion: "version-1",
    evaluator: "Reviewer",
    evaluatedAt: "2026-07-17"
  });

  let validation;
  let prototypeWasPolluted;
  try {
    validation = validateAssessment(record, maliciousRegistry, assessmentSchema, catalog, auditMethods);
    prototypeWasPolluted = Object.hasOwn(Object.prototype, "not_tested");
  } finally {
    delete Object.prototype.not_tested;
  }

  assert.equal(prototypeWasPolluted, false);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /group id/i.test(error)));
});

test("package verification rejects a registry that violates active profile requirements", async () => {
  const { verifyPackage } = await import(pathToFileURL(path.join(root, "scripts", "verify-package.mjs")));
  assert.equal(typeof verifyPackage, "function", "verify-package must export its package gate");

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-registry-package-"));
  try {
    for (const relativePath of [
      "shared",
      "codex/agents",
      "claude/agents",
      "codex/skills/information-accessibility-practice",
      "claude/skills/information-accessibility-practice"
    ]) {
      copyTree(path.join(root, relativePath), path.join(temporaryRoot, relativePath));
    }
    for (const platform of ["codex", "claude"]) {
      const registryPath = path.join(temporaryRoot, platform, "skills", "information-accessibility-practice", "references", "standards-registry.json");
      const invalidRegistry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      delete invalidRegistry.profiles.find((item) => item.id === "web-modern").assessment_configuration.requires_web_interaction_evidence;
      fs.writeFileSync(registryPath, `${JSON.stringify(invalidRegistry, null, 2)}\n`, "utf8");
    }

    const result = verifyPackage(temporaryRoot);
    assert.equal(result.status, "FAIL");
    assert.ok(result.errors.some((error) => error.includes("requires_web_interaction_evidence")));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
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
