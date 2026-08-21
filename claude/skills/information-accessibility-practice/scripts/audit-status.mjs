import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readStableFile, validateAuditRun } from "./lib/audit-run.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);

function parseJsonSnapshot(snapshot, label) {
  try {
    return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function artifactSummary(artifact) {
  return {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    producer_role: artifact.producer_role,
    validation_status: artifact.validation_status,
    created_at: artifact.created_at,
    path: artifact.path
  };
}

export function buildAuditStatus(run, validation) {
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts.map(artifactSummary) : [];
  const artifactTypes = new Set(artifacts
    .filter((artifact) => artifact.validation_status === "valid")
    .map((artifact) => artifact.artifact_type));
  const transitions = (validation.resources?.orchestrationRegistry?.transitions ?? [])
    .filter((transition) => transition.from === run.status)
    .map((transition) => {
      const required = [...transition.required_artifact_types];
      const missing = required.filter((type) => !artifactTypes.has(type));
      return {
        from: transition.from,
        to: transition.to,
        required_artifact_types: required,
        missing_artifact_types: missing,
        ready: missing.length === 0
      };
    });
  const currentSchemaVersion = validation.resources?.auditRunSchema?.properties?.schema_version?.const ?? null;
  const currentSchema = run.schema_version === currentSchemaVersion;
  const warnings = [];
  if (!currentSchema) warnings.push(`Run schema ${run.schema_version} is read-only; current operational schema is ${currentSchemaVersion}.`);
  if (run.supersedes_run_id) warnings.push(`This run supersedes ${run.supersedes_run_id}; confirm that this is the latest file in the chain before registering new artifacts.`);
  if (run.status === "initialized" && artifacts.length === 0) warnings.push("No audit artifacts are registered yet. The next expected artifact is screening-observations.");
  if (!validation.valid) warnings.push("The run is invalid. Do not register, merge, or report until the validation errors are resolved.");

  return {
    valid: validation.valid,
    errors: [...(validation.errors ?? [])],
    warnings,
    run: {
      run_id: run.run_id,
      schema_version: run.schema_version,
      current_schema_version: currentSchemaVersion,
      current_schema: currentSchema,
      status: run.status,
      supersedes_run_id: run.supersedes_run_id,
      target: run.target,
      profile: run.profile,
      permissions: run.permissions,
      artifact_root: run.artifact_root
    },
    artifacts,
    transitions,
    next_ready_transitions: transitions.filter((transition) => transition.ready).map((transition) => transition.to),
    next_blocked_transitions: transitions.filter((transition) => !transition.ready).map((transition) => ({
      to: transition.to,
      missing_artifact_types: transition.missing_artifact_types
    })),
    operations: {
      register_artifact: validation.valid && currentSchema,
      merge: validation.valid && currentSchema && artifacts.length > 0,
      report: "Requires this valid current run plus a separately validated merged assessment.",
      retest: validation.valid && currentSchema && run.status === "retest_required"
    }
  };
}

function renderText(status) {
  const lines = [
    `Run: ${status.run.run_id}`,
    `Schema: ${status.run.schema_version}${status.run.current_schema ? " (current)" : ` (current: ${status.run.current_schema_version})`}`,
    `State: ${status.run.status}`,
    `Profile: ${status.run.profile.id} @ ${status.run.profile.registry_version}`,
    `Target: ${status.run.target.name} (${status.run.target.version_or_commit})`,
    `Validation: ${status.valid ? "PASS" : "FAIL"}`,
    "",
    "Registered artifacts:"
  ];
  if (status.artifacts.length === 0) lines.push("- none");
  else {
    for (const artifact of status.artifacts) {
      lines.push(`- ${artifact.artifact_type}: ${artifact.artifact_id} [${artifact.validation_status}] by ${artifact.producer_role}`);
    }
  }
  lines.push("", "Next transitions:");
  if (status.transitions.length === 0) lines.push("- none registered for the current state");
  else {
    for (const transition of status.transitions) {
      lines.push(`- ${transition.from} -> ${transition.to}: ${transition.ready ? "ready" : `blocked; missing ${transition.missing_artifact_types.join(", ")}`}`);
    }
  }
  if (status.errors.length) lines.push("", "Errors:", ...status.errors.map((error) => `- ${error}`));
  if (status.warnings.length) lines.push("", "Warnings:", ...status.warnings.map((warning) => `- ${warning}`));
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { format: "text" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (!["--run", "--format"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  if (!["text", "json"].includes(options.format)) throw new Error("--format must be text or json");
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: node scripts/audit-status.mjs --run <audit-run.json> [--format text|json]\n");
    return 0;
  }
  if (!options.run) throw new Error("--run is required");
  const snapshot = readStableFile(path.resolve(options.run), { label: "audit run" });
  const run = parseJsonSnapshot(snapshot, "audit run");
  const validation = validateAuditRun(run, { skillRoot, runFile: snapshot.path });
  const status = buildAuditStatus(run, validation);
  process.stdout.write(options.format === "json" ? `${JSON.stringify(status, null, 2)}\n` : renderText(status));
  return status.valid ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
