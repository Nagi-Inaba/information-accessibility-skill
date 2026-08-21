import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { isCalendarDate, isRfc3339DateTime } from "../codex/skills/information-accessibility-practice/scripts/lib/date-time.mjs";
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const refs = path.join(root, "codex/skills/information-accessibility-practice/references");
const read = (name) => JSON.parse(fs.readFileSync(path.join(refs, name), "utf8"));
const registry = read("standards-registry.json");
const schema = read("assessment-record.schema.json");
const catalog = read("criteria-catalog.json");
const methods = read("web-audit-methods.json");

test("calendar dates reject impossible days and accept leap days", () => {
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-99-99"), false);
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2025-02-29"), false);
});

test("RFC 3339 validation rejects impossible instants and accepts offsets", () => {
  assert.equal(isRfc3339DateTime("2026-02-30T12:00:00Z"), false);
  assert.equal(isRfc3339DateTime("2026-02-28T25:61:61Z"), false);
  assert.equal(isRfc3339DateTime("2026-02-28T12:00:00+09:00"), true);
});

test("JSON Schema date formats are assertions", () => {
  const dateErrors = [];
  validateJsonSchema("2026-02-30", { type: "string", format: "date" }, "$", dateErrors);
  assert.ok(dateErrors.some((error) => error.includes("real calendar date")));
  const instantErrors = [];
  validateJsonSchema("2026-01-01T25:00:00Z", { type: "string", format: "date-time" }, "$", instantErrors);
  assert.ok(instantErrors.some((error) => error.includes("RFC 3339")));
});

test("assessment validation rejects impossible review dates", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Example",
    targetVersion: "v1",
    targetRefs: ["https://example.invalid/"],
    evaluator: "Reviewer",
    evaluatedAt: "2026-02-30"
  });
  const result = validateAssessment(record, registry, schema, catalog, methods);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("evaluated_at must be a real calendar date")));
});
