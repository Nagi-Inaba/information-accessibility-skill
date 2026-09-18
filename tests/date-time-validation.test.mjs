import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { compareInstants, isCalendarDate, isRfc3339DateTime } from "../codex/skills/information-accessibility-practice/scripts/lib/date-time.mjs";
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
  assert.equal(isCalendarDate("1900-02-29"), false);
  assert.equal(isCalendarDate("2000-02-29"), true);
  assert.equal(isCalendarDate("0099-01-01"), true);
  assert.equal(isCalendarDate("0000-02-29"), true);
});

test("RFC 3339 validation rejects impossible instants and accepts offsets", () => {
  assert.equal(isRfc3339DateTime("2026-02-30T12:00:00Z"), false);
  assert.equal(isRfc3339DateTime("2026-02-28T25:61:61Z"), false);
  assert.equal(isRfc3339DateTime("2026-02-28T12:00:00+09:00"), true);
  for (const value of ["2026-02-28T12:00:00+24:00", "2026-02-28T12:00:00+09:60", "2026-02-28T12:00:60Z", "2026-02-28T12:00:00"]) {
    assert.equal(isRfc3339DateTime(value), false, value);
  }
  assert.equal(isRfc3339DateTime("2026-02-28t12:00:00z"), true);
});

test("instant ordering preserves offsets, date boundaries, DST folds and fractional precision", () => {
  for (const [left, right, expected] of [
    ["2026-07-17T21:00:01+09:00", "2026-07-17T12:00:01Z", 0],
    ["2026-01-01T00:30:00+09:00", "2025-12-31T16:00:00Z", -1],
    ["2026-03-08T01:59:59-05:00", "2026-03-08T03:00:00-04:00", -1],
    ["2026-11-01T01:50:00-04:00", "2026-11-01T01:10:00-05:00", -1],
    ["2026-07-17T12:00:01.000000001Z", "2026-07-17T12:00:01Z", 1],
    ["2026-07-17T12:00:01.1Z", "2026-07-17T21:00:01.1000+09:00", 0]
  ]) assert.equal(compareInstants(left, right), expected, left);
  assert.ok(Number.isNaN(compareInstants("2026-02-30T00:00:00Z", "2026-03-01T00:00:00Z")));
});

test("all current timestamp contracts accept offsets and reject impossible dates", () => {
  const contracts = [
    read("audit-run.schema.json").$defs.timestamp,
    read("audit-artifact-envelope.schema.json").$defs.timestamp,
    read("screening-observations.schema.json").properties.observations.items.properties.captured_at,
    read("declared-human-review.schema.json").$defs.evidence.properties.captured_at,
    read("fix-authorization.schema.json").$defs.timestamp,
    read("change-record.schema.json").$defs.timestamp,
    schema.properties.assessment.properties.results.items.properties.evidence.items.properties.captured_at
  ];
  for (const contract of contracts) {
    const validErrors = [];
    validateJsonSchema("2024-02-29T09:00:00.001+09:00", contract, "$", validErrors);
    assert.deepEqual(validErrors, []);
    for (const value of ["2026-02-30T12:00:00Z", "2026-13-40T25:61:61Z"]) {
      const errors = [];
      validateJsonSchema(value, contract, "$", errors);
      assert.ok(errors.some((error) => error.includes("2026-09-18T09:00:00+09:00")));
    }
  }
});

test("frozen UTC schema patterns also reject impossible calendar dates without accepting offsets", () => {
  const contract = read("audit-run-6.0.0.schema.json").$defs.timestamp;
  for (const [value, valid] of [["2024-02-29T00:00:00Z", true], ["2026-02-30T00:00:00Z", false], ["2024-02-29T09:00:00+09:00", false]]) {
    const errors = [];
    validateJsonSchema(value, contract, "$", errors);
    assert.equal(errors.length === 0, valid, value);
  }
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
