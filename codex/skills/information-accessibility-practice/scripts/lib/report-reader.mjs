import { reviewDetailLines } from "./review-details.mjs";
import { inspectionText } from "./inspection-request.mjs";
import { inspectionCompletion, inspectionRecordLines } from "./report-completion.mjs";

export function readerText(locale) {
  return locale === "ja" ? {
    target: "対象", scope: "検査対象の範囲", overall: "総合判定", coverage: "確認の進み具合",
    human: "人手で確認した項目", screening: "AI・自動検査の結果を記録した項目", notRun: "検査記録のない項目",
    coverageNote: "件数は達成基準の数です。人手確認には要確認の判定も、AI・自動検査の記録には未実施の検査の報告も含みます。確認したページや操作の範囲は、対象範囲の記録を参照してください。",
    key: "主要な問題と次の行動", noActions: "改善項目の記録はありません。未確認の項目は、続く「残る確認と次の作業」で確認してください。",
    pending: "残る確認と次の作業", noPending: "主要な問題の欄に記載したもの以外に、追加の確認待ちは記録されていません。",
    count: "対象項目数", criterion: "達成基準・検査項目", priority: "優先度", unprioritized: "優先度未設定",
    judgement: "判定と出所", location: "箇所", affected: "影響を受ける利用者", change: "改善案", verification: "再確認方法",
    owner: "担当", residual: "改善後も残る制約", evidence: "確認内容と次の確認", none: "記録なし",
    candidate: "AI・自動検査による問題候補（未確認）", genericPending: "個別の確認理由が未記録の項目", commonPending: "共通の確認事項",
    remaining: "未実施の残り達成基準"
  } : {
    target: "Target", scope: "Inspection scope", overall: "Overall judgement", coverage: "Review progress",
    human: "Requirements checked by a human", screening: "Requirements with AI/automated results", notRun: "Requirements without inspection records",
    coverageNote: "Counts refer to requirements. Human checks include cannot-tell judgements; AI/automated records can report unperformed tests. Consult the scope record for the pages and interactions covered.",
    key: "Key findings and next actions", noActions: "No remediation item is recorded. See Remaining checks and next steps for unconfirmed requirements.",
    pending: "Remaining checks and next steps", noPending: "No additional pending check is recorded beyond those in the findings above.",
    count: "Requirement count", criterion: "Requirement or check", priority: "Priority", unprioritized: "Priority not set",
    judgement: "Judgement and source", location: "Location", affected: "Affected users", change: "Proposed change", verification: "Verification",
    owner: "Owner", residual: "Residual limitation", evidence: "Review details and next checks", none: "Not recorded",
    candidate: "AI/automated screening candidate (unverified)", genericPending: "Requirements without a recorded pending reason", commonPending: "Shared follow-up",
    remaining: "Remaining not-run requirements"
  };
}

export function provenanceCounts(presentation) {
  const counts = { human_review: 0, screening: 0, not_run: 0 };
  for (const row of presentation.rows) {
    if (Object.hasOwn(counts, row.source_kind)) counts[row.source_kind] += 1;
  }
  return counts;
}

export function readerOverview(presentation) {
  const text = readerText(presentation.locale);
  const counts = provenanceCounts(presentation);
  const total = presentation.rows.length;
  const request = presentation.inspection_request;
  const intake = inspectionText(presentation.locale);
  return [
    [text.target, presentation.target?.name ?? text.none],
    ...(request ? [[intake.mode, intake[request.mode]], [intake.purpose, request.purpose]] : []),
    [text.scope, presentation.scope?.included?.join(", ") || text.none],
    ...(request ? [[intake.progress, inspectionCompletion(presentation).summary]] : []),
    [text.overall, presentation.messages.outcomes[presentation.overall_outcome]],
    [text.human, `${counts.human_review}/${total}`],
    [text.screening, `${counts.screening}/${total}`],
    [text.notRun, `${counts.not_run}/${total}`]
  ];
}

function relatedRows(finding, rows) {
  const ids = [finding.requirement_id, ...(finding.requirement_ids ?? []), ...(finding.related_requirement_ids ?? [])];
  // A screening finding must not inherit a later human judgement for the same criterion.
  return rows.filter((row) => ids.includes(row.requirement_id)
    && (finding.evidence_status !== "Unverified screening candidate"
      || (row.source_kind === "screening" && row.screening_requirement_id === finding.requirement_id)));
}

export function readerActions(presentation) {
  const text = readerText(presentation.locale);
  const covered = new Set();
  const actions = (presentation.findings ?? []).map((finding) => {
    const rows = relatedRows(finding, presentation.rows);
    rows.forEach((row) => covered.add(row.requirement_id));
    return { finding, rows, title: finding.issue ?? finding.observation ?? finding.rationale ?? text.key };
  });
  for (const row of presentation.rows) {
    if (!covered.has(row.requirement_id) && ["fail", "cant_tell"].includes(row.outcome)) {
      actions.push({ finding: {}, rows: [row], title: `${row.success_criterion} ${row.title}` });
    }
  }
  const rank = (action) => ({ P0: 0, P1: 1, P2: 2, P3: 3 })[action.finding.priority] ?? 4;
  return actions.sort((a, b) => rank(a) - rank(b));
}

export function actionItems(action, presentation) {
  const text = readerText(presentation.locale);
  const { finding, rows } = action;
  const linkedRows = presentation.rows.filter((row) => finding.related_requirement_ids?.includes(row.requirement_id));
  const ids = [...new Set([...rows, ...linkedRows].map((row) => row.success_criterion).concat(finding.requirement_id, finding.requirement_ids ?? []).filter(Boolean))];
  const judgement = finding.evidence_status === "Unverified screening candidate" ? text.candidate
    : rows.map((row) => `${row.outcome_label} / ${row.source_label}`).join("; ") || text.none;
  const hasFinding = Object.keys(finding).length > 0;
  const location = finding.location || rows.flatMap((row) => row.evidence ?? []).map((item) => item.location).filter(Boolean).join("; ");
  return [
    ...(hasFinding ? [[text.priority, finding.priority ?? text.unprioritized]] : []),
    [text.criterion, ids.join(", ") || text.none],
    [text.judgement, judgement],
    [text.location, location || text.none],
    ...(hasFinding ? [
    [text.affected, (Array.isArray(finding.affected_users) ? finding.affected_users.join(", ") : finding.affected_users) || text.none],
    [text.change, finding.proposed_change ?? finding.remediation ?? text.none],
    [text.verification, finding.verification ?? text.none],
    ] : []),
    ...(finding.owner ? [[text.owner, finding.owner]] : []),
    ...(finding.residual_limitation ? [[text.residual, finding.residual_limitation]] : []),
    ...(finding.review_records?.length ? finding.review_records : rows)
      .map((row) => [text.evidence, reviewDetailLines(row, presentation.locale).join("\n")])
  ];
}

export function pendingGroups(presentation) {
  const covered = new Set(readerActions(presentation).flatMap((action) => action.rows.map((row) => row.requirement_id)));
  const groups = new Map();
  for (const row of presentation.rows) {
    if (covered.has(row.requirement_id)) continue;
    if (!["not_tested", "cant_tell"].includes(row.outcome) && !row.review_details?.reason && !row.review_details?.next_checks?.length) continue;
    const explicit = Boolean(row.evidence?.length || row.review_details || (row.rationale?.trim()
      && row.rationale !== presentation.messages.text.noEvidence && !/^Not yet evaluated\./u.test(row.rationale)));
    // Unperformed catalog rows share a short follow-up instead of filling the summary with 55 copies.
    const lines = reviewDetailLines(row, presentation.locale);
    const details = explicit ? lines : lines.slice(2);
    const key = JSON.stringify([explicit, details]);
    const group = groups.get(key) ?? { explicit, rows: [], lines: details };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.explicit) - Number(a.explicit));
}

export function escapeReaderMarkdown(value) {
  return String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\").replace(/([`*_{}\[\]()#+!|])/gu, "\\$1").replace(/\r\n|[\r\n]/gu, "<br>");
}

export function pendingTitle(group, locale) {
  const text = readerText(locale);
  return group.rows.length <= 3 ? group.rows.map((row) => `${row.success_criterion} ${row.title}`).join(", ")
    : group.explicit ? text.commonPending : text.genericPending;
}

export function readerOverviewMarkdown(presentation) {
  const text = readerText(presentation.locale);
  return [...readerOverview(presentation).map(([label, value]) => `- ${label}: ${escapeReaderMarkdown(value)}`), "", text.coverageNote].join("\n");
}

export function readerInspectionMarkdown(presentation) {
  const request = presentation.inspection_request;
  if (!request) return "";
  const text = inspectionText(presentation.locale);
  const progress = inspectionCompletion(presentation);
  return [
    `## ${text.heading}`, "", text.notice, "",
    `### ${text.deliverables}`, "", ...request.deliverables.map((key) => `- ${escapeReaderMarkdown(text[key])}`), "",
    `### ${text.criteria}`, "", text.progressNotice, "",
    ...progress.criteria.map((item) => `- **${escapeReaderMarkdown(text[item.key])} — ${escapeReaderMarkdown(item.status)}**\n\n  ${escapeReaderMarkdown(item.detail)}\n\n  ${text.next}: ${escapeReaderMarkdown(item.next)}`), "",
    `<details><summary>${text.records} (${progress.records.length})</summary>`, "",
    ...progress.records.map((record, index) => `#### ${index + 1}. ${escapeReaderMarkdown(record.evidence?.[0]?.location || record.profile_requirement_id || record.requirement_id)}\n\n${inspectionRecordLines(record, presentation).map((line) => `- ${escapeReaderMarkdown(line)}`).join("\n")}`), "",
    "</details>"
  ].join("\n");
}

export function readerActionsMarkdown(presentation) {
  const text = readerText(presentation.locale);
  const actions = readerActions(presentation);
  return actions.length ? actions.map((action, index) => [
    `### ${index + 1}. ${escapeReaderMarkdown(action.title)}`, "",
    ...actionItems(action, presentation).map(([label, value]) => `- **${label}**: ${escapeReaderMarkdown(value)}`)
  ].join("\n")).join("\n\n") : text.noActions;
}

export function readerPendingMarkdown(presentation) {
  const text = readerText(presentation.locale);
  const groups = pendingGroups(presentation);
  return groups.length ? groups.map((group) => [
    `- **${escapeReaderMarkdown(pendingTitle(group, presentation.locale))}** (${group.rows.length})`,
    ...(group.explicit && group.rows.length > 3 ? [`  ${text.criterion}: ${escapeReaderMarkdown(group.rows.map((row) => row.success_criterion).join(", "))}`] : []),
    ...group.lines.map((line) => `  ${escapeReaderMarkdown(line)}`)
  ].join("\n\n")).join("\n\n") : text.noPending;
}
