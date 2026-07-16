import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateAssessment } from "./validate-assessment.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);
const outcomes = ["pass", "fail", "not_applicable", "not_tested", "cant_tell"];
const priorityOrder = ["P0", "P1", "P2"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readReference(relativePath) {
  return readJson(path.join(skillRoot, "references", relativePath));
}

function cell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]()#+!])/g, "\\$1")
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function list(values) {
  return values?.length ? values.map((value) => `- ${cell(value)}`).join("\n") : "- None recorded.";
}

function count(counts, outcome) {
  return counts?.[outcome] ?? 0;
}

function outcomeRows(profileCounts, screeningCounts) {
  return outcomes.map((outcome) => `| ${cell(outcome)} | ${count(profileCounts, outcome)} | ${count(screeningCounts, outcome)} |`).join("\n");
}

function groupRows(groups, groupCounts) {
  return outcomes.map((outcome) => `| ${cell(outcome)} | ${groups.map((group) => count(groupCounts?.[group.id], outcome)).join(" | ")} |`).join("\n");
}

function findingTable(findings) {
  if (findings.length === 0) return "No structured findings were recorded.";
  return [
    "| ID | Requirement IDs | Location | Affected users | Observation | Remediation | Verification |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map((finding) => [
      finding.id,
      finding.requirement_ids.join(", "),
      finding.location,
      finding.affected_users.join(", "),
      finding.observation,
      finding.remediation,
      finding.verification
    ].map(cell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  ].join("\n");
}

export function renderAuditReport(record, validation) {
  if (!validation?.valid) throw new Error("Assessment record must pass validation before a report can be rendered.");
  const assessment = record.assessment;
  const guard = validation.guard;
  const profileCounts = guard.profile_outcome_counts;
  const findings = Array.isArray(assessment.findings) ? assessment.findings : [];
  const orderedFindings = priorityOrder.map((priority) => [priority, findings.filter((finding) => finding.priority === priority)]);
  const unlinkedFailures = assessment.results
    .filter((result) => result.outcome === "fail" && !findings.some((finding) => finding.requirement_ids.includes(result.requirement_id)))
    .map((result) => result.requirement_id);
  if (unlinkedFailures.length > 0) {
    throw new Error(`Assessment record has failed results without structured findings: ${unlinkedFailures.join(", ")}`);
  }

  const lines = [
    "# Accessibility Audit Report",
    "",
    "> Status: generated from a validated assessment record.",
    "> This report applies only to the recorded target, version, scope, environment, and date. It is not a certification or conformance determination.",
    "",
    "## 1. Audit Identity",
    "",
    `- Target: ${cell(assessment.target.name)}`,
    `- Version / commit: ${cell(assessment.target.version_or_commit)}`,
    `- URLs / files: ${cell(assessment.target.urls_or_files.length ? assessment.target.urls_or_files.join(", ") : "Not recorded")}`,
    `- Audit profile: ${assessment.profile.id}`,
    `- Audit date: ${assessment.evaluated_at}`,
    `- Evaluator: ${cell(assessment.evaluator)}`,
    `- Evidence level: ${assessment.evidence_level}`,
    "",
    "## 2. Executive Summary",
    "",
    `- P0 findings: ${findings.filter((finding) => finding.priority === "P0").length}`,
    `- P1 findings: ${findings.filter((finding) => finding.priority === "P1").length}`,
    `- P2 findings: ${findings.filter((finding) => finding.priority === "P2").length}`,
    `- Failed profile requirements: ${count(profileCounts, "fail")}`,
    `- Untested profile requirements: ${count(profileCounts, "not_tested")}`,
    `- Indeterminate profile requirements: ${count(profileCounts, "cant_tell")}`,
    `- Highest claim tier allowed by the validator: ${guard.max_tier}`,
    "",
    "## 3. Scope",
    "",
    "### Included",
    "",
    list(assessment.scope.included),
    "",
    "### Excluded",
    "",
    list(assessment.scope.excluded),
    "",
    "### Complete User Processes",
    "",
    list(assessment.scope.complete_processes),
    "",
    "### Third-Party Content",
    "",
    list(assessment.scope.third_party_content),
    "",
    `- Full pages reviewed: ${assessment.scope.full_pages_reviewed ? "Yes" : "No"}`,
    "",
    "## 4. Test Environment",
    "",
    "| Layer | Recorded environment |",
    "| --- | --- |",
    `| OS | ${cell(assessment.environment.os.join(", ") || "Not recorded")} |`,
    `| Browser / renderer | ${cell(assessment.environment.browsers.join(", ") || "Not recorded")} |`,
    `| Assistive technology | ${cell(assessment.environment.assistive_technologies.join(", ") || "Not recorded")} |`,
    `| Input mode | ${cell(assessment.environment.input_modes.join(", ") || "Not recorded")} |`,
    "",
    "## 5. Method And Evidence Boundary",
    "",
    `- Human-verified profile requirements: ${guard.evaluation_coverage.human_verified} of ${guard.catalog_coverage.expected}`,
    "- Automated and screening checks are supporting evidence only; they do not determine profile requirement outcomes.",
    "- Catalog coverage and evaluation coverage are reported separately below.",
    "",
    "## 6. Findings",
    ""
  ];

  for (const [priority, priorityFindings] of orderedFindings) {
    lines.push(`### ${priority}`, "", findingTable(priorityFindings), "");
  }
  lines.push(
    "## 7. Profile Coverage",
    "",
    "| Result | Registered profile requirements | Supporting screening checks |",
    "| --- | ---: | ---: |",
    outcomeRows(profileCounts, guard.screening_outcome_counts),
    "",
    `- Catalog coverage: ${guard.catalog_coverage.recorded} of ${guard.catalog_coverage.expected}; complete: ${guard.catalog_coverage.complete ? "yes" : "no"}.`,
    `- Evaluation coverage: ${guard.evaluation_coverage.human_verified} human-verified; complete: ${guard.evaluation_coverage.complete ? "yes" : "no"}.`,
    ""
  );

  const reportGroups = guard.report_groups ?? [];
  if (reportGroups.length > 1) {
    lines.push(
      "### Profile Requirement Groups",
      "",
      `| Result | ${reportGroups.map((group) => cell(group.label)).join(" | ")} |`,
      `| --- | ${reportGroups.map(() => "---:").join(" | ")} |`,
      groupRows(reportGroups, guard.profile_group_outcome_counts),
      ""
    );
  }

  lines.push(
    "## 8. Participation Coverage",
    "",
    "| Gate | Result |",
    "| --- | --- |",
    ...["find", "receive", "understand", "participate", "continue"].map((gate) => `| ${gate} | ${assessment.participation_coverage[gate]} |`),
    "",
    "## 9. Limitations And Residual Risk",
    "",
    list(assessment.limitations),
    "- Results do not extend beyond the recorded target version and scope.",
    "",
    "## 10. Remediation And Retest",
    "",
    findings.length ? "Use each finding's remediation and verification field as the retest plan." : "- No structured remediation items were recorded.",
    assessment.next_review_at ? `- Next review date: ${assessment.next_review_at}` : "- Next review date: Not recorded.",
    "",
    "## 11. Claim Statement",
    "",
    `> ${assessment.claim.proposed_wording}`,
    "",
    `- Requested tier: ${assessment.claim.requested_tier}`,
    `- Validator maximum tier: ${guard.max_tier}`,
    "- The claim statement is limited to the recorded evidence and does not declare conformance."
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (!["--input", "--output"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return "Usage: node scripts/render-audit-report.mjs --input <assessment.json> [--output <report.md>]";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.input) throw new Error("--input is required");
  const record = readJson(path.resolve(options.input));
  const validation = validateAssessment(
    record,
    readReference("standards-registry.json"),
    readReference("assessment-record.schema.json"),
    readReference("criteria-catalog.json"),
    readReference("web-audit-methods.json")
  );
  if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
  const report = renderAuditReport(record, validation);
  if (!options.output) {
    process.stdout.write(report);
    return;
  }
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing file: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, report, "utf8");
  console.log(JSON.stringify({ status: "PASS", input: path.resolve(options.input), output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
