const commonCriteria = ["agreed_scope_checked", "target_evidence_recorded", "priority_findings_reported", "remaining_checks_reported"];

export const inspectionModes = {
  quick: {
    deliverables: ["decision_summary", "remaining_checks"],
    completion_criteria: commonCriteria
  },
  detailed: {
    deliverables: ["decision_summary", "remediation_details", "complete_results", "remaining_checks"],
    completion_criteria: [...commonCriteria, "agreed_states_and_environments_checked", "reproduction_and_evidence_recorded", "remediation_and_retest_recorded"]
  }
};

export function createInspectionRequest(mode, purpose) {
  if (!Object.hasOwn(inspectionModes, mode)) throw new Error("Choose --inspection-mode quick or detailed before starting an inspection.");
  if (typeof purpose !== "string" || !purpose.trim()) throw new Error("--inspection-purpose must describe the requested use of the report.");
  return { mode, purpose: purpose.trim(), ...structuredClone(inspectionModes[mode]) };
}

export function inspectionRequestErrors(request) {
  try {
    const expected = createInspectionRequest(request?.mode, request?.purpose);
    return ["deliverables", "completion_criteria"].filter((key) => JSON.stringify(request[key]) !== JSON.stringify(expected[key]))
      .map((key) => `inspection_request.${key} must match the selected inspection mode.`);
  } catch (error) {
    return [error.message];
  }
}

export function inspectionText(locale = "ja") {
  return locale === "ja" ? {
    mode: "検査レベル", purpose: "レポートの利用目的", quick: "簡易チェック", detailed: "詳細検査・改善用",
    heading: "依頼した成果物と完了条件", deliverables: "必要な成果物", criteria: "検査の完了条件",
    progress: "検査の完了状況", next: "次の作業", records: "登録した検査記録",
    progressNotice: "「記録あり」は必要な記入欄が埋まっている状態です。内容の十分性や合意範囲との一致は、検査記録と照合してください。達成基準の件数から検査完了を判定していません。",
    notice: "以下は検査前に定めた条件です。達成済みという意味ではありません。実施記録と照合し、満たせない条件と次の作業を明示してください。",
    decision_summary: "判断用の要約", remediation_details: "指摘ごとの改善手順", complete_results: "全項目の結果と根拠", remaining_checks: "未確認事項と次の確認",
    agreed_scope_checked: "合意した対象範囲の検査を実施し、範囲外を明示する",
    target_evidence_recorded: "対象固有の観測結果と実施した検査を記録する",
    priority_findings_reported: "主要な問題と優先度を示す",
    remaining_checks_reported: "未確認の理由と次の検査を示す",
    agreed_states_and_environments_checked: "合意した画面状態・操作・環境ごとの検査結果を残す",
    reproduction_and_evidence_recorded: "指摘ごとに箇所・再現手順・根拠・利用者への影響を示す",
    remediation_and_retest_recorded: "指摘ごとに具体的な修正案と再検査手順を示す"
  } : {
    mode: "Inspection level", purpose: "Intended use of the report", quick: "Quick check", detailed: "Detailed inspection for remediation",
    heading: "Requested deliverables and completion criteria", deliverables: "Required deliverables", criteria: "Inspection completion criteria",
    progress: "Inspection completion", next: "Next step", records: "Registered inspection records",
    progressNotice: "Recorded means the required fields contain entries. Compare their substance with the evidence and agreed scope. Requirement counts do not establish inspection completion.",
    notice: "These conditions were set before inspection; listing them does not mean they are met. Compare them with the recorded evidence and identify unmet conditions and next steps.",
    decision_summary: "Decision summary", remediation_details: "Remediation instructions for each finding", complete_results: "Complete results and evidence", remaining_checks: "Remaining checks and next steps",
    agreed_scope_checked: "Perform the agreed scope of checks and identify exclusions",
    target_evidence_recorded: "Record target-specific observations and performed checks",
    priority_findings_reported: "Identify key issues and priorities",
    remaining_checks_reported: "Explain unresolved checks and the next tests",
    agreed_states_and_environments_checked: "Record checks for each agreed state, interaction and environment",
    reproduction_and_evidence_recorded: "Provide each finding's location, reproduction steps, evidence and affected users",
    remediation_and_retest_recorded: "Provide a concrete change and retest procedure for each finding"
  };
}
