#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertStableFile,
  readStableFile,
  validateAuditRun,
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

function parseArgs(argv) {
  const options = { locale: "ja" };
  const supported = new Map([
    ["--input", "input"],
    ["--run", "run"],
    ["--assessment", "assessment"],
    ["--output", "output"],
    ["--locale", "locale"]
  ]);
  let localeSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const key = supported.get(arg);
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (key === "locale") {
      if (localeSeen) throw new Error("Duplicate argument: --locale");
      localeSeen = true;
    } else if (options[key] !== undefined) {
      throw new Error(`Duplicate argument: ${arg}`);
    }
    options[key] = value;
    index += 1;
  }
  options.locale = normalizeReportLocale(options.locale);
  return options;
}

export function usage() {
  return [
    "Usage:",
    "  accessibility-audit report --input <assessment.json> [--locale ja|en] [--output <new-report.md>]",
    "  accessibility-audit report --run <audit-run.json> --assessment <assessment.json> --output <new-report.md> [--locale ja|en]",
    "",
    "Interfaces:",
    "  --input        Render a validated standalone assessment.",
    "  --run          Render a current run-backed assessment with registered artifact provenance.",
    "  --assessment   Assessment bound to the supplied run.",
    "  --locale       Human-readable report locale. Allowed: ja, en. Default: ja.",
    "  --output       New Markdown output. Existing files are never overwritten.",
    "",
    "The report does not modify the audited target and does not convert AI screening into a human-verified profile outcome."
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

function renderStandalone(options) {
  const snapshot = readStableFile(path.resolve(options.input), { label: "standalone assessment" });
  const record = parseSnapshotJson(snapshot, "standalone assessment");
  const { registry, catalog, validation } = validateStandalone(record);
  const presentation = buildStandalonePresentation({
    record,
    validation,
    registry,
    catalog,
    locale: options.locale
  });
  const report = renderReportMarkdown(presentation);
  if (!options.output) {
    assertStableFile(snapshot, "standalone assessment");
    process.stdout.write(report);
    return { status: "PASS", input: snapshot.path, output: null };
  }
  const output = writeNewText(path.resolve(options.output), report, {
    beforeWrite() {
      assertStableFile(snapshot, "standalone assessment");
    }
  });
  return { status: "PASS", input: snapshot.path, output };
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
  const presentation = buildRunBackedPresentation({
    run,
    assessment,
    validation,
    publicModel,
    registry: runValidation.resources.standardsRegistry,
    catalog: runValidation.resources.criteriaCatalog,
    locale: options.locale
  });
  const report = renderReportMarkdown(presentation);
  const artifactSnapshots = [...runValidation.envelopesById.values()]
    .map((record) => record.snapshot)
    .filter(Boolean);
  const output = writeNewText(path.resolve(options.output), report, {
    beforeWrite() {
      assertStableFile(runSnapshot, "audit run");
      assertStableFile(assessmentSnapshot, "run-backed assessment");
      for (const snapshot of artifactSnapshots) assertStableFile(snapshot, "registered artifact");
    }
  });
  return { status: "PASS", run: runSnapshot.path, assessment: assessmentSnapshot.path, output };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const runBacked = Boolean(options.run || options.assessment);
  if (options.input && runBacked) throw new Error("Use either --input or the --run/--assessment interface, not both.");
  if (!options.input && !runBacked) throw new Error("--input or --run/--assessment is required.");
  let result;
  if (runBacked) {
    if (!options.run || !options.assessment || !options.output) {
      throw new Error("--run, --assessment, and --output are required for a run-backed report.");
    }
    result = renderRunBacked(options);
  } else {
    result = renderStandalone(options);
  }
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
