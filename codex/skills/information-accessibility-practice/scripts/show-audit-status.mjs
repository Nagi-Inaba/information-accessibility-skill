import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { generateAssessment } from "./generate-assessment.mjs";
import { validateAssessment } from "./validate-assessment.mjs";
import { validateRunBackedAssessment } from "./render-audit-report.mjs";
import { networkScopeSummary } from "./lib/network-policy.mjs";
import { interactionScopeSummary } from "./lib/interaction-policy.mjs";
import { findingRelations, findingRetestSummary } from "./lib/run-findings.mjs";
import { assertStableFile, defaultSkillRoot, mergeArtifacts, readStableFile, validateAuditRun } from "./lib/audit-run.mjs";

function parse(snapshot) {
  return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function extendsRun(candidate, run) {
  const fields = ["run_id", "schema_version", "target", "profile", "scope", "environment", "permissions", "resource_versions", "inspection_request", "supersedes_run_id"];
  return fields.every((key) => isDeepStrictEqual(candidate[key], run[key]))
    && candidate.artifacts.length > run.artifacts.length
    && run.artifacts.every((entry) => candidate.artifacts.some((item) => isDeepStrictEqual(item, entry)))
    && run.history.every((entry, index) => isDeepStrictEqual(entry, candidate.history[index]));
}

// Only sibling manifests are inspected. This is discovery, not a trusted global
// latest-run pointer: a newer copy elsewhere cannot be inferred from filenames.
function discoverSuccessors(run, runFile, artifactRoot, skillRoot) {
  const candidates = [];
  const warnings = [];
  const directory = path.dirname(runFile);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const candidateFile = path.join(directory, entry.name);
    if (candidateFile === runFile) continue;
    try {
      const snapshot = readStableFile(candidateFile, { label: "sibling run candidate" });
      const candidate = parse(snapshot);
      if (!candidate || !Array.isArray(candidate.artifacts) || !Array.isArray(candidate.history)) continue;
      const sameRun = candidate.run_id === run.run_id;
      const retest = candidate.supersedes_run_id === run.run_id && candidate.run_id !== run.run_id;
      if (!sameRun && !retest) continue;
      const validation = validateAuditRun(candidate, { runFile: candidateFile, skillRoot });
      if (!validation.valid) {
        warnings.push({ code: "invalid_related_run", file: entry.name });
        continue;
      }
      assertStableFile(snapshot, "sibling run candidate");
      for (const record of validation.envelopesById.values()) assertStableFile(record.snapshot, "sibling registered artifact");
      for (const evidence of validation.evidenceSnapshots.values()) assertStableFile(evidence, "sibling raw evidence");
      if (retest || (validation.artifactRoot === artifactRoot && extendsRun(candidate, run))) {
        candidates.push({ file: entry.name, run_id: candidate.run_id, state: candidate.status, kind: retest ? "retest" : "registration" });
      } else if (sameRun && !isDeepStrictEqual(candidate, run) && !extendsRun(run, candidate)) {
        warnings.push({ code: "divergent_run", file: entry.name });
      }
    } catch {
      // Unrelated JSON is not an audit record; never print its private contents.
    }
  }
  candidates.sort((a, b) => a.file.localeCompare(b.file, "en"));
  if (candidates.length) warnings.push({ code: "superseded_run", files: candidates.map((item) => item.file) });
  return { search_scope: "sibling_json_files_only", successors: candidates, warnings };
}

export function auditStatus(runFile, { skillRoot = defaultSkillRoot, retestOf } = {}) {
  const absolute = path.resolve(runFile);
  const snapshot = readStableFile(absolute, { label: "audit run" });
  const run = parse(snapshot);
  const validation = validateAuditRun(run, { runFile: absolute, skillRoot });
  const resources = validation.resources;
  const profile = resources?.standardsRegistry.profiles.find((item) => item.id === run?.profile?.id);
  const current = Boolean(resources) && run?.schema_version === resources.auditRunSchema.properties.schema_version.const;
  const envelopes = validation.valid ? [...validation.envelopesById.values()].map((record) => record.envelope) : [];
  const reviewed = new Set(envelopes.filter((item) => item.artifact_type === "declared-human-review")
    .flatMap((item) => item.payload.reviews.map((review) => review.requirement_id)));
  const latest = validation.valid
    ? discoverSuccessors(run, absolute, validation.artifactRoot, skillRoot)
    : { search_scope: "not_scanned_invalid_run", successors: [], warnings: [] };
  const result = {
    schema_version: "1.0.0",
    valid: validation.valid,
    run: { id: stringOrNull(run?.run_id), schema_version: stringOrNull(run?.schema_version), state: stringOrNull(run?.status),
      profile: stringOrNull(run?.profile?.id), revision: Array.isArray(run?.artifacts) ? run.artifacts.length : null,
      permissions: run?.permissions && typeof run.permissions === "object" && !Array.isArray(run.permissions) ? run.permissions : null,
      network_scope: networkScopeSummary(run?.permissions), interaction_scope: interactionScopeSummary(run?.permissions) },
    artifacts: (Array.isArray(run?.artifacts) ? run.artifacts : []).map((item) => ({
      id: stringOrNull(item?.artifact_id), type: stringOrNull(item?.artifact_type), producer: stringOrNull(item?.producer_role),
      sha256: stringOrNull(item?.sha256), validation: validation.valid ? "valid" : "run_invalid"
    })),
    coverage: { profile_requirements: profile?.requirement_ids.length ?? null,
      human_reviewed: validation.valid ? reviewed.size : null, evaluation: null },
    claim: { max_tier: null, profile_ceiling: profile?.claim_rules.claim_ceiling ?? null },
    next_transitions: [],
    operations: Object.fromEntries(["merge", "report", "retest"].map((name) => [name, { available: false, reason: "invalid_run" }])),
    latest, warnings: [...latest.warnings], errors: validation.errors,
    recovery: validation.valid ? [] : ["Restore the original registered evidence and matching package resources; validate-run again. Do not edit hashes to silence a mismatch."]
  };
  if (validation.valid) {
    if (!current) result.warnings.push({ code: "legacy_read_only" });
    const blockedReason = current ? null : "legacy_read_only";
    const registry = resources.orchestrationRegistry;
    result.next_transitions = registry.transitions.filter((item) => item.from === run.status).map((item) => {
      const denied = item.required_artifact_types.some((type) => ["fix-authorization", "change-record"].includes(type))
        && run.permissions.source_write !== "authorized_only";
      return { ...item,
        producer_roles: registry.roles.filter((role) => item.required_artifact_types.includes(role.output_type)).map((role) => role.id),
        permitted: current && !denied, reason: blockedReason ?? (denied ? "source_write_denied" : "artifact_required") };
    });
    result.operations.merge.reason = blockedReason ?? "merge_not_ready";
    result.operations.report.reason = blockedReason ?? "merge_not_ready";
    if (current) {
      try {
        const baseline = generateAssessment(run.profile.id, {
          targetName: run.target.name, targetVersion: run.target.version_or_commit, targetRefs: run.target.urls_or_files,
          evaluator: "Status projection", evaluatedAt: new Date().toISOString().slice(0, 10), skillRoot
        });
        baseline.assessment.scope = structuredClone(run.scope);
        baseline.assessment.environment = structuredClone(run.environment);
        const registries = { ...resources, artifact_snapshots_by_id: new Map([...validation.envelopesById].map(([id, record]) => [id, record.snapshot])), evidence_snapshots_by_path: validation.evidenceSnapshots };
        const assessment = mergeArtifacts({ run, assessment: baseline, artifacts: envelopes, registries });
        const guard = validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods,
          { run, artifactSnapshotsById: registries.artifact_snapshots_by_id }).guard;
        result.coverage.evaluation = guard.evaluation_coverage;
        result.claim.max_tier = guard.max_tier;
        result.operations.merge = { available: envelopes.length > 0, reason: envelopes.length ? "registered_artifacts_valid" : "no_artifacts" };
        validateRunBackedAssessment({ run, assessment, envelopesById: validation.envelopesById, resources });
        result.operations.report = { available: true, reason: "requires_matching_assessment" };
      } catch (error) {
        result.warnings.push({ code: "merge_blocked", detail: error.message });
        result.recovery.push("Complete the registered finding details or required artifact bindings, then merge from a fresh E0 baseline.");
      }
    }
    const retest = ["5.0.0", "6.0.0", "7.0.0", "8.0.0", "9.0.0", "10.0.0", "11.0.0", "12.0.0", "13.0.0"].includes(run.schema_version) && run.status === "retest_required";
    result.operations.retest = { available: retest, reason: retest ? "new_run_id_and_target_version_required" : "requires_completed_authorized_change" };
    let priorEnvelopes = envelopes, comparison = false;
    if (retestOf) {
      const priorSnapshot = readStableFile(path.resolve(retestOf), { label: "retest predecessor" }), prior = parse(priorSnapshot);
      const priorValidation = validateAuditRun(prior, { runFile: path.resolve(retestOf), skillRoot });
      if (!priorValidation.valid) throw new Error(`Invalid retest predecessor: ${priorValidation.errors.join("; ")}`);
      if (run.supersedes_run_id !== prior.run_id || run.run_id === prior.run_id || prior.status !== "retest_required"
        || run.target.version_or_commit === prior.target.version_or_commit || run.target.name !== prior.target.name
        || !isDeepStrictEqual(run.target.urls_or_files, prior.target.urls_or_files) || !isDeepStrictEqual(run.profile, prior.profile)
        || !isDeepStrictEqual(run.scope, prior.scope) || !isDeepStrictEqual(run.inspection_request, prior.inspection_request)) throw new Error("Retest comparison requires the linked predecessor and the same target/profile/scope at a new version.");
      priorEnvelopes = [...priorValidation.envelopesById.values()].map((record) => record.envelope); comparison = true;
      assertStableFile(priorSnapshot, "retest predecessor");
      for (const record of priorValidation.envelopesById.values()) assertStableFile(record.snapshot, "predecessor artifact");
      for (const evidence of priorValidation.evidenceSnapshots?.values() ?? []) assertStableFile(evidence, "predecessor evidence");
    }
    result.finding_retest = findingRetestSummary(findingRelations(priorEnvelopes), envelopes.filter((item) => item.artifact_type === "declared-human-review").flatMap((item) => item.payload.reviews), { comparison, required: retest });
  }
  assertStableFile(snapshot, "audit run");
  for (const record of validation.envelopesById?.values() ?? []) assertStableFile(record.snapshot, "registered artifact");
  for (const evidence of validation.evidenceSnapshots?.values() ?? []) assertStableFile(evidence, "raw evidence");
  return result;
}

export function statusText(result, locale = "en") {
  const ja = locale === "ja";
  const lines = [ja ? "監査の状態" : "Audit status",
    `Run: ${result.run.id ?? "unknown"} / schema ${result.run.schema_version ?? "unknown"} / revision ${result.run.revision ?? "unknown"}`,
    `${ja ? "状態" : "State"}: ${result.run.state ?? "unknown"}`,
    `${ja ? "検証" : "Validation"}: ${result.valid ? "PASS" : "FAIL"}`,
    `${ja ? "プロファイル" : "Profile"}: ${result.run.profile ?? "unknown"}`,
    `${ja ? "人手確認" : "Human review"}: ${result.coverage.human_reviewed ?? "?"}/${result.coverage.profile_requirements ?? "?"}`,
    `${ja ? "証拠が許す主張の上限" : "Evidence claim ceiling"}: ${result.claim.max_tier ?? "unknown"}`,
    `${ja ? "権限" : "Permissions"}: ${JSON.stringify(result.run.permissions)}`,
    `${ja ? "通信範囲と強制の状態" : "Network scope and enforcement"}: ${JSON.stringify(result.run.network_scope)}`,
    `${ja ? "操作承認の状態" : "Interaction approval state"}: ${JSON.stringify(result.run.interaction_scope)}`,
    "", ja ? "登録済み成果物" : "Registered artifacts",
    ...result.artifacts.map((item) => `- ${item.type} / ${item.producer} / ${item.validation} / ${item.id} / SHA-256 ${item.sha256}`),
    "", ja ? "次の遷移（成果物の作成・検証が必要）" : "Next transitions (create and validate the required artifact)",
    ...result.next_transitions.map((item) => `- ${item.from} -> ${item.to}: ${item.required_artifact_types.join(", ")} / ${item.producer_roles.join(", ")} / ${item.permitted ? "available" : item.reason}`),
    "", ...Object.entries(result.operations).map(([name, operation]) => `${name}: ${operation.available ? "available" : "unavailable"} (${operation.reason})`),
    ...(result.finding_retest ? ["", ja ? "指摘・条項ごとの再確認（申告に基づく。指摘の解消確定ではありません）" : "Finding/criterion retest declarations (not confirmation of finding resolution)",
      ...result.finding_retest.findings.map((item) => `- ${item.finding_id}: ${item.status} / ${item.requirement_ids.join(", ")}`),
      ...result.finding_retest.requirements.map((item) => `- ${item.requirement_id}: ${item.status}`)] : []),
    "", ja ? "後続runの検索範囲: 同じディレクトリ内のJSONのみ。外部のコピーは未確認です。" : "Successor search: sibling JSON files only; copies elsewhere are not checked.",
    ...result.warnings.map((warning) => `${ja ? "注意" : "Warning"}: ${JSON.stringify(warning)}`),
    ...result.errors.map((error) => `${ja ? "エラー" : "Error"}: ${error}`),
    ...result.recovery.map((step) => `${ja ? "修正方法" : "Recovery"}: ${step}`)
  ];
  return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2)) {
  const options = { format: "text", locale: "en" };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const key = { "--run": "run", "--format": "format", "--locale": "locale", "--retest-of": "retestOf" }[argv[i]];
    if (!key || seen.has(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Invalid or duplicate argument: ${argv[i]}`);
    seen.add(key);
    options[key] = argv[i + 1];
  }
  if (!options.run) throw new Error("--run is required");
  if (!["text", "json"].includes(options.format)) throw new Error("--format must be text or json");
  if (!["ja", "en"].includes(options.locale)) throw new Error("--locale must be ja or en");
  const result = auditStatus(options.run, { retestOf: options.retestOf });
  process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : statusText(result, options.locale));
  return result.valid ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
