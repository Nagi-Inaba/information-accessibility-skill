import { isDeepStrictEqual } from "node:util";
import { consensusRemediationItems, consensusReviewRows, resolveHumanReviews, reviewEntries } from "./human-review-consensus.mjs";
import { findingRelations, remediationPlanItems } from "./run-findings.mjs";
import { compareEvidenceReferences } from "./run-evidence.mjs";
import { compareRunTargets } from "./run-targets.mjs";

const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right, "en"));
const envelopes = (validation) => [...validation.envelopesById.values()].map(({ envelope }) => envelope);
const ofType = (records, type) => records.filter((record) => record.artifact_type === type);

function runEvidence(validation) {
  const records = envelopes(validation);
  const resolved = resolveHumanReviews(reviewEntries(ofType(records, "declared-human-review")
    .map((record) => ({ payload: record.payload, artifact_id: record.artifact_id }))));
  const plans = consensusRemediationItems(resolved, ofType(records, "remediation-plan")
    .flatMap((record) => remediationPlanItems(record.payload)));
  return {
    records,
    profile: new Map(consensusReviewRows(resolved).map((row) => [row.requirement_id, row.profile_outcome])),
    findings: findingRelations(records, { reviews: resolved.findingReviews, plans }),
    screening: ofType(records, "screening-observations").flatMap((record) => record.payload.observations),
    plans
  };
}

function uniqueById(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    if (result.has(row[key])) throw new Error(`Ambiguous ${label} ID in comparison: ${row[key]}.`);
    result.set(row[key], row);
  }
  return result;
}

function matchedIds(before, after, explicit, label) {
  if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) throw new Error(`${label} mapping must be an object.`);
  const used = new Set(), matches = new Map();
  for (const [oldId, newId] of Object.entries(explicit)) {
    if (!before.has(oldId) || typeof newId !== "string" || !after.has(newId)) throw new Error(`${label} mapping references an unknown ID: ${oldId} -> ${newId}.`);
    if (oldId !== newId && after.has(oldId)) throw new Error(`${label} mapping conflicts with a stable ID: ${oldId}.`);
    if (used.has(newId)) throw new Error(`${label} mapping reuses a successor ID: ${newId}.`);
    used.add(newId); matches.set(oldId, { id: newId, relation: "explicit_mapping" });
  }
  for (const oldId of before.keys()) {
    if (matches.has(oldId) || !after.has(oldId)) continue;
    if (used.has(oldId)) throw new Error(`${label} mapping conflicts with a stable ID: ${oldId}.`);
    used.add(oldId); matches.set(oldId, { id: oldId, relation: "stable_id" });
  }
  return { matches, used };
}

function profileStatus(before, after) {
  if (after === null || ["not_tested", "cant_tell"].includes(after)) return "not_retested";
  if (after === "not_applicable") return before === "not_applicable" ? "unchanged"
    : ["pass", "fail"].includes(before) ? "no_longer_applicable" : "new_not_applicable";
  if (before === "fail" && after === "pass") return "improved";
  if (before === "fail" && after === "fail") return "unresolved";
  if (before === "pass" && after === "fail") return "regressed";
  if (before === null && after === "fail") return "new";
  return before === after ? "unchanged" : "changed";
}

function screeningStatus(before, after) {
  if (!after || after.signal_class === "inconclusive") return "not_retested";
  const oldIssue = before?.signal_class === "candidate_issue";
  const newIssue = after.signal_class === "candidate_issue";
  if (!before) return newIssue ? "new" : "new_non_issue";
  if (oldIssue && newIssue) return "unresolved";
  if (oldIssue) return "improved_unverified";
  if (newIssue) return "regressed";
  return "unchanged";
}

function remediationRows(beforeEvidence) {
  const planItems = ofType(beforeEvidence.records, "remediation-plan")
    .flatMap((record) => record.payload.items.map((item) => ({ remediation_id: item.remediation_id, source_artifact_id: record.artifact_id })));
  const declared = ofType(beforeEvidence.records, "declared-change-record")
    .flatMap((record) => record.payload.remediation_ids);
  const authorizations = new Map(ofType(beforeEvidence.records, "fix-authorization")
    .map((record) => [record.artifact_id, record]));
  const changedPlanArtifacts = new Set(ofType(beforeEvidence.records, "change-record")
    .map((record) => authorizations.get(record.payload.authorization_artifact?.artifact_id)?.payload.remediation_artifact?.artifact_id)
    .filter(Boolean));
  const declaredIds = new Set(declared);
  return planItems.sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"))
    .map((plan) => ({ remediation_id: plan.remediation_id,
      status: declaredIds.has(plan.remediation_id) ? "declared_change_recorded"
        : changedPlanArtifacts.has(plan.source_artifact_id) ? "authorized_plan_change_recorded" : "not_confirmed" }));
}

export function buildRetestDelta(beforeRun, beforeValidation, afterRun, afterValidation, mapping = {}) {
  if (afterRun.supersedes_run_id !== beforeRun.run_id || beforeRun.run_id === afterRun.run_id
    || beforeRun.status !== "retest_required") throw new Error("Comparison requires a successor of the retest-required predecessor.");
  if (beforeRun.target.version_or_commit === afterRun.target.version_or_commit) throw new Error("Retest comparison requires a changed target version.");
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)
    || Object.keys(mapping).some((key) => !["finding_ids", "screening_ids"].includes(key))) throw new Error("Mapping supports only finding_ids and screening_ids objects.");
  const before = runEvidence(beforeValidation), after = runEvidence(afterValidation);
  const profile = beforeValidation.resources.standardsRegistry.profiles.find((item) => item.id === beforeRun.profile.id);
  const ids = new Set([...(profile?.requirement_ids ?? []), ...before.profile.keys(), ...after.profile.keys()]);
  const comparable = isDeepStrictEqual(beforeRun.profile, afterRun.profile)
    && isDeepStrictEqual(beforeRun.scope, afterRun.scope)
    && beforeRun.target.name === afterRun.target.name
    && isDeepStrictEqual(beforeRun.target.urls_or_files, afterRun.target.urls_or_files);
  const profile_outcomes = sorted(ids).map((requirement_id) => {
    const oldOutcome = before.profile.get(requirement_id) ?? null, newOutcome = after.profile.get(requirement_id) ?? null;
    return { requirement_id, before: oldOutcome, after: newOutcome,
      status: comparable ? profileStatus(oldOutcome, newOutcome) : "not_comparable" };
  });
  const afterOutcome = new Map(profile_outcomes.map((row) => [row.requirement_id, row.after]));
  const oldFindings = uniqueById(before.findings, "finding_id", "finding"), newFindings = uniqueById(after.findings, "finding_id", "finding");
  const findingLinks = matchedIds(oldFindings, newFindings, mapping.finding_ids ?? {}, "Finding");
  const findings = [...oldFindings.values()].map((oldFinding) => {
    const match = findingLinks.matches.get(oldFinding.finding_id), current = match ? newFindings.get(match.id) : null;
    const outcomes = oldFinding.requirement_ids.map((id) => afterOutcome.get(id) ?? null);
    const status = !comparable ? "not_retested" : current ? "unresolved"
      : outcomes.length && outcomes.every((value) => value === "pass") ? "resolved"
        : outcomes.some((value) => value === "fail") ? "unresolved"
          : outcomes.length && outcomes.every((value) => value === "not_applicable") ? "no_longer_applicable" : "not_retested";
    return { before_finding_id: oldFinding.finding_id, after_finding_id: current?.finding_id ?? null,
      relation: match?.relation ?? "criterion_only", requirement_ids: oldFinding.requirement_ids,
      status, basis: current ? "linked_finding" : status === "resolved" ? "successor_human_pass"
        : status === "unresolved" ? "related_criterion_fail" : "insufficient_successor_review" };
  });
  const new_findings = [...newFindings.values()].filter((row) => !findingLinks.used.has(row.finding_id))
    .map((row) => ({ finding_id: row.finding_id, requirement_ids: row.requirement_ids,
      status: comparable && row.requirement_ids.some((id) => before.profile.get(id) === "pass") ? "regressed" : "new" }));
  const oldScreening = uniqueById(before.screening, "requirement_id", "screening"), newScreening = uniqueById(after.screening, "requirement_id", "screening");
  const screeningLinks = matchedIds(oldScreening, newScreening, mapping.screening_ids ?? {}, "Screening");
  const screening_candidates = [...oldScreening.values()].map((row) => {
    const match = screeningLinks.matches.get(row.requirement_id), current = match ? newScreening.get(match.id) : null;
    return { before_id: row.requirement_id, after_id: current?.requirement_id ?? null,
      relation: match?.relation ?? "unmapped", before_signal: row.signal_class ?? null,
      after_signal: current?.signal_class ?? null,
      status: comparable ? screeningStatus(row, current) : "not_comparable" };
  });
  const new_screening_candidates = [...newScreening.values()].filter((row) => !screeningLinks.used.has(row.requirement_id))
    .map((row) => ({ id: row.requirement_id, signal: row.signal_class ?? null,
      status: comparable ? screeningStatus(null, row) : "not_comparable" }));
  const priorScreeningId = new Map([...screeningLinks.matches].map(([oldId, match]) => [match.id, oldId]));
  const evidence_comparisons = compareEvidenceReferences(before.screening,
    after.screening.map((row) => ({ ...row, requirement_id: priorScreeningId.get(row.requirement_id) ?? row.requirement_id })));
  const target = { before_version: beforeRun.target.version_or_commit, after_version: afterRun.target.version_or_commit,
    before_target_refs: beforeRun.target.urls_or_files, after_target_refs: afterRun.target.urls_or_files,
    target_refs_changed: !isDeepStrictEqual(beforeRun.target.urls_or_files, afterRun.target.urls_or_files),
    scope_changed: !isDeepStrictEqual(beforeRun.scope, afterRun.scope),
    environment_changed: !isDeepStrictEqual(beforeRun.environment, afterRun.environment),
    before_scope: beforeRun.scope, after_scope: afterRun.scope,
    before_environment: beforeRun.environment, after_environment: afterRun.environment,
    measured: beforeRun.target_inventory && afterRun.target_inventory
      ? compareRunTargets(beforeRun, beforeRun.target_inventory, afterRun, afterRun.target_inventory) : null };
  return { schema_version: "1.0.0", publication: "private_by_default", before_run_id: beforeRun.run_id,
    after_run_id: afterRun.run_id, comparable, target, profile_outcomes, findings, new_findings,
    screening_candidates, new_screening_candidates, evidence_comparisons, remediation: remediationRows(before),
    limitation: "Statuses summarize registered declarations and saved evidence. A criterion pass does not by itself prove the old location was repaired; screening changes are not conformance judgements. No old evidence is inherited by the successor." };
}

const cell = (value) => String(value ?? "—").replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
  .replace(/>/gu, "&gt;").replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
const table = (headers, rows) => [
  `| ${headers.map(cell).join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)
].join("\n");

export function renderRetestDelta(delta) {
  return ["# 再検査の前後比較", "", `旧run: ${delta.before_run_id}  `, `新run: ${delta.after_run_id}  `,
    `対象版: ${delta.target.before_version} → ${delta.target.after_version}`, "",
    `比較可能な対象範囲: ${delta.comparable ? "はい" : "いいえ"}。対象参照差: ${delta.target.target_refs_changed ? "あり" : "なし"}、scope差: ${delta.target.scope_changed ? "あり" : "なし"}、環境差: ${delta.target.environment_changed ? "あり" : "なし"}。`,
    `対象実測: ${delta.target.measured ? delta.target.measured.map((row) => `${row.target_ref}=${row.status}`).join("、") : "両runのinventoryが揃っていないため未比較"}`, "",
    "## 対象・範囲・環境", "", table(["項目", "旧run", "新run"], [
      ["対象参照", JSON.stringify(delta.target.before_target_refs), JSON.stringify(delta.target.after_target_refs)],
      ["scope", JSON.stringify(delta.target.before_scope), JSON.stringify(delta.target.after_scope)],
      ["環境", JSON.stringify(delta.target.before_environment), JSON.stringify(delta.target.after_environment)]
    ]), "",
    "## 旧指摘", "", table(["旧ID", "新ID", "関係", "条項", "状態", "判定根拠"], delta.findings.map((row) => [row.before_finding_id, row.after_finding_id, row.relation, row.requirement_ids.join(", "), row.status, row.basis])), "",
    "## 新規指摘", "", table(["ID", "条項", "状態"], delta.new_findings.map((row) => [row.finding_id, row.requirement_ids.join(", "), row.status])), "",
    "## profile outcome", "", table(["条項", "前", "後", "状態"], delta.profile_outcomes.map((row) => [row.requirement_id, row.before, row.after, row.status])), "",
    "## screening候補", "", table(["旧ID", "新ID", "前signal", "後signal", "状態"], delta.screening_candidates.map((row) => [row.before_id, row.after_id, row.before_signal, row.after_signal, row.status])), "",
    "## 新規screening候補", "", table(["ID", "signal", "状態"], delta.new_screening_candidates.map((row) => [row.id, row.signal, row.status])), "",
    "## 保存済みscreening根拠", "", table(["候補ID", "対象", "根拠種別", "bytes", "context"], delta.evidence_comparisons.map((row) => [row.requirement_id, row.target_ref, row.evidence_type, row.status, row.context_changed ? "変更あり" : "同じ"])), "",
    "## 改善計画の変更記録", "", table(["改善ID", "記録"], delta.remediation.map((row) => [row.remediation_id, row.status])), "",
    `制限: ${delta.limitation}`, ""].join("\n");
}
