import { provenanceCounts, readerText, readerOverviewMarkdown, readerActionsMarkdown, readerPendingMarkdown, readerInspectionMarkdown } from "./report-reader.mjs";

function escapeCell(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_{}\[\]()#+!])/gu, "\\$1")
    .replace(/\r\n|[\r\n]/gu, "<br>")
    .replace(/\|/gu, "\\|")
    .trim();
}

function table(headers, rows, emptyMessage) {
  if (rows.length === 0) return emptyMessage;
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`)
  ].join("\n");
}

function count(counts, key) {
  return counts?.[key] ?? 0;
}

function localeText(locale) {
  if (locale === "ja") {
    return {
      summary: "要約",
      overall: "総合判定",
      evidence: "証拠レベル",
      target: "対象",
      key: "主要な問題と次の行動",
      noKey: "主要な問題候補または確認済みの不適合は記録されていません。",
      priority: "優先度",
      criterion: "達成基準",
      judgement: "判定",
      source: "判定の出所",
      strength: "証拠レベル",
      rationale: "根拠・次の行動",
      issue: "問題",
      change: "改善案",
      verification: "再確認方法",
      human: "人手確認済みの達成基準",
      noHuman: "人手確認済みの達成基準はありません。",
      remaining: "未実施の残り達成基準",
      groups: "プロファイル区分別件数",
      provenance: "証拠の出所別件数",
      group: "区分",
      pass: "適合",
      fail: "不適合",
      cantTell: "要確認",
      notTested: "未確認",
      notApplicable: "適用対象外",
      humanCount: "外部人手レビュー",
      screeningCount: "AI／自動スクリーニング",
      notRunCount: "未実施",
      claim: "主張可能な範囲",
      requested: "要求されたtier",
      maximum: "検証上限tier",
      wording: "使用する固定表現",
      reasons: "制限理由",
      scope: "対象範囲と制約",
      included: "含む範囲",
      limitations: "制約",
      none: "記録なし"
    };
  }
  return {
    summary: "Summary",
    overall: "Overall judgement",
    evidence: "Evidence level",
    target: "Target",
    key: "Key findings and next actions",
    noKey: "No verified failure or actionable screening candidate is recorded.",
    priority: "Priority",
    criterion: "Criterion",
    judgement: "Judgement",
    source: "Judgement source",
    strength: "Evidence level",
    rationale: "Rationale or next action",
    issue: "Issue",
    change: "Proposed change",
    verification: "Verification",
    human: "Human-reviewed requirements",
    noHuman: "No human-reviewed requirement is recorded.",
    remaining: "Remaining not-run requirements",
    groups: "Profile group counts",
    provenance: "Evidence provenance counts",
    group: "Group",
    pass: "Pass",
    fail: "Fail",
    cantTell: "Cannot tell",
    notTested: "Not tested",
    notApplicable: "Not applicable",
    humanCount: "External human review",
    screeningCount: "AI/automated screening",
    notRunCount: "Not run",
    claim: "Claim boundary",
    requested: "Requested tier",
    maximum: "Validator maximum tier",
    wording: "Registry-fixed wording",
    reasons: "Limiting reasons",
    scope: "Scope and limitations",
    included: "Included scope",
    limitations: "Limitations",
    none: "Not recorded"
  };
}

export function renderReportSummaryMarkdown(presentation) {
  const text = localeText(presentation.locale);
  const reader = readerText(presentation.locale);
  const provenance = provenanceCounts(presentation);

  const lines = [
    `# ${escapeCell(presentation.title)}`,
    "",
    `## ${text.summary}`,
    "",
    readerOverviewMarkdown(presentation),
    "",
    `## ${text.key}`,
    "",
    readerActionsMarkdown(presentation),
    "",
    `## ${reader.pending}`,
    "",
    readerPendingMarkdown(presentation),
    "",
    `- ${text.remaining}: ${provenance.not_run}`,
    "",
    ...(presentation.inspection_request ? [readerInspectionMarkdown(presentation), ""] : []),
    `## ${text.groups}`,
    "",
    table(
      [text.group, text.pass, text.fail, text.cantTell, text.notTested, text.notApplicable],
      presentation.groups.map((group) => [
        group.label,
        count(group.counts, "pass"),
        count(group.counts, "fail"),
        count(group.counts, "cant_tell"),
        count(group.counts, "not_tested"),
        count(group.counts, "not_applicable")
      ]),
      text.none
    ),
    "",
    `## ${text.provenance}`,
    "",
    `- ${text.humanCount}: ${provenance.human_review}`,
    `- ${text.screeningCount}: ${provenance.screening}`,
    `- ${text.notRunCount}: ${provenance.not_run}`,
    `- ${text.evidence}: ${escapeCell(presentation.evidence_level)}`,
    "",
    `## ${text.claim}`,
    "",
    `- ${text.requested}: \`${escapeCell(presentation.claim.requested_tier)}\``,
    `- ${text.maximum}: \`${escapeCell(presentation.claim.maximum_tier)}\``,
    `- ${text.wording}: ${escapeCell(presentation.claim.wording)}`,
    `- ${text.reasons}: ${escapeCell(presentation.claim.reasons.join("; ") || text.none)}`,
    "",
    `## ${text.scope}`,
    "",
    `- ${text.included}: ${escapeCell(presentation.scope.included.join(", ") || text.none)}`,
    `- ${text.limitations}: ${escapeCell(presentation.limitations.join("; ") || text.none)}`,
    ""
  ];
  return lines.join("\n");
}
