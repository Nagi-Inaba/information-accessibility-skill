import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const text = fs.readFileSync("docs/architecture-and-glossary.md", "utf8");

test("architecture document explains the complete audit flow", () => {
  for (const term of [
    "information-accessibility-reviewer",
    "audit run + baseline assessment",
    "E0/E1 screening observations",
    "human review queue",
    "external human review",
    "remediation plan",
    "validation and public report"
  ]) assert.match(text, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("architecture document distinguishes usage paths, artifacts, evidence, and targets", () => {
  for (const heading of [
    "Three usage paths",
    "Components and responsibilities",
    "Artifact map",
    "Evidence levels",
    "Requirement terminology",
    "Information-use perspectives",
    "Target support matrix",
    "Public and internal boundaries"
  ]) assert.match(text, new RegExp(heading, "u"));
  assert.match(text, /Creating a baseline ledger is not the same as inspecting the target/u);
  assert.match(text, /AIや自動検査[^\n]*外部人手レビュー/u);
});
