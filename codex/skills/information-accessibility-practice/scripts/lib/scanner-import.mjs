import fs from "node:fs";
import { canonicalJson } from "./canonical-json.mjs";
import { targetDigest } from "./target-identity.mjs";
import { targetBindingErrors, targetSnapshotIds } from "./run-targets.mjs";
import { compareInstants, isRfc3339DateTime } from "./date-time.mjs";
import { profileRequirementMap, successCriterionFromAxeTag } from "./automated-web-scan.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

export const AXE_IMPORTER_VERSION = "1.0.0";
const buckets = ["violations", "incomplete", "passes", "inapplicable"];
const mappingBytes = fs.readFileSync(new URL("../../references/scanner-rule-mappings.json", import.meta.url));
const mappings = JSON.parse(mappingBytes.toString("utf8"));
const recordSchema = JSON.parse(fs.readFileSync(new URL("../../references/scanner-import-record.schema.json", import.meta.url), "utf8"));
const checks = JSON.parse(fs.readFileSync(new URL("../../references/common-web-failure-patterns.json", import.meta.url), "utf8")).patterns;
const ruleMap = new Map(mappings.rules.map((rule) => {
  if (!checks.some((check) => check.id === rule.screening_check_id)) throw new Error("Scanner mapping names an unregistered screening check.");
  return [rule.rule_id, rule];
}));
const digest = (value) => targetDigest(canonicalJson(value));
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function text(value, label, maximum = 20000) {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= maximum, `Invalid ${label}.`);
  return value;
}
function instant(value, label, importedAt) {
  requireValue(isRfc3339DateTime(value) && compareInstants(value, importedAt) <= 0, `Invalid or future ${label}.`);
}
function selectors(value) {
  requireValue(Array.isArray(value) && value.length <= 64, "Invalid axe node target selector chain.");
  for (const selector of value) {
    if (Array.isArray(selector)) {
      requireValue(selector.length > 0 && selector.length <= 64, "Invalid shadow selector chain.");
      selector.forEach((item) => text(item, "shadow selector"));
    } else text(selector, "selector");
  }
  return structuredClone(value);
}

// A correlation key, not permission to erase duplicate or conflicting evidence.
// Tool/run/version/snapshot/impact are deliberately excluded; exact frame and
// shadow selectors and declared UI state remain significant.
export function scannerDedupKey({ checkId, targetRef, frame, target, state }) {
  return digest({ version: 1, check_id: checkId, target_ref: targetRef, frame, target, state });
}

function nativeResult(value, importedAt) {
  requireValue(object(value), "Expected a native axe result object.");
  requireValue(value.testEngine?.name === "axe-core" && /^4\.\d+\.\d+$/u.test(value.testEngine?.version), "The axe importer supports stable axe-core 4.x native results only.");
  text(value.url, "axe result URL");
  instant(value.timestamp, "axe timestamp", importedAt);
  requireValue(object(value.testEnvironment), "axe testEnvironment is required.");
  for (const bucket of buckets) {
    requireValue(Array.isArray(value[bucket]) && value[bucket].length <= 10000, `axe ${bucket} must be a bounded array; truncated or omitted result categories are not accepted.`);
    for (const rule of value[bucket]) {
      requireValue(object(rule), "Invalid axe rule.");
      text(rule.id, "axe rule ID", 200);
      requireValue(Array.isArray(rule.tags) && rule.tags.every((tag) => typeof tag === "string" && tag.length <= 200), "Invalid axe tags.");
      requireValue(Array.isArray(rule.nodes) && rule.nodes.length <= 10000, "Invalid axe rule nodes.");
      requireValue(rule.helpUrl === undefined || rule.helpUrl === null || typeof rule.helpUrl === "string", "Invalid axe help URL.");
      requireValue(rule.actIds === undefined || Array.isArray(rule.actIds) && rule.actIds.every((id) => typeof id === "string" && id.length <= 200), "Invalid reported ACT rule IDs.");
      requireValue([null, undefined, "minor", "moderate", "serious", "critical"].includes(rule.impact), "Unknown axe impact value.");
      for (const node of rule.nodes) {
        requireValue(object(node), "Invalid axe node.");
        selectors(node.target);
        requireValue(typeof node.html === "string", "axe node HTML is required.");
        for (const kind of ["any", "all", "none"]) {
          requireValue(Array.isArray(node[kind]) && node[kind].length <= 10000, `axe node ${kind} checks must be present as a bounded array.`);
          for (const check of node[kind]) {
            requireValue(object(check), "Invalid axe check record.");
            text(check.id, "axe check ID", 200);
          }
        }
      }
    }
  }
  return value;
}

export function buildAxeImport({ input, run, targetRef, rawSha256, configuration = null, importedAt = new Date().toISOString(), resources }) {
  requireValue(isRfc3339DateTime(importedAt), "Invalid import timestamp.");
  requireValue(run.schema_version === "17.0.0" && targetBindingErrors(run).length === 0, "Import requires a valid current measured run.");
  const snapshot = run.target_inventory?.snapshots.find((item) => item.target_ref === targetRef);
  requireValue(snapshot?.kind === "web_state", "axe import requires the exact bound saved web_state target.");
  instant(snapshot.captured_at, "target capture time", importedAt);
  requireValue(/^[a-f0-9]{64}$/u.test(rawSha256), "Invalid raw result hash.");
  requireValue(configuration === null || object(configuration), "Scanner configuration must be a JSON object.");
  const exported = input?.kind === "axe-scan-export";
  let frames;
  if (exported) {
    requireValue(input.schema_version === "1.0.0", "Unsupported axe scan export version.");
    requireValue(input.capture?.bundle_sha256 === snapshot.identity.bundle_sha256
      && input.capture?.dom_sha256 === snapshot.identity.dom_sha256
      && input.capture?.ax_tree_sha256 === snapshot.identity.ax_tree_sha256
      && input.capture?.final_url === snapshot.identity.final_url, "Scanner export does not match the bound capture.");
    requireValue(object(input.configuration), "Scanner export configuration is required.");
    requireValue(configuration === null, "Do not override the configuration recorded by a scanner export.");
    requireValue(Array.isArray(input.frames) && input.frames.length > 0 && input.frames.length <= 50, "Invalid scanner export frames.");
    requireValue(input.raw_result_sha256 === digest(input.frames), "Scanner export raw result hash mismatch.");
    const coverage = input.frame_coverage;
    requireValue(object(coverage) && Array.isArray(coverage.entries) && coverage.entries.length > 0 && coverage.entries.length <= 50, "Scanner export requires complete frame coverage accounting.");
    const entryPaths = new Set();
    for (const entry of coverage.entries) {
      requireValue(object(entry) && /^(?:0)(?:\.\d+)*$/u.test(entry.frame_path) && !entryPaths.has(entry.frame_path)
        && ["succeeded", "failed", "skipped"].includes(entry.status), "Invalid frame coverage entry.");
      entryPaths.add(entry.frame_path);
      requireValue(entry.status === "succeeded" || typeof entry.reason === "string" && entry.reason.length > 0, "Failed or skipped frames require a reason.");
    }
    requireValue(coverage.attempted === coverage.entries.length, "Frame attempted count mismatch.");
    for (const status of ["succeeded", "failed", "skipped"]) requireValue(coverage[status] === coverage.entries.filter((entry) => entry.status === status).length, "Frame coverage count mismatch.");
    requireValue(coverage.succeeded === input.frames.length && input.frames.every((entry) => coverage.entries.some((frame) => frame.frame_path === entry.frame?.path && frame.status === "succeeded")), "Frame results do not match successful coverage entries.");
    requireValue(coverage.coverage_status === (coverage.failed || coverage.skipped ? "partial" : "complete"), "Frame coverage status does not match its counts.");
    requireValue(Array.isArray(input.frame_states) && input.frame_states.length === input.frames.length, "Scanner export requires per-frame state measurements.");
    for (const entry of input.frames) {
      const states = input.frame_states.filter((state) => state.frame_path === entry.frame?.path);
      requireValue(states.length === 1, "Missing or duplicate frame state.");
      const state = states[0];
      instant(state.started_at, "scan start", importedAt);
      instant(state.completed_at, "scan completion", importedAt);
      requireValue(compareInstants(state.started_at, state.completed_at) <= 0 && /^[a-f0-9]{64}$/u.test(state.before_dom_sha256)
        && /^[a-f0-9]{64}$/u.test(state.after_dom_sha256), "Invalid frame state measurement.");
      requireValue(state.before_url === entry.frame.url && typeof state.after_url === "string", "Frame state URL mismatch.");
      requireValue(state.state_changed === (state.before_url !== state.after_url || state.before_dom_sha256 !== state.after_dom_sha256), "Frame state change flag mismatch.");
    }
    frames = input.frames;
  } else frames = [{ frame: { path: "0", url: input?.url }, result: input }];
  const profileMap = profileRequirementMap(run.profile.id, resources.standardsRegistry, resources.criteriaCatalog);
  const state = Object.fromEntries(["authentication_state_id", "feature_flags", "locale", "viewport"].map((key) => [key, snapshot.identity[key]]));
  const rows = [];
  const sources = [];
  const framePaths = new Set();
  for (const [frameIndex, entry] of frames.entries()) {
    requireValue(object(entry?.frame) && /^(?:0)(?:\.\d+)*$/u.test(entry.frame.path) && !framePaths.has(entry.frame.path), "Invalid or duplicate scanner frame identity.");
    framePaths.add(entry.frame.path);
    const result = nativeResult(entry.result, importedAt);
    requireValue(entry.frame.url === result.url, "Scanner frame URL does not match its raw result.");
    if (entry.frame.path === "0") {
      requireValue(result.url === snapshot.identity.final_url, "axe URL does not match the captured final URL.");
      for (const [axis, key] of [["width", "windowWidth"], ["height", "windowHeight"]]) {
        requireValue(Number.isInteger(result.testEnvironment[key]) && result.testEnvironment[key] > 0, "axe viewport dimensions are required.");
        requireValue(result.testEnvironment[key] === state.viewport[axis], "axe viewport does not match the saved state.");
      }
    }
    sources.push({ frame: structuredClone(entry.frame), tool: structuredClone(result.testEngine), executed_at: result.timestamp,
      environment: structuredClone(result.testEnvironment), reported_options: structuredClone(result.toolOptions ?? null) });
    for (const bucket of buckets) {
      for (const [ruleIndex, rule] of result[bucket].entries()) {
        const mapping = ruleMap.get(rule.id);
        const profileIds = [...new Set(rule.tags.flatMap((tag) => profileMap.get(successCriterionFromAxeTag(tag)) ?? []))].sort();
        for (const [nodeIndex, node] of (rule.nodes.length ? rule.nodes : [null]).entries()) {
          requireValue(rows.length < 10000, "Scanner import exceeds the 10000-row limit; split the scan scope.");
          const target = node ? selectors(node.target) : [];
          const checkId = mapping?.screening_check_id ?? `axe-core:${rule.id}`;
          rows.push({ source_pointer: `${exported ? `/frames/${frameIndex}/result` : ""}/${bucket}/${ruleIndex}${node ? `/nodes/${nodeIndex}` : ""}`,
            rule_id: rule.id, source_outcome: bucket, screening_check_id: mapping?.screening_check_id ?? null,
            mapping_status: mapping ? "requires_human_verification" : "unsupported_rule_retained",
            reported_profile_requirement_ids: profileIds, reported_act_rule_ids: structuredClone(rule.actIds ?? []),
            help_url: rule.helpUrl ?? null, impact: node?.impact ?? rule.impact ?? null, confidence: "not_estimated",
            frame: structuredClone(entry.frame), target, html: node?.html ?? null, failure_summary: node?.failureSummary ?? null,
            checks: node ? { any: node.any, all: node.all, none: node.none } : null,
            dedup_key: scannerDedupKey({ checkId, targetRef, frame: entry.frame, target, state }),
            source_key: digest({ rawSha256, frameIndex, bucket, ruleIndex, nodeIndex }),
            false_positive_status: "unreviewed", suppression: "none" });
        }
      }
    }
  }
  requireValue(framePaths.has("0"), "Scanner export must include the main frame.");
  const partial = exported && (input.frame_coverage.failed > 0 || input.frame_coverage.skipped > 0);
  const changed = exported && input.frame_states.some((state) => state.state_changed || state.frame_path === "0" && state.after_dom_sha256 !== snapshot.identity.dom_sha256);
  const record = { schema_version: "1.0.0", kind: "scanner-import-record", publication: "private_by_default",
    importer: { id: "axe", version: AXE_IMPORTER_VERSION, accepted_engine_major: 4, mapping_version: mappings.schema_version, mapping_sha256: targetDigest(mappingBytes) },
    imported_at: importedAt, run_id: run.run_id, target_ref: targetRef, target_snapshot_id: snapshot.snapshot_id,
    environment_sha256: run.target_inventory.environment_sha256, raw_result_sha256: rawSha256,
    binding_assurance: exported ? changed ? "state_changed_requires_review" : "hash_linked_saved_capture" : "declared_saved_capture",
    configuration: structuredClone(exported ? input.configuration : configuration ?? { reported_run_options: input.toolOptions ?? null, configure: null, context: null }),
    configuration_assurance: exported ? "package_recorded" : configuration ? "caller_declared" : "partially_reported",
    frame_coverage: exported ? structuredClone(input.frame_coverage ?? null) : { status: "native_result_scope_only" },
    frame_states: exported ? structuredClone(input.frame_states) : [],
    sources, rows, limitations: [
      "Automated results and criterion mappings require human verification; machine passes and inapplicable rules are not profile outcomes.",
      "False positives, unsupported rules and duplicate candidates are preserved; none are suppressed or automatically merged.",
      "Hashes prove recorded byte consistency, not producer identity or an atomic scan of a dynamic page.",
      ...(partial ? ["Some frames failed or were skipped. Coverage is partial and the retained results cannot represent those frames."] : []),
      ...(changed ? ["The DOM or URL changed during scanning or before the saved capture. Recollect a stable state before relying on these candidates."] : []),
      ...(exported ? [] : ["Native axe JSON does not contain a DOM hash. Its relationship to this saved state is declared by the caller; URL and reported viewport are checked."]),
      ...(!exported && !configuration ? ["Full axe.configure settings and execution context were not recorded; reported options alone may not reproduce the scan."] : [])
    ] };
  const errors = validateJsonSchema(record, recordSchema);
  requireValue(errors.length === 0, `Invalid normalized scanner record: ${errors.join("; ")}`);
  return { record, snapshot, targetSnapshotIds: targetSnapshotIds(run) };
}

export function importedScreeningArtifact({ run, record, artifactId, evidenceRefs }) {
  const rows = record.rows.length ? record.rows : [null];
  const observations = rows.map((row, index) => {
    const profiles = row?.reported_profile_requirement_ids ?? [];
    const source = row ? record.sources.find((item) => item.frame.path === row.frame.path) : record.sources[0];
    const known = row?.mapping_status === "requires_human_verification";
    const signal = !row || !known || record.binding_assurance === "state_changed_requires_review" || row.source_outcome === "incomplete" ? "inconclusive" : row.source_outcome === "violations" ? "candidate_issue" : "no_automated_signal";
    const outcome = row?.source_outcome ?? "empty results";
    return { requirement_id: `SCREEN-IMPORT-${digest({ index, source: row?.source_key ?? "empty" }).slice(0, 24).toUpperCase()}`,
      evidence_level: "E1", method: "Versioned axe-core result import; source details retained in private evidence",
      location: `Imported scanner item ${index + 1}`, observation: known
        ? `The scanner reported ${outcome} for ${row.rule_id}. Human verification is required.`
        : `The scanner result requires review because its rule mapping is unsupported or no rule result was supplied. Source category: ${outcome}. ${record.limitations.join(" ")}`,
      captured_at: record.imported_at,
      profile_mappings: profiles.map((profileId) => ({ requirement_id: profileId, report_outcome: "cant_tell",
        applicability: "undetermined", rationale: record.limitations.join(" ") })),
      evidence_refs: structuredClone(evidenceRefs), signal_class: signal, human_review_required: true,
      evidence_provenance: { collection_method: "automated_tool", tool_name: "axe-core", tool_version: source.tool.version,
        rule_id: known ? row.rule_id : "unsupported-rule", target_dom: `Private scanner item ${index + 1}`, viewport: null } };
  });
  requireValue(observations.length <= 10000, "Scanner import exceeds the 10000-observation limit.");
  return { schema_version: "3.0.0", artifact_id: artifactId, artifact_type: "screening-observations", run_id: run.run_id,
    target_snapshot_ids: targetSnapshotIds(run), producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: `axe importer ${AXE_IMPORTER_VERSION}` },
    created_at: record.imported_at, inputs: [], payload: { schema_version: "4.0.0", observations } };
}
