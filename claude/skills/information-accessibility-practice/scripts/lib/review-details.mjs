const requiredChecks = {
  "1.4.4": "text_resize_200",
  "2.4.1": "skip_link_navigation"
};

const messages = {
  ja: {
    observation: "観測・根拠", performed: "実施した検査", reason: "確認が残る理由", next: "次の確認",
    unknown: "理由の記録なし", test_not_run: "検査未実施", applicability_pending: "適用条件の確認待ち",
    meaning_review: "意味の確認待ち", scope_incomplete: "対象範囲の不足", evidence_incomplete: "必要な検査記録が不足",
    noPerformed: "構造化した検査記録なし", defaultNext: "一次資料の適用条件と検査手順を確認し、対象固有の証拠を記録する。",
    checks: { text_resize_200: "200%文字拡大", skip_link_navigation: "スキップリンクの移動" },
    text_resize_200: "200%まで拡大し、内容や機能の欠落がないかを記録する。",
    skip_link_navigation: "スキップリンクを起動し、移動先と次のTab移動先を記録する。読み上げ位置は支援技術で別途確認する。",
    pass: "確認済み", fail: "問題を観測", cant_tell: "確認未完了"
  },
  en: {
    observation: "Observation / rationale", performed: "Performed checks", reason: "Pending reason", next: "Next check",
    unknown: "Reason not recorded", test_not_run: "Test not performed", applicability_pending: "Applicability pending",
    meaning_review: "Meaning review pending", scope_incomplete: "Scope incomplete", evidence_incomplete: "Required test evidence missing",
    noPerformed: "No structured test record", defaultNext: "Check applicability and the primary-source test procedure, then record target-specific evidence.",
    checks: { text_resize_200: "Text resize to 200%", skip_link_navigation: "Skip-link navigation" },
    text_resize_200: "Resize text up to 200% and record whether content or functionality is lost.",
    skip_link_navigation: "Activate the skip link and record its destination and the next Tab destination. Verify reading position separately with assistive technology.",
    pass: "Checked", fail: "Issue observed", cant_tell: "Incomplete"
  }
};

function requiredCheck(requirementId) {
  return requiredChecks[String(requirementId).match(/-SC-(\d+\.\d+\.\d+)$/u)?.[1]];
}

function completeCheck(check) {
  return check.outcome === "pass" && Boolean(check.environment?.trim()) && Boolean(check.evidence?.trim());
}

// This checks the completeness of declared test records, not their authenticity.
// It changes only the report projection; saved artifacts and profile outcomes stay intact.
export function guardScreeningProjection(observation) {
  if (observation.report_outcome !== "pass") return observation;
  const details = observation.review_details;
  const checks = details?.performed_checks ?? [];
  const required = requiredCheck(observation.profile_requirement_id);
  const missing = required && (observation.evidence_level !== "E1" || !checks.some((check) => check.id === required && completeCheck(check)));
  const incomplete = checks.some((check) => !completeCheck(check));
  if (!missing && !incomplete && !(details?.next_checks?.length) && !details?.reason) return observation;
  return {
    ...observation,
    report_outcome: "cant_tell",
    review_details: {
      reason: details?.reason ?? "evidence_incomplete",
      performed_checks: checks,
      next_checks: details?.next_checks ?? []
    }
  };
}

export function reviewDetailLines(row, locale = "ja") {
  const text = messages[locale] ?? messages.ja;
  const details = row.review_details;
  const pending = ["not_tested", "cant_tell"].includes(row.outcome);
  if (!details && !pending) return [row.rationale];
  const checks = details?.performed_checks ?? [];
  const lines = [`${text.observation}: ${row.rationale}`];
  lines.push(`${text.performed}: ${checks.length ? checks.map((check) =>
    `${text.checks[check.id]} ${text[check.outcome]} / ${check.environment} / ${check.evidence}`).join("; ") : text.noPerformed}`);
  if (pending || details?.reason || details?.next_checks?.length) {
    lines.push(`${text.reason}: ${text[details?.reason] ?? text.unknown}`);
    const next = details?.next_checks?.length ? details.next_checks : [text[requiredCheck(row.requirement_id)] ?? text.defaultNext];
    lines.push(...next.map((step) => `${text.next}: ${step}`));
  }
  return lines;
}
