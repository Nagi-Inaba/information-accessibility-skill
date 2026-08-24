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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);

function parseSnapshotJson(snapshot, label) {
  try {
    return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
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
  const options = { locale: "ja", detail: "full", visibility: "internal" };
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
    ["--redaction-manifest", "redactionManifest"]
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
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[key] = value;
    index += 1;
  }
  options.locale = normalizeReportLocale(options.locale);
  if (!["summary", "full"].includes(options.detail)) throw new Error("--detail must be summary or full");
  options.visibility = normalizeReportVisibility(options.visibility);
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
    "  accessibility-audit report --run <audit-run.json> --assessment <assessment.json> --output <new-report.md> [report options]",
    "",
    "Report options:",
    "  --locale <ja|en>                         Human-readable locale. Default: ja.",
    "  --detail <summary|full>                  Decision-ready summary or complete 55/56-row report. Default: full.",
    "  --appendix <full-report.md>              With --detail summary, also write the complete report.",
    "  --visibility <internal|public>           Internal raw data or publication-oriented redaction. Default: internal.",
    "  --reviewer-disclosure <include|redact>   Required for public output.",
    "  --redaction-manifest <manifest.json>     Required internal review record for public output.",
    "  --output <report.md>                     New Markdown output. Existing files are never overwritten.",
    "",
    "Public redaction is not publication approval. Human publication review remains required.",
    "The command does not modify the audited target or promote AI screening into a human-verified profile outcome."
  ].join("\n");
}

function validateStandalone(record) {
  const registry = readReference("standards-registry.json");
  const schema = readReference("assessment-record.schema.json");
  const catalog = readReference("criteria-catalog.json");
  const methods = readReference("web-audit-methods.json");
  const validation = validateAssessment(record, registry, schema, catalog, methods);
  if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
  return { registry, catalog, validation };
}

function renderOutputs(rawPresentation, options) {
  const { presentation, manifest } = applyReportVisibility(rawPresentation, {
    visibility: options.visibility,
    reviewerDisclosure: options.reviewerDisclosure
  });
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
  if (options.output) written.output = writeNewText(path.resolve(options.output), rendered.report, { beforeWrite });
  if (options.appendix) written.appendix = writeNewText(path.resolve(options.appendix), rendered.appendix, { beforeWrite });
  if (options.redactionManifest) {
    written.redaction_manifest = writeNewJson(path.resolve(options.redactionManifest), rendered.manifest, { beforeWrite });
  }
  return written;
}

function renderStandalone(options) {
  const snapshot = readStableFile(path.resolve(options.input), { label: "standalone assessment" });
  const record = parseSnapshotJson(snapshot, "standalone assessment");
  const { registry, catalog, validation } = validateStandalone(record);
  const rawPresentation = buildStandalonePresentation({
    record,
    validation,
    registry,
    catalog,
    locale: options.locale
  });
  const rendered = renderOutputs(rawPresentation, options);
  const written = writeRequestedOutputs(options, rendered, () => assertStableFile(snapshot, "standalone assessment"));
  if (!options.output) {
    assertStableFile(snapshot, "standalone assessment");
    process.stdout.write(rendered.report);
  }
  return {
    status: "PASS",
    input: snapshot.path,
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
  if (run.schema_version !== currentRunVersion) {
    throw new Error(`Run-backed reporting requires the current audit-run schema_version ${currentRunVersion}.`);
  }
  const validation = validateAssessment(
    assessment,
    runValidation.resources.standardsRegistry,
    runValidation.resources.assessmentSchema,
    runValidation.resources.criteriaCatalog,
    runValidation.resources.auditMethods
  );
  if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
  validateRunBackedAssessment({
    run,
    assessment,
    envelopesById: runValidation.envelopesById,
    resources: runValidation.resources
  });
  const publicModel = buildPublicReportModel({
    run,
    assessment,
    envelopesById: runValidation.envelopesById,
    resources: runValidation.resources
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
  const artifactSnapshots = [...runValidation.envelopesById.values()]
    .map((record) => record.snapshot)
    .filter(Boolean);
  const assertInputsStable = () => {
    assertStableFile(runSnapshot, "audit run");
    assertStableFile(assessmentSnapshot, "run-backed assessment");
    for (const snapshot of artifactSnapshots) assertStableFile(snapshot, "registered artifact");
  };
  const written = writeRequestedOutputs(options, rendered, assertInputsStable);
  return {
    status: "PASS",
    run: runSnapshot.path,
    assessment: assessmentSnapshot.path,
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
