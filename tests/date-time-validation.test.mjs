import assert from "node:assert/strict";
import test from "node:test";
import { isValidCalendarDate, isValidRfc3339Instant } from "../codex/skills/information-accessibility-practice/scripts/lib/date-time.mjs";

test("calendar dates reject impossible days and accept leap days", () => {
  assert.equal(isValidCalendarDate("2026-02-30"), false);
  assert.equal(isValidCalendarDate("2026-99-99"), false);
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  assert.equal(isValidCalendarDate("2025-02-29"), false);
});

test("RFC 3339 instants reject impossible time fields and accept offsets", () => {
  assert.equal(isValidRfc3339Instant("2026-08-22T25:61:61Z"), false);
  assert.equal(isValidRfc3339Instant("2026-02-30T10:00:00Z"), false);
  assert.equal(isValidRfc3339Instant("2026-08-22T10:00:00+09:00"), true);
  assert.equal(isValidRfc3339Instant("2026-08-22 10:00:00Z"), false);
});
