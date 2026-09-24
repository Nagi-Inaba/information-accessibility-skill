#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertStableFile, writeNewJson } from "./lib/audit-run.mjs";
import { readReviewJson, loadReviewTrust } from "./lib/review-trust-input.mjs";
import { prepareAuditBundle, verifyAuditBundle, verifyAuditBundleChain, bundleAssuranceOrder } from "./lib/audit-bundle.mjs";

const repeatable = new Set(["--report", "--attachment", "--predecessor"]);
const flags = new Set(["--root", "--run", "--assessment", "--output", "--bundle-id", "--record", "--trust-policy", "--trust-policy-sha256", "--minimum-assurance", "--expected-subject-sha256", ...repeatable]);
function parseArgs(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) return { help: true };
  const [command, ...args] = argv;
  if (!["prepare", "verify"].includes(command)) throw new Error("Choose audit-bundle prepare or verify; use --help for usage.");
  const options = { command, "--report": [], "--attachment": [], "--predecessor": [] };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--require-complete-chain") {
      if (options[flag]) throw new Error(`Duplicate argument: ${flag}`);
      options[flag] = true; continue;
    }
    if (!flags.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (repeatable.has(flag)) options[flag].push(value);
    else {
      if (Object.hasOwn(options, flag)) throw new Error(`Duplicate argument: ${flag}`);
      options[flag] = value;
    }
  }
  if (!options["--root"]) throw new Error("An explicit --root bundle directory is required.");
  if (command === "prepare") {
    if (!["--run", "--assessment", "--output"].every((flag) => options[flag]) || !options["--report"].length) throw new Error("Prepare requires --run, --assessment, at least one --report and a new --output.");
    if (["--record", "--minimum-assurance", "--expected-subject-sha256"].some((flag) => options[flag])) throw new Error("Verify-only options are not accepted by prepare.");
  } else {
    if (!options["--record"]) throw new Error("Verify requires --record.");
    if (["--run", "--assessment", "--output", "--bundle-id"].some((flag) => options[flag]) || options["--report"].length || options["--attachment"].length) throw new Error("Verify reads the signed manifest; prepare-only options are not accepted.");
    if (options["--minimum-assurance"] && !bundleAssuranceOrder.includes(options["--minimum-assurance"])) throw new Error("Invalid --minimum-assurance.");
  }
  return options;
}
export function auditBundleUsage() {
  return [
    "Offline audit bundle commitments; no signing keys, network requests or transparency uploads:",
    "  node scripts/audit-bundle.mjs prepare --root <directory> --run <run.json> --assessment <assessment.json> --report <report.md|html> --output <new-private-record.json>",
    "  node scripts/audit-bundle.mjs verify --root <directory> --record <private-record.json> [trust options]",
    "Prepare: repeat --report (1–16) and --attachment for explicitly retained source/capture files; --bundle-id is optional.",
    "All committed files must be inside --root; CLI paths resolve from the working directory. Files are never copied or overwritten.",
    "Repeat --predecessor for signed earlier records. For prepare, list the immediate predecessor first; provide all links it commits.",
    "Use --require-complete-chain to reject bootstrap records that supersede unsigned history.",
    "Trust: --trust-policy <recipient-selected.json> --trust-policy-sha256 <independently trusted canonical SHA-256>.",
    "Verify: --minimum-assurance <unsigned|self_signed|signed|organization_attested|independent> applies to every chain link.",
    "Verify: --expected-subject-sha256 <independently selected current bundle digest> detects replacement with an older valid bundle.",
    "Historical signatures commit earlier file hashes; historical file bytes are not checked. Signer-claimed dates are not trusted timestamps.",
    "Only the listed file set is covered. Unlisted target files and report correctness are not verified, and no conformance tier is elevated."
  ].join("\n");
}

export function runAuditBundleCommand(argv) {
  const options = parseArgs(argv);
  if (options.help) return { help: auditBundleUsage() };
  const { trust, snapshots } = loadReviewTrust({ trustPolicy: options["--trust-policy"], trustPolicySha256: options["--trust-policy-sha256"] });
  const readRecord = (file) => { const read = readReviewJson(file, "private audit bundle record"); snapshots.push(read.snapshot); return read.value; };
  const predecessors = options["--predecessor"].map(readRecord);
  const chainOptions = { trust, requireCompleteChain: options["--require-complete-chain"] ?? false,
    minimumAssurance: options["--minimum-assurance"] ?? "unsigned", expectedSubjectSha256: options["--expected-subject-sha256"] };
  const assertInputsStable = () => { for (const snapshot of snapshots) assertStableFile(snapshot, "bundle record or external trust policy"); };
  if (options.command === "prepare") {
    const prepared = prepareAuditBundle({ root: path.resolve(options["--root"]), runFile: path.resolve(options["--run"]),
      assessmentFile: path.resolve(options["--assessment"]), reports: options["--report"].map((file) => path.resolve(file)),
      attachments: options["--attachment"].map((file) => path.resolve(file)), bundleId: options["--bundle-id"] ?? `BUNDLE-${crypto.randomUUID()}`,
      predecessor: predecessors[0] ?? null, reviewTrust: trust });
    const verification = verifyAuditBundleChain(prepared.record, predecessors, chainOptions);
    writeNewJson(path.resolve(options["--output"]), prepared.record, { beforeWrite() { assertInputsStable(); prepared.assertStable(); } });
    return { status: "prepared", ...verification, private_record_created: true, current_file_bytes_verified: true,
      verified_file_count: prepared.record.manifest.files.length, coverage: prepared.record.manifest.coverage,
      entire_target_archive_verified: false, report_semantics_verified: false };
  }
  const record = readRecord(options["--record"]);
  const result = verifyAuditBundle({ root: path.resolve(options["--root"]), record, predecessors, reviewTrust: trust, ...chainOptions });
  assertInputsStable();
  return { status: "PASS", ...result, minimum_assurance: chainOptions.minimumAssurance };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = runAuditBundleCommand(process.argv.slice(2));
    process.stdout.write(result.help ? `${result.help}\n` : `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  }
}
