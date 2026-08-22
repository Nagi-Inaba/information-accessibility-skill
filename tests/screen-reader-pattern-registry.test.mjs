import assert from "node:assert/strict";
import test from "node:test";
import { discoverScreenReaderPatterns, selectScreenReaderPatterns, validateScreenReaderPatterns } from "../codex/skills/information-accessibility-practice/scripts/lib/screen-reader-pattern-registry.mjs";

const registry = {
  patterns: [
    { id: "tabs", title: "Tabs", category: "composite", checks: [{ id: "tab-state" }], source_urls: ["https://www.w3.org/WAI/ARIA/apg/patterns/tabs/"] },
    { id: "combobox", title: "Combobox", category: "composite", checks: [{ id: "combo-name" }], source_urls: ["https://www.w3.org/WAI/ARIA/apg/patterns/combobox/"] },
    { id: "live-region", title: "Live region", category: "notification", checks: [{ id: "live-change" }], source_urls: ["https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/"] }
  ]
};

test("patterns are discovered from data rather than a hard-coded id list", () => {
  const discovered = discoverScreenReaderPatterns(registry);
  assert.deepEqual(discovered.ids, ["tabs", "combobox", "live-region"]);
  assert.deepEqual(discovered.categories, ["composite", "notification"]);
  assert.equal(discovered.sources.length, 3);
});

test("selectors support all, one id, and a category", () => {
  assert.equal(selectScreenReaderPatterns(registry, "all").length, 3);
  assert.deepEqual(selectScreenReaderPatterns(registry, "tabs").map((item) => item.id), ["tabs"]);
  assert.deepEqual(selectScreenReaderPatterns(registry, "category:composite").map((item) => item.id), ["tabs", "combobox"]);
  assert.throws(() => selectScreenReaderPatterns(registry, "dialog"), /Unknown screen-reader pattern/u);
});

test("duplicate ids and incomplete patterns fail closed", () => {
  const errors = validateScreenReaderPatterns({ patterns: [registry.patterns[0], registry.patterns[0]] });
  assert.ok(errors.some((error) => error.includes("unique")));
  assert.ok(validateScreenReaderPatterns({ patterns: [{ id: "x" }] }).length > 0);
});
