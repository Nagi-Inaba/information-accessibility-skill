import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ignore = fs.readFileSync(".gitignore", "utf8");
const guide = fs.readFileSync("docs/artifact-storage.md", "utf8");

test("internal audit and example roots are ignored", () => {
  for (const entry of ["audit-runs/**/*", ".a11y-audit/", ".example-output/"]) {
    assert.match(ignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"));
  }
});

test("artifact storage guide separates internal evidence from explicit publication", () => {
  for (const term of [
    "one run directory per audit chain",
    "Do not overwrite immutable records",
    "Keep raw evidence inside the internal run tree",
    "Use explicit public export",
    "Preserve bindings",
    "Cleanup and retention",
    "git status --short"
  ]) assert.match(guide, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"));
  assert.match(guide, /\.a11y-audit\/\n  runs\/\n/u);
  assert.match(guide, /public candidate[\s\S]*explicit approval[\s\S]*published report/u);
});
