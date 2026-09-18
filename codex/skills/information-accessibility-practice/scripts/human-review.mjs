import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { readStableFile, assertStableFile, writeNewJson, validateAuditRun, loadAuditResources } from "./lib/audit-run.mjs";
import { validateAssessment } from "./validate-assessment.mjs";
import { parseAttestationJson } from "./lib/attestation-canonical.mjs";
import { createAttestationTrust } from "./lib/attestation-verifier.mjs";
import { createHumanReviewRecord, humanReviewContext, humanReviewRunContext, verifyHumanReviewRecord } from "./lib/human-review-provenance.mjs";
import { applyStandaloneHumanReview } from "./lib/apply-human-review.mjs";

const flags = new Set(["--record", "--run", "--artifact-id", "--assessment", "--assessment-id", "--review", "--reviewer-id", "--output", "--trust-policy", "--trust-policy-sha256", "--minimum-assurance", "--claim-tier"]);
const assuranceOrder = ["self_declared", "self_signed", "signed", "organization_attested", "independent"];

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const [command, ...args] = argv;
  if (!["prepare", "verify", "apply"].includes(command)) throw new Error("Choose human-review prepare, verify, or apply; use --help for usage.");
  const options = { command };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flags.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (Object.hasOwn(options, flag)) throw new Error(`Duplicate argument: ${flag}`);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[flag] = value;
  }
  const runBacked = Boolean(options["--run"]);
  if (runBacked === Boolean(options["--assessment"])) throw new Error("Select exactly one context: --run or --assessment.");
  if (runBacked && (!options["--artifact-id"] || options["--assessment-id"] || options["--review"])) {
    throw new Error("Run mode requires --artifact-id and takes the declared review directly from the registered artifact.");
  }
  if (!runBacked && options["--artifact-id"]) throw new Error("--artifact-id is run-only.");
  if (options["--claim-tier"] && command !== "apply") throw new Error("--claim-tier is apply-only.");
  if (command === "prepare") {
    if (!options["--reviewer-id"] || !options["--output"] || (!runBacked && !options["--review"])) throw new Error("Prepare requires --reviewer-id, --output, and --review for standalone mode.");
    if (["--record", "--trust-policy", "--trust-policy-sha256", "--minimum-assurance"].some((flag) => options[flag])) throw new Error("Prepare creates an unsigned record; verification-only options are not accepted.");
  } else {
    if (!options["--record"]) throw new Error("Verify/apply requires --record.");
    if (options["--review"] || options["--reviewer-id"] || (command === "verify" && options["--output"])) throw new Error("Verify/apply does not accept prepare-only options; verify is read-only.");
    if (command === "apply" && (runBacked || !options["--output"])) throw new Error("Apply requires --assessment and --output; use merge-audit-artifacts for run-backed reviews.");
    if (Boolean(options["--trust-policy"]) !== Boolean(options["--trust-policy-sha256"])) throw new Error("External trust policy and its independently supplied SHA-256 pin must be provided together.");
    if (options["--minimum-assurance"] && !assuranceOrder.includes(options["--minimum-assurance"])) throw new Error("Invalid --minimum-assurance.");
  }
  return options;
}

export function humanReviewUsage() {
  return [
    "Portable human review provenance (offline; no keys are created and no data is sent):",
    "  node scripts/human-review.mjs prepare --run <run.json> --artifact-id <id> --reviewer-id <id> --output <new-private-record.json>",
    "  node scripts/human-review.mjs prepare --assessment <assessment.json> --review <declared-review.json> --reviewer-id <id> --output <new-private-record.json>",
    "  node scripts/human-review.mjs verify --record <record.json> --run <run.json> --artifact-id <id> [trust options]",
    "  node scripts/human-review.mjs verify --record <record.json> --assessment <assessment.json> [trust options]",
    "  node scripts/human-review.mjs apply --record <record.json> --assessment <assessment.json> --output <new-assessment.json> [--claim-tier evaluated_subset] [trust options]",
    "Standalone schema 2 uses its stored assessment_id; --assessment-id must match it if supplied. Legacy schema 1 requires an explicit --assessment-id and cannot be changed by apply.",
    "Trust options: --trust-policy <recipient-selected.json> --trust-policy-sha256 <independently trusted canonical SHA-256>",
    "Optional: --minimum-assurance <self_declared|self_signed|signed|organization_attested|independent>",
    "The policy and pin must be selected outside the submitted review/audit bundle. A self-signed key never authenticates a reviewer.",
    "Verify checks reviewer provenance only. Apply binds the declared results to an assessment, without proving review correctness or verifying a final audit bundle."
  ].join("\n");
}

export function runHumanReviewCommand(argv) {
  const options = parseArgs(argv);
  if (options.help) return { help: humanReviewUsage() };
  const snapshots = [];
  function read(file, label) {
    const snapshot = readStableFile(path.resolve(file), { label, maxBytes: 8 * 1024 * 1024 });
    snapshots.push(snapshot);
    // Preserve the strict bytes parser while interoperating with the existing
    // schema/runtime checks, which compare ordinary JSON object prototypes.
    return { snapshot, value: structuredClone(parseAttestationJson(snapshot.bytes)) };
  }
  const trust = options["--trust-policy"] ? createAttestationTrust(read(options["--trust-policy"], "external trust policy").value, options["--trust-policy-sha256"]) : undefined;
  let context, sourceArtifactBytes, review, standaloneAssessment, resources;
  if (options["--run"]) {
    const { snapshot, value: run } = read(options["--run"], "audit run");
    const validation = validateAuditRun(run, { runFile: snapshot.path });
    if (!validation.valid) throw new Error(`Audit run validation failed:\n- ${validation.errors.join("\n- ")}`);
    if (run.schema_version !== validation.resources.auditRunSchema.properties.schema_version.const) throw new Error("Review provenance requires the current run contract; legacy runs remain read-only.");
    const source = validation.envelopesById.get(options["--artifact-id"]);
    if (!source || source.envelope.artifact_type !== "declared-human-review") throw new Error("--artifact-id must select a registered declared-human-review in the supplied run.");
    // Every registered artifact must have an unambiguous JSON representation.
    for (const entry of validation.envelopesById.values()) { parseAttestationJson(entry.snapshot.bytes); snapshots.push(entry.snapshot); }
    snapshots.push(...validation.evidenceSnapshots.values());
    context = humanReviewRunContext({ run, artifact: source.envelope, artifactSha256: source.snapshot.sha256 });
    sourceArtifactBytes = source.snapshot.bytes;
    review = source.envelope.payload;
  } else {
    const { value: record } = read(options["--assessment"], "assessment");
    resources = loadAuditResources();
    standaloneAssessment = record;
    const validation = validateAssessment(record, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods, { trust });
    if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
    const storedId = record.assessment.assessment_id, suppliedId = options["--assessment-id"];
    if (storedId && suppliedId && storedId !== suppliedId) throw new Error("--assessment-id differs from the stored assessment identity.");
    if (!storedId && !suppliedId) throw new Error("Legacy standalone mode requires --assessment-id.");
    context = humanReviewContext({ assessmentId: storedId ?? suppliedId, assessment: record.assessment });
    if (options.command === "prepare") review = read(options["--review"], "declared human review").value;
  }
  const assertInputsStable = () => { for (const snapshot of snapshots) assertStableFile(snapshot, "review verification input"); };
  if (options.command === "prepare") {
    const record = createHumanReviewRecord({ reviewerId: options["--reviewer-id"], review, context });
    verifyHumanReviewRecord({ record, expectedContext: context, sourceArtifactBytes });
    writeNewJson(path.resolve(options["--output"]), record, { beforeWrite: assertInputsStable });
    return { status: "prepared", assurance: "self_declared", reviewer_identity_authenticated: false, private_record_created: true };
  }
  const { value: record } = read(options["--record"], "human review record");
  const verification = verifyHumanReviewRecord({ record, expectedContext: context, sourceArtifactBytes, trust });
  const minimum = options["--minimum-assurance"] ?? "self_declared";
  if (assuranceOrder.indexOf(verification.assurance) < assuranceOrder.indexOf(minimum)) throw new Error(`Review assurance ${verification.assurance} does not meet the explicitly requested minimum ${minimum}.`);
  if (options.command === "apply") {
    const merged = applyStandaloneHumanReview({ assessment: standaloneAssessment, reviewRecord: record, resources, trust, claimTier: options["--claim-tier"] });
    writeNewJson(path.resolve(options["--output"]), merged, { beforeWrite: assertInputsStable });
    return { status: "applied", ...verification, minimum_assurance: minimum, assessment_result_binding_verified: true, final_bundle_verified: false };
  }
  assertInputsStable();
  return { status: "PASS", ...verification, minimum_assurance: minimum, assessment_result_binding_verified: false, final_bundle_verified: false };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = runHumanReviewCommand(process.argv.slice(2));
    process.stdout.write(result.help ? `${result.help}\n` : `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
