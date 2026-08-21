import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";

const codexProvenance = JSON.parse(fs.readFileSync("codex/skills/information-accessibility-practice/references/source-provenance.json", "utf8"));
const claudeProvenance = JSON.parse(fs.readFileSync("claude/skills/information-accessibility-practice/references/source-provenance.json", "utf8"));
const schema = JSON.parse(fs.readFileSync("codex/skills/information-accessibility-practice/references/source-provenance.schema.json", "utf8"));
const notices = fs.readFileSync("THIRD_PARTY_NOTICES.md", "utf8");

test("source provenance is schema-valid and mirrored", () => {
  const errors = [];
  validateJsonSchema(codexProvenance, schema, "$", errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(claudeProvenance, codexProvenance);
  assert.equal(
    fs.readFileSync("codex/skills/information-accessibility-practice/references/source-provenance.schema.json", "utf8"),
    fs.readFileSync("claude/skills/information-accessibility-practice/references/source-provenance.schema.json", "utf8")
  );
});

test("every third-party source records imported fields, attribution, and review status", () => {
  assert.ok(codexProvenance.sources.length >= 5);
  const ids = new Set();
  for (const source of codexProvenance.sources) {
    assert.equal(ids.has(source.id), false, source.id);
    ids.add(source.id);
    assert.ok(source.source_urls.every((url) => url.startsWith("https://")), source.id);
    assert.ok(source.imported_fields.length > 0, source.id);
    assert.ok(source.attribution.length > 0, source.id);
    assert.ok(source.terms_summary.length > 0, source.id);
  }
  assert.equal(codexProvenance.sources.find((source) => source.id === "waic-jis-guidance").review_status, "needs_source_specific_review");
  assert.equal(codexProvenance.sources.find((source) => source.id === "jis-x-8341-3-standard").modification_status, "source_not_redistributed");
});

test("third-party notice separates MIT code from source-specific terms", () => {
  for (const term of [
    "does **not** relicense third-party standards",
    "W3C Document License",
    "WAIC translated-document license",
    "Public Data License 1.0",
    "does not redistribute the official JIS",
    "Downstream redistribution checklist"
  ]) assert.match(notices, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"));
  assert.match(notices, /not legal advice/iu);
  assert.match(notices, /avoid implying endorsement, certification, or official status/iu);
});
