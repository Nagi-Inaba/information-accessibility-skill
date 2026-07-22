import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex", "skills", "information-accessibility-practice");
const references = path.join(skillRoot, "references");
const sourceRoot = path.join(root, "docs", "sources", "michecker");
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

test("the official FAQ source pack preserves the original PDF and readable extraction", () => {
  const record = readJson(path.join(sourceRoot, "source-record.json"));
  const pdf = path.join(root, ...record.local_pdf.split("/"));
  const extracted = path.join(root, ...record.local_extracted_text.split("/"));
  const bytes = fs.readFileSync(pdf);
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(bytes.length, record.pdf_bytes);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), record.pdf_sha256);
  assert.equal(record.pdf_pages, 17);
  const text = fs.readFileSync(extracted, "utf8");
  assert.match(text, /2024年4月版/u);
  assert.match(text, /## Page 17/u);
  assert.ok(text.length > 10000);
});
