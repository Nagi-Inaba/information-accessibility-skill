import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCatalogFromSources } from "../scripts/build-criteria-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "tests", "fixtures", "catalog");
const fetchGuard = "--import=data:text/javascript,globalThis.fetch%3Dasync()%3D%3E%7Bthrow%20new%20Error(%22Network%20access%20attempted%20during%20catalog%20maintenance%20test%22)%7D";

function runNode(script, args, options = {}) {
  const nodeOptions = [process.env.NODE_OPTIONS, fetchGuard].filter(Boolean).join(" ");
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: "utf8",
    ...options,
    env: { ...process.env, NODE_OPTIONS: nodeOptions, ...options.env }
  });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function sampleCatalog() {
  return buildCatalogFromSources({
    wcagHtml: fs.readFileSync(path.join(fixtureRoot, "wcag-sample.html"), "utf8"),
    jisHtml: fs.readFileSync(path.join(fixtureRoot, "jis-sample.html"), "utf8"),
    japanHtml: fs.readFileSync(path.join(fixtureRoot, "japan-profile-sample.html"), "utf8"),
    verifiedAt: "2026-07-16",
    registry: readJson("codex/skills/information-accessibility-practice/references/standards-registry.json")
  });
}

test("catalog check is offline and validates the stored mirrors", () => {
  const result = runNode("scripts/build-criteria-catalog.mjs", ["--check"], {
    env: { ...process.env, A11Y_TEST_FAIL_ON_FETCH: "1" }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).counts, { wcag: 55, jis: 38, japan_additional: 18 });
});

test("live refresh requires an output and refuses overwrite", () => {
  const missing = runNode("scripts/build-criteria-catalog.mjs", ["--refresh", "--verified-at", "2026-07-16"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--output is required with --refresh/);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-catalog-refresh-"));
  const output = path.join(temporaryRoot, "candidate.json");
  fs.writeFileSync(output, "existing\n", "utf8");
  try {
    const existing = runNode("scripts/build-criteria-catalog.mjs", [
      "--refresh", "--verified-at", "2026-07-16", "--output", output
    ]);
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /Refusing to overwrite existing output/);
    assert.equal(fs.readFileSync(output, "utf8"), "existing\n");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("catalog parsing is independent from network acquisition", () => {
  const catalog = sampleCatalog();
  assert.equal(catalog.verified_at, "2026-07-16");
  assert.deepEqual(Object.values(catalog.catalogs).map((records) => records.length), [55, 38, 18]);
  assert.deepEqual(Object.keys(catalog.catalogs.web_modern[0]), [
    "id", "success_criterion", "title_en", "level", "introduced_in", "normative_url",
    "understanding_url", "evidence_hints", "method_key", "official_method_sources",
    "applicability_instruction", "expectation_instruction", "method_status",
    "method_requirement", "automation_role", "normative_text_included"
  ]);
  assert.equal(catalog.catalogs.jis_x_8341_3_2016.at(-2).method_key, "parsing-legacy");
  assert.ok(catalog.sources.every((source) => /^[a-f0-9]{64}$/.test(source.source_sha256)));
});

test("catalog comparison separates source, requirement, and routing changes", async () => {
  const { compareCatalogs } = await import("../scripts/compare-criteria-catalog.mjs");
  const current = {
    verified_at: "2026-07-14",
    sources: [{ id: "SOURCE", url: "https://example.test", role: "fixture", source_sha256: "a".repeat(64) }],
    catalogs: {
      web_modern: [
        { id: "A", title_en: "Old title", level: "A", method_key: "old-route", evidence_hints: ["one"] },
        { id: "REMOVED", title_en: "Removed", level: "A", method_key: "route", evidence_hints: [] }
      ]
    }
  };
  const candidate = {
    verified_at: "2026-07-16",
    sources: [{ id: "SOURCE", url: "https://example.test", role: "fixture", source_sha256: "b".repeat(64) }],
    catalogs: {
      web_modern: [
        { id: "ADDED", title_en: "Added", level: "A", method_key: "route", evidence_hints: [] },
        { id: "A", title_en: "New title", level: "AA", method_key: "new-route", evidence_hints: ["one"] }
      ]
    }
  };

  const comparison = compareCatalogs(current, candidate);
  const { structural_changes: structuralChanges, ...categorizedChanges } = comparison;
  assert.deepEqual(categorizedChanges, {
    source_hash_changes: [{
      source_id: "SOURCE",
      current_sha256: "a".repeat(64),
      candidate_sha256: "b".repeat(64)
    }],
    requirement_changes: {
      added: ["ADDED"],
      removed: ["REMOVED"],
      changed: [{
        id: "A",
        changes: [
          { field: "level", current: "A", candidate: "AA" },
          { field: "title_en", current: "Old title", candidate: "New title" }
        ]
      }]
    },
    routing_changes: [{ id: "A", current_method_key: "old-route", candidate_method_key: "new-route" }]
  });
  assert.deepEqual(structuralChanges?.map((change) => change.path), [
    "/catalogs/web_modern/A/level",
    "/catalogs/web_modern/A/method_key",
    "/catalogs/web_modern/A/title_en",
    "/catalogs/web_modern/ADDED",
    "/catalogs/web_modern/REMOVED"
  ]);
});

test("catalog comparison reports every nonvolatile structural change", async () => {
  const { compareCatalogs } = await import("../scripts/compare-criteria-catalog.mjs");
  const requirement = {
    id: "A",
    title_en: "Stable title",
    level: "A",
    method_key: "stable-route",
    evidence_hints: ["one"]
  };
  const current = {
    schema_version: "1.0.0",
    catalog_status: "metadata_complete",
    verified_at: "2026-07-14",
    copyright_boundary: "Current boundary",
    sources: [{
      id: "SOURCE",
      url: "https://current.example.test",
      role: "current role",
      source_sha256: "a".repeat(64)
    }],
    catalogs: { web_modern: [requirement], jp_public: [] }
  };
  const candidate = {
    schema_version: "1.1.0",
    catalog_status: "candidate_review",
    verified_at: "2026-07-17",
    copyright_boundary: "Candidate boundary",
    sources: [{
      id: "SOURCE",
      url: "https://candidate.example.test",
      role: "candidate role",
      source_sha256: "b".repeat(64)
    }],
    catalogs: { web_modern: [], jp_public: [requirement] }
  };

  const comparison = compareCatalogs(current, candidate);
  assert.deepEqual(comparison.structural_changes?.map((change) => change.path), [
    "/catalog_status",
    "/catalogs/jp_public/A",
    "/catalogs/web_modern/A",
    "/copyright_boundary",
    "/schema_version",
    "/sources/SOURCE/role",
    "/sources/SOURCE/url"
  ]);
  assert.deepEqual(comparison.structural_changes?.find((change) => change.path === "/catalogs/jp_public/A"), {
    path: "/catalogs/jp_public/A",
    current: { present: false },
    candidate: { present: true, value: requirement }
  });
  assert.deepEqual(comparison.source_hash_changes, [{
    source_id: "SOURCE",
    current_sha256: "a".repeat(64),
    candidate_sha256: "b".repeat(64)
  }]);
  assert.deepEqual(comparison.requirement_changes, { added: [], removed: [], changed: [] });
  assert.deepEqual(comparison.routing_changes, []);
});

test("catalog comparison CLI is read-only", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-catalog-compare-"));
  const currentPath = path.join(temporaryRoot, "current.json");
  const candidatePath = path.join(temporaryRoot, "candidate.json");
  const current = sampleCatalog();
  const candidate = structuredClone(current);
  candidate.verified_at = "2026-07-17";
  candidate.sources[0].source_sha256 = "f".repeat(64);
  fs.writeFileSync(currentPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  const currentBefore = fs.readFileSync(currentPath);
  const candidateBefore = fs.readFileSync(candidatePath);

  try {
    const result = runNode("scripts/compare-criteria-catalog.mjs", [
      "--current", currentPath, "--candidate", candidatePath
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout).requirement_changes, { added: [], removed: [], changed: [] });
    assert.deepEqual(fs.readFileSync(currentPath), currentBefore);
    assert.deepEqual(fs.readFileSync(candidatePath), candidateBefore);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
