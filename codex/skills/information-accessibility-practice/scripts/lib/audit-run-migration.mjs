import crypto from "node:crypto";

export const supportedAuditRunVersions = Object.freeze(["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0", "6.0.0"]);
export const currentAuditRunVersion = "6.0.0";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sourceHash(run) {
  return crypto.createHash("sha256").update(`${JSON.stringify(canonical(run))}\n`).digest("hex");
}

function conservativeCandidate(run) {
  const candidate = structuredClone(run);
  candidate.schema_version = currentAuditRunVersion;
  candidate.scope ??= { included: candidate.target?.urls_or_files ?? [], excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false };
  candidate.environment ??= { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] };
  candidate.artifacts ??= [];
  candidate.history ??= [];
  candidate.limitations ??= ["Migrated from a legacy audit run; original runtime resources must be consulted before re-reporting."];
  if (candidate.claim?.requested_tier && !["reference_only", "screened", "evaluated_subset"].includes(candidate.claim.requested_tier)) {
    candidate.claim.requested_tier = "reference_only";
  }
  return candidate;
}

export function planAuditRunMigration(run, { migratedAt = null } = {}) {
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new Error("audit run must be an object");
  if (!supportedAuditRunVersions.includes(run.schema_version)) {
    throw new Error(`Unsupported audit-run schema: ${String(run.schema_version)}`);
  }
  const noOp = run.schema_version === currentAuditRunVersion;
  const candidate = noOp ? structuredClone(run) : conservativeCandidate(run);
  return {
    record: {
      schema_version: "1.0.0",
      mode: noOp ? "no_op" : "migration_candidate",
      source_run_id: run.run_id ?? null,
      source_schema_version: run.schema_version,
      target_schema_version: currentAuditRunVersion,
      source_sha256: sourceHash(run),
      migrated_at: migratedAt,
      claim_policy: "preserve_or_lower",
      source_immutability: "source_run_not_modified",
      warnings: noOp ? [] : [
        "The candidate is not a validated current run until current schemas and recorded historical resources are checked.",
        "No historical evidence or claim tier is upgraded by migration."
      ]
    },
    candidate
  };
}
