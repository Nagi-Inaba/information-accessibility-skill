import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex", "skills", "information-accessibility-practice");
const references = path.join(skillRoot, "references");
const validatorUrl = pathToFileURL(path.join(skillRoot, "scripts", "lib", "json-schema.mjs"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

test("common Web catalog contains the eleven source-derived tool-independent patterns", async () => {
  const catalog = readJson(path.join(references, "common-web-failure-patterns.json"));
  const schema = readJson(path.join(references, "common-web-failure-patterns.schema.json"));
  const { validateJsonSchema } = await import(validatorUrl);
  assert.deepEqual(validateJsonSchema(catalog, schema), []);

  const expectedIds = [
    "SCREEN-WEB-ALT-MISSING",
    "SCREEN-WEB-ALT-REDUNDANT",
    "SCREEN-WEB-BYPASS-BLOCKS",
    "SCREEN-WEB-DUPLICATE-ID",
    "SCREEN-WEB-FORM-GROUP",
    "SCREEN-WEB-FORM-LABEL",
    "SCREEN-WEB-FRAGMENT-TARGET",
    "SCREEN-WEB-IFRAME-NAME",
    "SCREEN-WEB-PAGE-LANGUAGE",
    "SCREEN-WEB-TABLE-HEADERS",
    "SCREEN-WEB-TEXT-RESIZE"
  ];
  assert.equal(catalog.patterns.length, 11);
  assert.deepEqual(catalog.patterns.map((item) => item.id).sort(), expectedIds);
  assert.equal(new Set(catalog.patterns.map((item) => item.id)).size, 11);
  assert.equal(new Set(catalog.patterns.map((item) => item.faq_section)).size, 11);
  assert.ok(catalog.patterns.every((item) => item.mapping_status === "requires_human_verification"));
  assert.ok(catalog.patterns.every((item) => item.primary_sources.some((url) => /w3\.org/u.test(url))));
  assert.ok(catalog.patterns.every((item) => !Object.hasOwn(item, "tool_rule_id") && !Object.hasOwn(item, "adapter")));
  assert.match(catalog.patterns.find((item) => item.id === "SCREEN-WEB-TEXT-RESIZE").claim_boundary, /no automated signal is not a pass/i);
  assert.match(catalog.patterns.find((item) => item.id === "SCREEN-WEB-DUPLICATE-ID").claim_boundary, /not automatically a failure/i);
});

test("screening patterns retain the official FAQ source and attribution without research copies", () => {
  const catalog = readJson(path.join(references, "common-web-failure-patterns.json"));
  const manifest = readJson(path.join(references, "third-party-sources.json"));
  const source = manifest.sources.find((item) => item.id === "MIC-MICHECKER-FAQ");
  assert.ok(source);
  assert.equal(new URL(source.url).hostname, "www.soumu.go.jp");
  assert.match(source.version, /2024年4月版/u);
  assert.match(source.attribution, /総務省/u);
  assert.equal(source.terms_id, null);
  assert.equal(source.terms_status, "reference_only_terms_unreviewed");
  assert.ok(catalog.patterns.every((item) => item.primary_sources.includes(source.url)));
});
