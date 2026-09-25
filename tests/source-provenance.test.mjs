import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSourceProvenance, validateSourceProvenance, verifySourceProvenance, thirdPartyNoticeMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/source-provenance.mjs";
import { attestationDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-canonical.mjs";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { verifySourceNotices } from "../scripts/verify-source-provenance.mjs";
import { writeCatalogCandidate } from "../scripts/build-criteria-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-source-provenance-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function node(script, args) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function copyResources(destination, manifest) {
  for (const relative of [...manifest.resource_bindings.map(item => item.path), ...manifest.licenses.map(item => item.archived_file).filter(Boolean)]) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(skill, relative), target);
  }
}
function assertAttribution(text) {
  for (const expected of ["https://www.w3.org/TR/WCAG22/", "https://waic.jp/docs/jis2016/test-guidelines/202012/gcl_example.html",
    "https://www.digital.go.jp/accessibility-statement", "https://www.w3.org/copyright/document-license-2023/",
    "https://creativecommons.org/licenses/by-sa/2.1/jp/", "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
    "Nagi-Inaba", "Copyright © 2023 W3C®"]) assert.ok(text.includes(expected), expected);
  assert.doesNotMatch(text, /NOTICE-PRIVATE-TOKEN|private@example\.test/u);
}

test("source register and generated notices agree without relicensing unknown terms", () => {
  assert.equal(verifySourceNotices().status, "PASS");
  const manifest = loadSourceProvenance();
  assert.equal(manifest.sources.find(item => item.id === "WAI-ARIA-1.2").terms_id, "w3c-software-document-2015");
  assert.equal(manifest.sources.find(item => item.id === "HTML-ARIA-2026-04-15").terms_id, "w3c-software-document-2023");
  const unknown = manifest.sources.find(item => item.id === "MIC-MICHECKER-FAQ");
  assert.equal(unknown.terms_id, null);
  unknown.terms_id = "MIT";
  assert.throws(() => validateSourceProvenance(manifest), /Unreviewed source terms/);
  const invalid = loadSourceProvenance();
  invalid.third_party_relicensed_as_mit = true;
  assert.throws(() => validateSourceProvenance(invalid), /Invalid source provenance/);
  const hidden = loadSourceProvenance();
  hidden.sources[0].report_notice = false;
  assert.throws(() => validateSourceProvenance(hidden), /requires report attribution/);
  const unbound = loadSourceProvenance();
  unbound.resource_bindings = unbound.resource_bindings.filter(item => item.path !== "references/aria-review-rules.json");
  assert.throws(() => validateSourceProvenance(unbound), /Required source binding missing/);
  const missingSource = loadSourceProvenance();
  missingSource.resource_bindings.find(item => item.path === "references/aria-review-rules.json").source_ids = ["WCAG-2.2"];
  assert.throws(() => validateSourceProvenance(missingSource), /Required source binding missing/);
});

test("changed metadata, catalog source and archived license require renewed review", t => {
  const directory = temp(t), manifest = loadSourceProvenance();
  copyResources(directory, manifest);
  assert.equal(verifySourceProvenance({ skillRoot: directory, manifest }).status, "PASS");
  const file = path.join(directory, "references/criteria-catalog.json");
  const original = fs.readFileSync(file);
  const changed = read(file);
  changed.catalogs.web_modern[0].title_en += " changed";
  write(file, changed);
  assert.throws(() => verifySourceProvenance({ skillRoot: directory, manifest }), /review required for changed resource/);
  fs.writeFileSync(file, original);
  changed.catalogs.web_modern[0].title_en = read(file).catalogs.web_modern[0].title_en;
  changed.sources[0].source_sha256 = "f".repeat(64);
  write(file, changed);
  const rebound = structuredClone(manifest);
  rebound.resource_bindings.find(item => item.path === "references/criteria-catalog.json").canonical_sha256 = attestationDigest(changed);
  assert.throws(() => verifySourceProvenance({ skillRoot: directory, manifest: rebound }), /Catalog source\/license review required/);
  fs.writeFileSync(file, original);
  fs.appendFileSync(path.join(directory, manifest.licenses[0].archived_file), "changed", "utf8");
  assert.throws(() => verifySourceProvenance({ skillRoot: directory, manifest }), /Archived license changed/);
});

test("candidate output retains exact provenance and pending review without overwriting a companion", t => {
  const directory = temp(t), file = path.join(directory, "nested", "candidate.json");
  const catalog = read(path.join(skill, "references/criteria-catalog.json"));
  assert.equal(writeCatalogCandidate(file, catalog), file);
  const companion = read(file + ".sources.json");
  assert.equal(companion.status, "pending_source_license_review");
  assert.equal(companion.catalog_sha256, sha(fs.readFileSync(file)));
  assert.deepEqual(companion.catalog_sources, catalog.sources);
  assert.equal(companion.source_provenance.third_party_relicensed_as_mit, false);
  assert.match(companion.notice, /未確認/);
  const second = path.join(directory, "blocked.json");
  fs.writeFileSync(second + ".sources.json", "preserve");
  assert.throws(() => writeCatalogCandidate(second, catalog), /Refusing to overwrite/);
  assert.equal(fs.existsSync(second), false);
  assert.equal(fs.readFileSync(second + ".sources.json", "utf8"), "preserve");
  const refresh = node("scripts/build-criteria-catalog.mjs", ["--refresh", "--verified-at", "2026-09-19", "--output", second]);
  assert.notEqual(refresh.status, 0);
  assert.match(refresh.stderr, /Refusing to overwrite existing output or source companion/);
  assert.equal(fs.existsSync(second), false);
});

test("new catalog sources cannot omit report attribution or their resource binding", t => {
  const directory = temp(t), manifest = loadSourceProvenance();
  copyResources(directory, manifest);
  const file = path.join(directory, "references/criteria-catalog.json"), catalog = read(file);
  const extra = { ...catalog.sources[0], id: "ADDED-SOURCE" };
  catalog.sources.push(extra);
  write(file, catalog);
  manifest.sources.push({ ...manifest.sources[0], id: extra.id, report_notice: false });
  const binding = manifest.resource_bindings.find(item => item.path === "references/criteria-catalog.json");
  binding.canonical_sha256 = attestationDigest(catalog);
  assert.throws(() => verifySourceProvenance({ skillRoot: directory, manifest }), /Catalog source requires report attribution/);
  manifest.sources.at(-1).report_notice = true;
  assert.throws(() => verifySourceProvenance({ skillRoot: directory, manifest }), /Catalog source binding missing/);
  binding.source_ids.push(extra.id);
  assert.equal(verifySourceProvenance({ skillRoot: directory, manifest }).status, "PASS");
});

test("human-readable notice drift is rejected even when the source register is valid", t => {
  const directory = temp(t), manifest = loadSourceProvenance();
  const canonical = path.join(directory, "shared/skill");
  copyResources(canonical, manifest);
  write(path.join(canonical, "references/third-party-sources.json"), manifest);
  for (const relative of ["THIRD_PARTY_NOTICES.md", "shared/skill/references/third-party-notices.md", "codex/skills/information-accessibility-practice/references/third-party-notices.md", "claude/skills/information-accessibility-practice/references/third-party-notices.md"]) {
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, thirdPartyNoticeMarkdown(manifest), "utf8");
  }
  assert.equal(verifySourceNotices(directory).status, "PASS");
  fs.appendFileSync(path.join(directory, "THIRD_PARTY_NOTICES.md"), "changed", "utf8");
  assert.throws(() => verifySourceNotices(directory), /Generated third-party notice differs/);
});

test("all report formats and locales preserve notices in summary and appendix with public redaction", t => {
  const directory = temp(t), input = path.join(directory, "assessment.json");
  write(input, generateAssessment("jp-public-web", {
    targetName: "Example private@example.test", targetVersion: "v1",
    targetRefs: ["https://example.test/?token=NOTICE-PRIVATE-TOKEN"],
    evaluator: "private@example.test", evaluatedAt: "2026-09-19"
  }));
  for (const locale of ["ja", "en"]) for (const format of ["markdown", "html"]) {
    const ext = format === "html" ? "html" : "md", stem = path.join(directory, locale + "-" + format);
    const result = node("codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs",
      ["report", "--input", input, "--locale", locale, "--format", format, "--detail", "summary", "--visibility", "public",
        "--reviewer-disclosure", "redact", "--redaction-manifest", stem + ".json", "--output", stem + "." + ext, "--appendix", stem + "-appendix." + ext]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const file of [stem + "." + ext, stem + "-appendix." + ext]) {
      const content = fs.readFileSync(file, "utf8");
      assertAttribution(content);
      assert.ok(content.includes(locale === "ja" ? "規格メタデータの出典と利用条件" : "Third-party metadata attribution"));
    }
  }
});

test("legacy renderer also retains third-party notices", t => {
  const directory = temp(t), input = path.join(directory, "assessment.json"), output = path.join(directory, "report.md");
  write(input, generateAssessment("web-modern", { targetName: "Example", targetVersion: "v1", targetRefs: ["https://example.test/"], evaluator: "Test", evaluatedAt: "2026-09-19" }));
  const result = node("codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs", ["--input", input, "--output", output]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertAttribution(fs.readFileSync(output, "utf8"));
});
