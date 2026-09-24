#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertNewOutputPath,
  assertStableFile,
  readStableFile,
  validateAuditRun,
  writeNewJson,
  writeNewText
} from "./lib/audit-run.mjs";
import {
  buildPublicReportModel,
  validateRunBackedAssessment
} from "./legacy-report-core.mjs";
import { renderReportHtml } from "./lib/report-html.mjs";
import {
  buildRunBackedPresentation,
  buildStandalonePresentation,
  renderReportMarkdown
} from "./lib/report-presentation.mjs";
import { normalizeReportLocale } from "./lib/report-locale.mjs";
import {
  addPublicationNotice,
  applyReportVisibility,
  buildInternalRunBackedModel,
  normalizeReportVisibility,
  normalizeReviewerDisclosure
} from "./lib/report-privacy.mjs";
import { renderReportSummaryMarkdown } from "./lib/report-summary.mjs";
import { validateAssessment } from "./validate-assessment.mjs";
import { parseAttestationJson } from "./lib/attestation-canonical.mjs";
import { reviewerVerificationOptions } from "./lib/assessment-provenance.mjs";
import { loadReviewTrust } from "./lib/review-trust-input.mjs";
import { lifecycleSummary, loadLifecycle, renderLifecycleHtml, renderLifecycleReport } from "./lib/finding-lifecycle.mjs";
import { isCalendarDate } from "./lib/date-time.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);

function parseSnapshotJson(snapshot, label) {
  try {
    return structuredClone(parseAttestationJson(snapshot.bytes));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function readReference(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, "references", relativePath), "utf8").replace(/^\uFEFF/u, ""));
}

function hardenMarkdownOutput(value) {
  return value.replace(/<br>(#{1,6})(?=\s)/gu, (_match, hashes) => `<br>${hashes.replace(/#/gu, "\\#")}`);
}

function parseArgs(argv) {
  const options = { locale: "ja", detail: "full", visibility: "internal", format: "markdown", lifecycleFiles: [] };
  const supported = new Map([
    ["--input", "input"],
    ["--run", "run"],
    ["--assessment", "assessment"],
    ["--output", "output"],
    ["--locale", "locale"],
    ["--detail", "detail"],
    ["--appendix", "appendix"],
    ["--visibility", "visibility"],
    ["--reviewer-disclosure", "reviewerDisclosure"],
    ["--redaction-manifest", "redactionManifest"],
    ["--format", "format"],
    ["--trust-policy", "trustPolicy"],
    ["--trust-policy-sha256", "trustPolicySha256"],
    ["--lifecycle", "lifecycleFiles"],
    ["--as-of", "asOf"]
  ]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const key = supported.get(arg);
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    if (key !== "lifecycleFiles" && seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (key === "lifecycleFiles") options.lifecycleFiles.push(value);
    else options[key] = value;
    index += 1;
  }
  options.locale = normalizeReportLocale(options.locale);
  if (!["summary", "full"].includes(options.detail)) throw new Error("--detail must be summary or full");
  if (!["markdown", "html"].includes(options.format)) throw new Error("--format must be markdown or html");
  options.visibility = normalizeReportVisibility(options.visibility);
  if (options.asOf && !isCalendarDate(options.asOf)) throw new Error("--as-of must be a valid YYYY-MM-DD date.");
  if (options.reviewerDisclosure !== undefined) {
    options.reviewerDisclosure = normalizeReviewerDisclosure(options.reviewerDisclosure);
  }
  return options;
}

function validateOptionCombinations(options) {
  if (options.appendix && options.detail !== "summary") {
    throw new Error("--appendix is available only with --detail summary.");
  }
  if (options.visibility === "public") {
    if (!options.reviewerDisclosure) throw new Error("Public output requires --reviewer-disclosure include|redact.");
    if (!options.redactionManifest) throw new Error("Public output requires --redaction-manifest <manifest.json>.");
  } else {
    options.reviewerDisclosure ??= "include";
    if (options.redactionManifest) throw new Error("--redaction-manifest is only valid with --visibility public.");
  }
}

function outputPaths(options) {
  return [options.output, options.appendix, options.redactionManifest].filter(Boolean).map((value) => path.resolve(value));
}

function preflightOutputs(options) {
  const paths = outputPaths(options);
  const keys = paths.map((value) => process.platform === "win32" ? value.toLowerCase() : value);
  if (new Set(keys).size !== keys.length) throw new Error("Report, appendix, and redaction manifest must use distinct output paths.");
  for (const output of paths) assertNewOutputPath(output);
}

export function usage() {
  return [
    "Usage:",
    "  accessibility-audit report --input <assessment.json> [report options]",
    "  accessibility-audit report --run <audit-run.json> --assessment <assessment.json> --output <new-report.md|html> [report options]",
    "",
    "Report options:",
    "  --format <markdown|html>                 Output format. Default: markdown.",
    "  --locale <ja|en>                         Human-readable locale. Default: ja.",
    "  --detail <summary|full>                  Decision-ready summary or complete 55/56-row report. Default: full.",
    "  --appendix <full-report.md|html>         With --detail summary, also write the complete report in the selected format.",
    "  --visibility <internal|public>           Internal raw data or publication-oriented redaction. Default: internal.",
    "  --reviewer-disclosure <include|redact>   Required for public output.",
    "  --redaction-manifest <manifest.json>     Required internal review record for public output.",
    "  --output <report.md|html>                New output. Existing files are never overwritten.",
    "  --lifecycle <latest-record.json>         Include validated finding management; repeatable for run-backed reports.",
    "  --as-of <YYYY-MM-DD>                     Date for overdue and exception alerts; default is the host local date.",
    "  --trust-policy <file> --trust-policy-sha256 <hash>  Recipient-selected reviewer key policy and independently selected pin.",
    "",
    "Public redaction is not publication approval. Human publication review remains required.",
    "HTML is the supported distribution format. PDF is not supported until tagging and reading order can be verified.",
    "The command does not modify the audited target or promote AI screening into a human-verified profile outcome."
  ].join("\n");
}

function validateStandalone(record, trust) {
  const registry = readReference("standards-registry.json");
  const schema = readReference("assessment-record.schema.json");
  const catalog = readReference("criteria-catalog.json");
  const methods = readReference("web-audit-methods.json");
  const validation = validateAssessment(record, registry, schema, catalog, methods, { trust });
  if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
  return { registry, catalog, validation };
}

function encodeRelativeHref(fromFile, toFile) {
  const fromDirectory = fromFile ? path.dirname(path.resolve(fromFile)) : process.cwd();
  const relative = path.relative(fromDirectory, path.resolve(toFile)).split(path.sep).join("/");
  return relative.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function renderOutputs(rawPresentation, options) {
  const { presentation, manifest } = applyReportVisibility(rawPresentation, {
    visibility: options.visibility,
    reviewerDisclosure: options.reviewerDisclosure
  });
  if (options.format === "html") {
    const appendixHref = options.appendix ? encodeRelativeHref(options.output, options.appendix) : null;
    return {
      report: renderReportHtml(presentation, { detail: options.detail, appendixHref }),
      appendix: options.appendix ? renderReportHtml(presentation, { detail: "full" }) : null,
      manifest,
      presentation
    };
  }
  const renderFull = () => addPublicationNotice(
    hardenMarkdownOutput(renderReportMarkdown(presentation)),
    presentation
  );
  const report = options.detail === "summary"
    ? addPublicationNotice(hardenMarkdownOutput(renderReportSummaryMarkdown(presentation)), presentation)
    : renderFull();
  const appendix = options.appendix ? renderFull() : null;
  return { report, appendix, manifest, presentation };
}

function writeRequestedOutputs(options, rendered, beforeWrite) {
  const written = { output: null, appendix: null, redaction_manifest: null };
  if (options.redactionManifest) {
    written.redaction_manifest = writeNewJson(path.resolve(options.redactionManifest), rendered.manifest, { beforeWrite });
  }
  if (options.appendix) written.appendix = writeNewText(path.resolve(options.appendix), rendered.appendix, { beforeWrite });
  if (options.output) written.output = writeNewText(path.resolve(options.output), rendered.report, { beforeWrite });
  return written;
}

function renderStandalone(options) {
  const snapshot = readStableFile(path.resolve(options.input), { label: "standalone assessment" });
  const record = parseSnapshotJson(snapshot, "standalone assessment");
  const trustInput = loadReviewTrust(options);
  const { registry, catalog, validation } = validateStandalone(record, trustInput.trust);
  const rawPresentation = buildStandalonePresentation({
    record,
    validation,
    registry,
    catalog,
    locale: options.locale
  });
  const rendered = renderOutputs(rawPresentation, options);
  const assertInputsStable = () => {
    assertStableFile(snapshot, "standalone assessment");
    for (const policySnapshot of trustInput.snapshots) assertStableFile(policySnapshot, "external reviewer trust policy");
  };
  const written = writeRequestedOutputs(options, rendered, assertInputsStable);
  if (!options.output) {
    assertInputsStable();
    process.stdout.write(rendered.report);
  }
  return {
    status: "PASS",
    input: snapshot.path,
    format: options.format,
    detail: options.detail,
    visibility: options.visibility,
    ...written
  };
}

function renderRunBacked(options) {
  const runSnapshot = readStableFile(path.resolve(options.run), { label: "audit run" });
  const assessmentSnapshot = readStableFile(path.resolve(options.assessment), { label: "run-backed assessment" });
  const run = parseSnapshotJson(runSnapshot, "audit run");
  const assessment = parseSnapshotJson(assessmentSnapshot, "run-backed assessment");
  const runValidation = validateAuditRun(run, { skillRoot, runFile: runSnapshot.path });
  if (!runValidation.valid) throw new Error(`Audit run validation failed:\n- ${runValidation.errors.join("\n- ")}`);
  const currentRunVersion = runValidation.resources.auditRunSchema.properties.schema_version.const;
    if (!["10.0.0", "11.0.0", "12.0.0", "13.0.0", currentRunVersion].includes(run.schema_version)) {
      throw new Error(`Run-backed reporting requires audit-run 10.0.0, 11.0.0, 12.0.0, 13.0.0 or current schema_version ${currentRunVersion}; use the original package for older records.`);
  }
  const trustInput = loadReviewTrust(options);
  const reviewOptions = reviewerVerificationOptions({ run, envelopesById: runValidation.envelopesById, trust: trustInput.trust });
  const validation = validateAssessment(
    assessment,
    runValidation.resources.standardsRegistry,
    runValidation.resources.assessmentSchema,
    runValidation.resources.criteriaCatalog,
    runValidation.resources.auditMethods,
    reviewOptions
  );
  if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
  validateRunBackedAssessment({
    run,
    assessment,
    envelopesById: runValidation.envelopesById,
    resources: runValidation.resources,
    trust: trustInput.trust
  });
  const publicModel = buildPublicReportModel({
    run,
    assessment,
    envelopesById: runValidation.envelopesById,
    resources: runValidation.resources,
    trust: trustInput.trust
  });
  const internalModel = buildInternalRunBackedModel({
    run,
    assessment,
    publicModel,
    envelopesById: runValidation.envelopesById
  });
  const rawPresentation = buildRunBackedPresentation({
    run,
    assessment,
    validation,
    publicModel: internalModel,
    registry: runValidation.resources.standardsRegistry,
    catalog: runValidation.resources.criteriaCatalog,
    locale: options.locale
  });
  const rendered = renderOutputs(rawPresentation, options);
  const lifecycleSnapshots = [], lifecycleIds = new Set();
  const lifecycle = options.lifecycleFiles.map((file) => {
    const loaded = loadLifecycle(path.resolve(file), { run, validation: runValidation, runFile: runSnapshot.path });
    if (lifecycleIds.has(loaded.record.finding_id)) throw new Error(`Duplicate lifecycle finding: ${loaded.record.finding_id}.`);
    lifecycleIds.add(loaded.record.finding_id);
    lifecycleSnapshots.push(...loaded.snapshots);
    return lifecycleSummary(loaded.record, options.asOf);
  });
  if (lifecycle.length) {
    const decorate = (text) => options.format === "html"
      ? text.replace("</main>", `${renderLifecycleHtml(lifecycle, options.locale)}\n</main>`)
      : `${text}${renderLifecycleReport(lifecycle, options.locale)}`;
    rendered.report = decorate(rendered.report);
    if (rendered.appendix) rendered.appendix = decorate(rendered.appendix);
  }
  const legacyChange = run.artifacts.some((entry) => entry.artifact_type === "change-record"
    && entry.producer_role === "authorized_fixer");
  if (legacyChange) {
    const note = options.locale === "ja"
      ? "旧変更記録のAI producer欄は引継ぎroleを示します。実際の変更実行者はこの記録から特定できません。"
      : "The AI producer in a legacy change record names the handoff role; this record does not identify the actual executor.";
    const decorate = (text) => options.format === "html"
      ? text.replace("</main>", `<p class="provenance-note">${note}</p>\n</main>`)
      : `${text}\n\n${note}\n`;
    rendered.report = decorate(rendered.report);
    if (rendered.appendix) rendered.appendix = decorate(rendered.appendix);
  }
  const artifactSnapshots = [...runValidation.envelopesById.values()]
    .map((record) => record.snapshot)
    .filter(Boolean);
  const assertInputsStable = () => {
    assertStableFile(runSnapshot, "audit run");
    assertStableFile(assessmentSnapshot, "run-backed assessment");
    for (const snapshot of artifactSnapshots) assertStableFile(snapshot, "registered artifact");
    for (const snapshot of runValidation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
    for (const snapshot of lifecycleSnapshots) assertStableFile(snapshot, "lifecycle input");
    for (const snapshot of trustInput.snapshots) assertStableFile(snapshot, "external reviewer trust policy");
  };
  const written = writeRequestedOutputs(options, rendered, assertInputsStable);
  return {
    status: "PASS",
    run: runSnapshot.path,
    assessment: assessmentSnapshot.path,
    format: options.format,
    detail: options.detail,
    visibility: options.visibility,
    ...written
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  validateOptionCombinations(options);
  const runBacked = Boolean(options.run || options.assessment);
  if (!runBacked && (options.lifecycleFiles.length || options.asOf)) throw new Error("Lifecycle status requires a run-backed report.");
  if (options.input && runBacked) throw new Error("Use either --input or the --run/--assessment interface, not both.");
  if (!options.input && !runBacked) throw new Error("--input or --run/--assessment is required.");
  if (runBacked && (!options.run || !options.assessment || !options.output)) {
    throw new Error("--run, --assessment, and --output are required for a run-backed report.");
  }
  preflightOutputs(options);
  const result = runBacked ? renderRunBacked(options) : renderStandalone(options);
  if (result.output) process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
