import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertNewOutputPath, assertStableFile, readStableFile, validateAuditRun, writeNewBytes, validateHumanReviewCandidate } from "./lib/audit-run.mjs";
import { parseAttestationJson } from "./lib/attestation-canonical.mjs";
import { worksheetItems, createWorksheetRows, encodeCsv, decodeCsv, encodeMarkdown, decodeMarkdown, reviewFromWorksheet, worksheetLimit } from "./lib/human-review-worksheet.mjs";
import { compareInstants } from "./lib/date-time.mjs";

function optionsFrom(argv) {
  const [command, ...args] = argv;
  const options = { command };
  const flags = command === "export" ? ["run", "queue", "output", "format"] : ["run", "queue", "input", "output", "format", "artifact-id"];
  if (!["export", "import"].includes(command)) throw new Error("Choose human-review export or import.");
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], key = flag.replace(/^--/u, ""), value = args[index + 1];
    if (flag !== `--${key}` || !flags.includes(key)) throw new Error(`Unknown argument: ${flag}`);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate argument: ${flag}`);
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[key] = value;
  }
  for (const key of ["run", "queue", "output", ...(command === "export" ? ["format"] : ["input"])]) if (!options[key]) throw new Error(`--${key} is required.`);
  if (!options.format) options.format = ({ ".xlsx": "xlsx", ".csv": "csv", ".md": "markdown" })[path.extname(options.input).toLowerCase()];
  if (!["xlsx", "csv", "markdown"].includes(options.format)) throw new Error("--format must be xlsx, csv or markdown (or use .xlsx, .csv, .md input extension).");
  return options;
}

export async function runWorksheetCommand(argv) {
  const options = optionsFrom(argv);
  const snapshot = readStableFile(path.resolve(options.run), { maxBytes: worksheetLimit, label: "audit run" });
  const run = structuredClone(parseAttestationJson(snapshot.bytes));
  const validation = validateAuditRun(run, { runFile: snapshot.path });
  if (!validation.valid) throw new Error(`Audit run validation failed:\n- ${validation.errors.join("\n- ")}`);
  if (run.schema_version !== "11.0.0") throw new Error("Worksheets require current run 11.0.0; legacy runs remain read-only.");
  if (!["human_queue_ready", "human_review_recorded"].includes(run.status)) throw new Error("Worksheets require a registered queue before remediation planning.");
  for (const entry of validation.envelopesById.values()) parseAttestationJson(entry.snapshot.bytes);
  const selected = validation.envelopesById.get(options.queue);
  if (!selected || selected.envelope.artifact_type !== "human-review-queue") throw new Error("--queue must be the ID of a registered human-review-queue in this run.");
  const queue = selected.envelope;
  const items = worksheetItems(run, queue, validation.envelopesById);
  const expected = createWorksheetRows({ run, runSha256: snapshot.sha256, queue, queueSha256: selected.snapshot.sha256, items, skillRoot: validation.resources.skillRoot });
  const output = path.resolve(options.output);
  const relative = path.relative(validation.artifactRoot, output);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) throw new Error("Worksheet and artifact outputs must be within the private artifact root.");
  assertNewOutputPath(output);
  const inputs = [snapshot, ...[...validation.envelopesById.values()].map((entry) => entry.snapshot), ...validation.evidenceSnapshots.values()];
  const assertInputs = () => { for (const input of inputs) assertStableFile(input, "worksheet input"); };
  if (options.command === "export") {
    const bytes = options.format === "xlsx" ? await (await import("./lib/human-review-xlsx.mjs")).encodeXlsx(expected)
      : Buffer.from(options.format === "csv" ? encodeCsv(expected) : encodeMarkdown(expected), "utf8");
    if (bytes.length > worksheetLimit) throw new Error("Export exceeds the worksheet size limit.");
    writeNewBytes(output, bytes, { beforeWrite: assertInputs });
    return { status: "exported", format: options.format, requirements: items.length, output, run_changed: false };
  }
  const input = readStableFile(path.resolve(options.input), { maxBytes: worksheetLimit, label: "completed worksheet" }); inputs.push(input);
  const text = () => new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  const rows = options.format === "xlsx" ? await (await import("./lib/human-review-xlsx.mjs")).decodeXlsx(input.bytes)
    : options.format === "csv" ? decodeCsv(text()) : decodeMarkdown(text());
  const artifactId = options["artifact-id"] ?? `ART-HUMAN-${randomUUID().toUpperCase()}`;
  if (run.artifacts.some((entry) => entry.artifact_id === artifactId)) throw new Error("Artifact ID is already registered.");
  const now = new Date().toISOString();
  if (compareInstants(now, run.history.at(-1).at) < 0) throw new Error("System time precedes the current run state.");
  const artifact = { schema_version: "3.0.0", artifact_id: artifactId, artifact_type: "declared-human-review", run_id: run.run_id,
    target_snapshot_ids: [...queue.target_snapshot_ids], producer: { role_id: "declared_external_human", producer_kind: "external_human", origin: "Human-completed worksheet imported by accessibility-audit (self-declared; identity not authenticated)" },
    created_at: now, inputs: [{ artifact_id: queue.artifact_id, run_id: run.run_id, sha256: selected.snapshot.sha256 }],
    payload: reviewFromWorksheet({ rows, expected, items, artifactId, now }) };
  const checked = validateHumanReviewCandidate(run, artifact, validation);
  if (!checked.valid) throw new Error(checked.errors.join("\n"));
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  writeNewBytes(output, bytes, { beforeWrite: assertInputs });
  return { status: "candidate", artifact_id: artifactId, reviews: artifact.payload.reviews.length, unsubmitted: items.length - artifact.payload.reviews.length,
    output, reviewer_identity_authenticated: false, run_changed: false };
}
