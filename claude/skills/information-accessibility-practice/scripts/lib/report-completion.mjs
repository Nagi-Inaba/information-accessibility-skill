import { reviewDetailLines } from "./review-details.mjs";

const present = (value) => Array.isArray(value) ? value.some(present) : typeof value === "string" && Boolean(value.trim());
const unperformed = (record) => record.outcome === "not_tested" || record.review_details?.reason === "test_not_run";
const pending = (record) => unperformed(record) || record.outcome === "cant_tell" || record.review_details?.reason
  || record.review_details?.next_checks?.length || record.review_details?.performed_checks?.some((check) => check.outcome === "cant_tell");

// These are field-presence observations, never a certification that the agreed inspection is complete.
// Use every registered check, including checks sharing a criterion. Untouched catalog rows are not an agreed test plan.
export function inspectionCompletion(presentation) {
  const ja = presentation.locale === "ja";
  const records = presentation.inspection_records ?? [];
  const findings = presentation.findings ?? [];
  const remaining = records.filter(pending);
  const notRun = records.filter(unperformed);
  const recorded = ja ? "記録あり" : "Recorded";
  const missing = ja ? "記録不足" : "Missing records";
  const compare = ja ? "照合待ち" : "Needs comparison";
  const count = (labelJa, labelEn, value, total) => ja ? `${labelJa}: ${value}/${total}件。` : `${labelEn}: ${value}/${total}.`;
  const hasTargetEvidence = (record) => (record.evidence ?? []).some((item) => present(item.location) && present(item.observation)
    && present(item.method ?? item.type));
  const evidenceCount = records.filter((record) => !unperformed(record) && hasTargetEvidence(record)
    && (record.source_kind === "human_review" || record.evidence_level === "E1")).length;
  const pendingCount = remaining.filter((record) => present(record.review_details?.reason) && present(record.review_details?.next_checks)).length;
  const priorityCount = findings.filter((finding) => present(finding.priority)).length;
  const reproductionCount = findings.filter((finding) => present(finding.location) && present(finding.affected_users)
    && (finding.review_records ?? []).some(hasTargetEvidence)).length;
  const remediationCount = findings.filter((finding) => present(finding.proposed_change ?? finding.remediation) && present(finding.verification)).length;
  const status = (value, total) => total === 0 ? compare : value === total ? recorded : missing;
  const scoped = [
    `${ja ? "対象" : "Included"}: ${(presentation.scope?.included ?? []).join("; ") || (ja ? "記録なし" : "Not recorded")}`,
    `${ja ? "範囲外" : "Excluded"}: ${(presentation.scope?.excluded ?? []).join("; ") || (ja ? "記録なし" : "Not recorded")}`
  ].join(" / ");
  const notRunSummary = ja ? `未実施の検査: ${notRun.length}件` : `Unperformed checks: ${notRun.length}`;
  const criteria = {
    agreed_scope_checked: {
      status: compare, detail: scoped,
      next: ja ? "合意したページ・操作と検査記録を照合し、未実施の検査が今回の範囲に含まれるか確認する。" : "Compare the agreed pages and interactions with the records, including whether unperformed checks belong to this inspection."
    },
    target_evidence_recorded: {
      status: records.length ? status(evidenceCount, records.length) : missing,
      detail: count("実施済み検査の箇所・方法・観測", "Performed checks with location, method and observation", evidenceCount, records.length),
      next: ja ? "不足する観測・検査方法を記録し、実施できなかった検査の条件を整える。記録済みの根拠も対象との一致を確認する。" : "Supply missing observations and methods, enable unperformed tests, and verify that recorded evidence matches the target."
    },
    priority_findings_reported: {
      status: status(priorityCount, findings.length), detail: count("優先度を記録した改善項目", "Findings with priorities", priorityCount, findings.length),
      next: ja ? "主要な問題の取りこぼしと優先順位を確認する。改善項目がない場合も、問題がないと判断できる検査範囲か確認する。" : "Check for omitted key issues and review priorities. An empty finding list also needs comparison with the inspected scope."
    },
    remaining_checks_reported: {
      status: status(pendingCount, remaining.length), detail: count("理由と次の検査を記録した保留項目", "Pending checks with reasons and next tests", pendingCount, remaining.length),
      next: ja ? "登録した検査記録の「次の確認」を実施する。未登録の検査や対象範囲の残件も確認する。" : "Perform the next checks in the registered records and check the scope for any unregistered remaining tests."
    },
    agreed_states_and_environments_checked: {
      status: compare, detail: `${ja ? "記録した環境" : "Recorded environment"}: ${Object.values(presentation.environment ?? {}).flat().filter(present).join("; ") || (ja ? "記録なし" : "Not recorded")} / ${notRunSummary}`,
      next: ja ? "合意した画面状態・操作・ブラウザー・支援技術ごとの結果を照合し、必要な未実施の検査を行う。" : "Compare results for each agreed state, interaction, browser and assistive technology, then perform required missing tests."
    },
    reproduction_and_evidence_recorded: {
      status: status(reproductionCount, findings.length), detail: count("箇所・観測・影響を記録した改善項目", "Findings with location, observations and affected users", reproductionCount, findings.length),
      next: ja ? "検査記録の操作と観測から再現できるか確認し、不足する手順や証拠を補う。" : "Check whether the recorded actions and observations reproduce each issue; supply missing steps and evidence."
    },
    remediation_and_retest_recorded: {
      status: status(remediationCount, findings.length), detail: count("改善案と再検査手順を記録した改善項目", "Findings with remediation and retest steps", remediationCount, findings.length),
      next: ja ? "改善案と再検査手順の具体性を確認する。未記入の項目は着手前に補う。" : "Review whether the proposed changes and retest steps are actionable, and fill missing entries before starting."
    }
  };
  return {
    summary: `${ja ? "完了確認待ち" : "Completion review pending"} / ${notRunSummary}${notRun.length ? ` (${notRun.map((record) => record.evidence?.[0]?.location || record.profile_requirement_id || record.requirement_id).join("; ")})` : ""}`,
    records,
    criteria: (presentation.inspection_request?.completion_criteria ?? []).map((key) => ({ key, ...criteria[key] }))
  };
}

export function inspectionRecordLines(record, presentation) {
  const ja = presentation.locale === "ja";
  return [
    `${ja ? "判定と出所" : "Judgement and source"}: ${presentation.messages.outcomes[record.outcome] ?? record.outcome ?? (ja ? "未確認" : "Not tested")} / ${presentation.messages.sources[record.source_kind]}`,
    ...reviewDetailLines(record, presentation.locale)
  ];
}
