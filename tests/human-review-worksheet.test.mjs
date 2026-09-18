import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createAuditRun, bindTargetInventory, writeNewJson, validateAuditRun } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { encodeCsv, decodeCsv, encodeMarkdown, decodeMarkdown, reviewFromWorksheet, worksheetHeader } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-worksheet.mjs";
import { encodeXlsx, decodeXlsx, validateWorksheetZip } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-xlsx.mjs";
import { buildPublicReportModel } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";
import { fixtureInventory } from "./helpers/measured-targets.mjs";
import { cli, pass, read } from "./helpers/scanner-import.mjs";

const ids = ["WCAG-2.2-SC-1.1.1", "WCAG-2.2-SC-1.3.1"];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-worksheet-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactRoot = path.join(root, "artifacts"); fs.mkdirSync(artifactRoot);
  const initialFile = path.join(root, "initial.json"), runFile = path.join(root, "queued.json");
  const initial = createAuditRun({ runFile: initialFile, artifactRoot, runId: `RUN-20260919T000000Z-${crypto.randomBytes(4).toString("hex").toUpperCase()}`, profile: "web-modern",
    targetName: "Synthetic worksheet fixture", targetVersion: "v1", targetRefs: ["https://example.com/test"], network: "none", interaction: "safe_read_only", sourceWrite: "none",
    inspectionMode: "quick", inspectionPurpose: "Synthetic test only" });
  writeNewJson(initialFile, bindTargetInventory(initial, fixtureInventory(initial, artifactRoot), { runFile: initialFile }));
  const queueFile = path.join(artifactRoot, "queue.json"), queueId = "ART-WORKSHEET-QUEUE";
  pass(cli(["review-queue", "--run", initialFile, "--artifact-id", queueId, "--requirement", ids[0], "--requirement", ids[1], "--output", queueFile]));
  pass(cli(["register", "--run", initialFile, "--artifact", queueFile, "--output", runFile]));
  return { root, artifactRoot, runFile, queueFile, queueId, queue: read(queueFile) };
}
const extensions = { csv: "csv", markdown: "md", xlsx: "xlsx" };
function exportSheet(f, format = "csv", name = "sheet") {
  const output = path.join(f.artifactRoot, `${name}.${extensions[format]}`);
  pass(cli(["human-review", "export", "--run", f.runFile, "--queue", f.queueId, "--format", format, "--output", output]));
  return output;
}
function importSheet(f, input, name = "review", extras = []) {
  const output = path.join(f.artifactRoot, `${name}.json`);
  const result = cli(["human-review", "import", "--run", f.runFile, "--queue", f.queueId, "--input", input, "--output", output, ...extras]);
  return { output, result };
}
const set = (rows, key, value) => { const row = rows.find((row) => row[0] === key); assert.ok(row, key); row[4] = value; };
function mergeReview(f, registered) {
  const run = read(registered), baseline = path.join(f.root, "baseline.json"), output = path.join(f.root, "assessment.json");
  pass(cli(["assessment", "--profile", run.profile.id, "--target-name", run.target.name, "--target-version", run.target.version_or_commit,
    "--target-ref", run.target.urls_or_files[0], "--evaluator", "Synthetic reviewer", "--evaluated-at", "2026-09-18", "--output", baseline]));
  const assessment = read(baseline); assessment.assessment.scope = run.scope; assessment.assessment.environment = run.environment;
  fs.writeFileSync(baseline, JSON.stringify(assessment), "utf8");
  pass(cli(["merge", "--run", registered, "--assessment", baseline, ...run.artifacts.flatMap((entry) => ["--artifact", path.join(f.artifactRoot, entry.path)]), "--output", output]));
  return output;
}
function fill(rows, id = ids[0], outcome = "pass", name = "Synthetic reviewer") {
  set(rows, "reviewer.name", name); set(rows, "reviewer.date", "2026-09-18");
  set(rows, "reviewer.declaration", "Synthetic test data; no real audit was performed.");
  set(rows, `${id}.outcome`, outcome); set(rows, `${id}.rationale`, "Synthetic rationale | quote \"literal\"\nsecond line & <tag>");
  for (const row of rows.filter((row) => row[0].startsWith(`${id}.evidence.`) && row[0].endsWith(".type") && row[4])) {
    if (outcome === "not_tested" && row[4] !== "manual_observation") continue;
    const prefix = row[0].slice(0, -4);
    set(rows, `${prefix}location`, "https://example.com/test #image");
    set(rows, `${prefix}observation`, outcome === "not_tested" ? "Synthetic note: review not performed because the target is unavailable." : "Synthetic observation only.");
    set(rows, `${prefix}captured_at`, "2026-09-18T10:00:00.123456+09:00");
  }
  if (outcome === "fail") {
    set(rows, `${id}.finding.priority`, "P1"); set(rows, `${id}.finding.location`, "https://example.com/test #image");
    set(rows, `${id}.finding.affected_users`, "Screen reader users\nLow vision users"); set(rows, `${id}.finding.observation`, "Synthetic missing alternative text.");
  }
  return rows;
}

for (const [format, outcome] of [["csv", "pass"], ["markdown", "fail"], ["xlsx", "cant_tell"]]) {
  test(`${format} exports fixed instructions and imports a partial ${outcome} review that registers and merges`, async (t) => {
    const f = fixture(t), before = fs.readFileSync(f.runFile), sheet = exportSheet(f, format);
    const rows = format === "xlsx" ? await decodeXlsx(fs.readFileSync(sheet)) : format === "csv" ? decodeCsv(fs.readFileSync(sheet, "utf8")) : decodeMarkdown(fs.readFileSync(sheet, "utf8"));
    assert.ok(rows.some((row) => row[0] === `${ids[0]}.targets` && row[4].includes("https://example.com/test")));
    assert.ok(rows.some((row) => row[0] === `${ids[0]}.sources` && row[4].includes("https://")));
    assert.ok(rows.some((row) => row[0] === `${ids[0]}.procedure` && row[4].length > 30));
    fill(rows, ids[0], outcome);
    if (format === "xlsx") {
      // Model an ordinary workbook editor save, not only our own encoder.
      const book = new ExcelJS.Workbook(); await book.xlsx.load(fs.readFileSync(sheet));
      for (let i = 1; i < rows.length; i++) if (rows[i][2] === "入力") book.worksheets[0].getCell(i + 1, 5).value = rows[i][4];
      fs.writeFileSync(sheet, Buffer.from(await book.xlsx.writeBuffer()));
    } else fs.writeFileSync(sheet, format === "csv" ? encodeCsv(rows) : encodeMarkdown(rows), "utf8");
    const imported = importSheet(f, sheet); pass(imported.result);
    assert.deepEqual(fs.readFileSync(f.runFile), before);
    const artifact = read(imported.output);
    assert.equal(artifact.payload.identity_authenticated, false); assert.equal(artifact.payload.reviews.length, 1);
    assert.equal(artifact.payload.reviews[0].profile_outcome, outcome);
    assert.equal(artifact.payload.reviews[0].target_specific_evidence[0].captured_at, "2026-09-18T01:00:00.123456Z");
    assert.equal(artifact.inputs[0].sha256, read(f.runFile).artifacts.find((entry) => entry.artifact_id === f.queueId).sha256);
    if (outcome === "fail") assert.equal(artifact.payload.reviews[0].finding.affected_users.length, 2);
    const registered = path.join(f.root, "reviewed.json"); pass(cli(["register", "--run", f.runFile, "--artifact", imported.output, "--output", registered]));
    assert.equal(validateAuditRun(read(registered), { runFile: registered }).valid, true);
    const assessment = mergeReview(f, registered);
    assert.equal(read(assessment).assessment.results.find((row) => row.requirement_id === ids[0]).outcome, outcome);
    assert.equal(read(assessment).assessment.results.find((row) => row.requirement_id === ids[1]).outcome, "not_tested");
    const repeated = importSheet(f, sheet); assert.notEqual(repeated.result.status, 0, "Existing output is not overwritten");
  });
}

test("all five outcomes work; not_tested records only an explicit non-performance note without fabricated tests", (t) => {
  const f = fixture(t), sheet = exportSheet(f), expected = decodeCsv(fs.readFileSync(sheet, "utf8"));
  for (const outcome of ["pass", "fail", "not_applicable", "not_tested", "cant_tell"]) {
    const rows = fill(structuredClone(expected), ids[0], outcome);
    const payload = reviewFromWorksheet({ rows, expected, items: f.queue.payload.items, artifactId: "ART-TEST", now: "2026-09-19T00:00:00Z" });
    assert.equal(payload.reviews[0].profile_outcome, outcome);
    if (outcome === "not_tested") assert.deepEqual(payload.reviews[0].target_specific_evidence.map((entry) => entry.type), ["manual_observation"]);
  }
  fs.writeFileSync(sheet, encodeCsv(fill(structuredClone(expected), ids[0], "not_tested")), "utf8");
  const imported = importSheet(f, sheet); pass(imported.result);
  const contradictory = fill(structuredClone(expected)); set(contradictory, `${ids[0]}.outcome`, "not_tested");
  assert.throws(() => reviewFromWorksheet({ rows: contradictory, expected, items: f.queue.payload.items, artifactId: "ART-TEST", now: "2026-09-19T00:00:00Z" }), /only a manual_observation/u);
  const registered = path.join(f.root, "reviewed.json"); pass(cli(["register", "--run", f.runFile, "--artifact", imported.output, "--output", registered]));
  const assessment = mergeReview(f, registered);
  assert.equal(read(assessment).assessment.results.find((row) => row.requirement_id === ids[0]).outcome, "not_tested");
  assert.equal(read(assessment).assessment.evidence_level, "E0", "Non-performance cannot promote evidence to E2");
  const run = read(registered), validation = validateAuditRun(run, { runFile: registered });
  const model = buildPublicReportModel({ run, assessment: read(assessment), envelopesById: validation.envelopesById, resources: validation.resources });
  assert.equal(model.reviewedCount, 0); assert.equal(model.evaluationCoverage.humanReviewed, 0);
  assert.ok(model.pendingHumanChecks.some((item) => item.requirement_id === ids[0]));
  for (const locale of ["ja", "en"]) for (const format of ["markdown", "html"]) {
    const report = path.join(f.root, `not-tested-${locale}.${format}`);
    pass(cli(["report", "--run", registered, "--assessment", assessment, "--locale", locale, "--format", format, "--output", report, "--visibility", "public", "--reviewer-disclosure", "redact", "--redaction-manifest", `${report}.redaction.json`]));
  }
});

test("missing answers, findings, evidence, invalid dates and fixed-field tampering fail before any output", (t) => {
  const f = fixture(t), sheet = exportSheet(f), expected = decodeCsv(fs.readFileSync(sheet, "utf8"));
  const cases = [
    (rows) => set(rows, `${ids[0]}.title`, "forged title"),
    (rows) => set(rows, "context.run_sha256", "0".repeat(64)),
    (rows) => set(rows, "context.queue_sha256", "0".repeat(64)),
    (rows) => set(rows, `${ids[0]}.outcome`, ""),
    (rows) => set(rows, `${ids[0]}.outcome`, "success"),
    (rows) => set(rows, `${ids[0]}.rationale`, "  "),
    (rows) => set(rows, `${ids[0]}.finding.priority`, ""),
    (rows) => set(rows, `${ids[0]}.evidence.0.captured_at`, "2026-02-30T10:00:00Z"),
    (rows) => set(rows, `${ids[0]}.evidence.0.captured_at`, "2099-01-01T00:00:00Z"),
    (rows) => set(rows, "reviewer.date", "2026-02-30"),
    (rows) => rows.push(rows[1]),
    (rows) => rows.splice(4, 1),
    (rows) => rows.filter((row) => row[0].startsWith(`${ids[0]}.evidence.`) && row[2] === "入力").forEach((row) => { row[4] = ""; })
  ];
  for (const [index, mutate] of cases.entries()) {
    const rows = fill(structuredClone(expected), ids[0], "fail"); mutate(rows);
    fs.writeFileSync(sheet, encodeCsv(rows), "utf8");
    const result = importSheet(f, sheet, `bad-${index}`); assert.notEqual(result.result.status, 0, `case ${index}`); assert.equal(fs.existsSync(result.output), false);
  }
});

test("another run, changed queue and stale run reject; separate reviewers can submit remaining disjoint criteria", (t) => {
  const f = fixture(t), other = fixture(t), sheet = exportSheet(f), rows = fill(decodeCsv(fs.readFileSync(sheet, "utf8")));
  fs.writeFileSync(sheet, encodeCsv(rows), "utf8");
  assert.notEqual(importSheet(other, sheet, "wrong-run").result.status, 0);
  const queueBytes = fs.readFileSync(f.queueFile); fs.appendFileSync(f.queueFile, " ");
  assert.notEqual(importSheet(f, sheet, "changed-queue").result.status, 0); fs.writeFileSync(f.queueFile, queueBytes);
  const first = importSheet(f, sheet, "first"); pass(first.result);
  const nextRun = path.join(f.root, "first-run.json"); pass(cli(["register", "--run", f.runFile, "--artifact", first.output, "--output", nextRun]));
  f.runFile = nextRun;
  const stale = importSheet(f, sheet, "stale"); assert.notEqual(stale.result.status, 0); assert.equal(fs.existsSync(stale.output), false);
  const nextSheet = exportSheet(f, "csv", "remaining"), remaining = decodeCsv(fs.readFileSync(nextSheet, "utf8"));
  assert.equal(remaining.some((row) => row[0] === `${ids[0]}.outcome`), false);
  fill(remaining, ids[1], "pass", "Second synthetic reviewer"); fs.writeFileSync(nextSheet, encodeCsv(remaining), "utf8");
  const second = importSheet(f, nextSheet, "second"); pass(second.result);
  const finalRun = path.join(f.root, "second-run.json"); pass(cli(["register", "--run", f.runFile, "--artifact", second.output, "--output", finalRun]));
  assert.equal(validateAuditRun(read(finalRun), { runFile: finalRun }).valid, true);
  assert.equal(read(second.output).payload.reviewer_name, "Second synthetic reviewer");
});

test("CSV and Markdown preserve formulas as text, escaping, newlines and literal entities; malformed tables reject", () => {
  const rows = [worksheetHeader, ...["=1+1", "+cmd", "-1", "@value", " \t=1", "'literal", "\nline", "<br>&#124;|`*_[x]\\\r\n次の行"].map((text, index) => [String(index), "Test", "入力", "Text", text, "help"])];
  assert.deepEqual(decodeCsv(encodeCsv(rows)), rows);
  assert.deepEqual(decodeMarkdown(encodeMarkdown(rows)), rows);
  assert.match(encodeCsv(rows), /"'=1\+1"/u);
  assert.throws(() => decodeCsv('"unterminated'), /quote/u);
  assert.throws(() => decodeCsv('"value"bad,'), /quoting/u);
  assert.throws(() => decodeMarkdown("# arbitrary document"), /header/u);
  assert.throws(() => decodeCsv("a,b,c,d,e,f,g\n"), /six text columns/u);
});

test("XLSX rejects formulas, external hyperlinks, XML entities, oversized entries, address inflation and altered fixed cells", async (t) => {
  const rows = [worksheetHeader, ["test", "Test", "入力", "Text", "", "help"]];
  const bytes = await encodeXlsx(rows); const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  book.worksheets[0].getCell("E2").value = { formula: "1+1", result: 2 };
  await assert.rejects(decodeXlsx(Buffer.from(await book.xlsx.writeBuffer())), /formulas/u);
  book.worksheets[0].getCell("E2").value = { text: "External", hyperlink: "https://example.com/" };
  await assert.rejects(decodeXlsx(Buffer.from(await book.xlsx.writeBuffer())), /external/u);
  for (const mutate of [
    (xml) => xml.replace("<worksheet", '<!DOCTYPE worksheet [<!ENTITY x "expanded">]><worksheet'),
    (xml) => xml.replace('r="E2"', 'r="E999999"'),
    (xml) => xml.replace('r="E2"', 'r="XFD2"')
  ]) {
    const zip = await JSZip.loadAsync(bytes); zip.file("xl/worksheets/sheet1.xml", mutate(await zip.file("xl/worksheets/sheet1.xml").async("string")));
    await assert.rejects(decodeXlsx(await zip.generateAsync({ type: "nodebuffer" })), /entities|bounds/u);
  }
  const zip = await JSZip.loadAsync(bytes); zip.file("xl/oversize.xml", " ".repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(decodeXlsx(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })), /oversized/u);
  const f = fixture(t), sheet = exportSheet(f, "xlsx"), edited = new ExcelJS.Workbook(); await edited.xlsx.load(fs.readFileSync(sheet));
  edited.worksheets[0].getCell("E2").value = "forged version"; fs.writeFileSync(sheet, Buffer.from(await edited.xlsx.writeBuffer()));
  assert.notEqual(importSheet(f, sheet, "tampered").result.status, 0);
});

test("Excel's DEFLATE compression flags round-trip while encryption flags remain rejected", async () => {
  const rows = [worksheetHeader, ["test", "Test", "入力", "Text", "value", "help"]];
  const bytes = await encodeXlsx(rows);
  let end = bytes.length - 22; while (bytes.readUInt32LE(end) !== 0x06054b50) end--;
  let at = bytes.readUInt32LE(end + 16);
  const pairs = [];
  while (at < end) {
    const local = bytes.readUInt32LE(at + 42);
    if (bytes.readUInt16LE(at + 10) === 8) {
      bytes.writeUInt16LE(bytes.readUInt16LE(at + 8) | 6, at + 8); bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) | 6, local + 6);
      pairs.push([at + 8, local + 6]);
    }
    at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  assert.ok(pairs.length); assert.deepEqual(await decodeXlsx(bytes), rows);
  for (const offset of pairs[0]) bytes.writeUInt16LE(bytes.readUInt16LE(offset) | 1, offset);
  assert.throws(() => validateWorksheetZip(bytes), /Unsupported/u);
});
