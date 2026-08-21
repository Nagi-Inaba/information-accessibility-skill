import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readStableFile, writeNewText } from "./lib/audit-run.mjs";

const retainedSectionPatterns = [
  /総合判定/u,
  /検査対象/u,
  /指摘事項/u,
  /改善事項/u,
  /判定件数/u,
  /記録の範囲/u,
  /制約と残る確認事項/u,
  /改善と再確認/u,
  /対象範囲と検査環境/u
];

export function summarizeAuditReport(fullReport) {
  if (typeof fullReport !== "string" || fullReport.trim().length === 0) {
    throw new Error("A non-empty full audit report is required.");
  }
  const sections = fullReport.split(/\n(?=##\s)/u);
  const preamble = sections.shift() ?? "";
  const retained = sections.filter((section) => {
    const heading = section.split(/\r?\n/u, 1)[0];
    return retainedSectionPatterns.some((pattern) => pattern.test(heading));
  });
  if (!retained.some((section) => /^##\s+1\.\s*総合判定/mu.test(section))) {
    throw new Error("The input does not contain the expected overall judgement section.");
  }
  return `${[
    preamble.trimEnd(),
    "> 要約版：主要な判定、指摘、改善、対象範囲、記録範囲だけを表示しています。全達成基準、適用対象外理由、個別証拠は完全版レポートを参照してください。",
    ...retained.map((section) => section.trimEnd())
  ].join("\n\n").trimEnd()}\n`;
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

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: node scripts/summarize-audit-report.mjs --input <full-report.md> [--output <new-summary.md>]\n");
    return 0;
  }
  if (!options.input) throw new Error("--input is required");
  const snapshot = readStableFile(path.resolve(options.input), { label: "full audit report" });
  const summary = summarizeAuditReport(snapshot.bytes.toString("utf8"));
  if (!options.output) {
    process.stdout.write(summary);
    return 0;
  }
  const output = writeNewText(path.resolve(options.output), summary, {
    beforeWrite() {
      const current = readStableFile(snapshot.path, { label: "full audit report" });
      if (current.sha256 !== snapshot.sha256) throw new Error("Full audit report changed before summary output.");
    }
  });
  process.stdout.write(`${JSON.stringify({ status: "PASS", summary: output })}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
