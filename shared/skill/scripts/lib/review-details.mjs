const requiredChecks = {
  "1.4.4": "text_resize_200",
  "2.4.1": "skip_link_navigation"
};

const messages = {
  ja: {
    observation: "観測・根拠", performed: "実施した検査", reason: "確認が残る理由", next: "次の確認",
    location: "箇所", method: "記録した検査方法", captured: "記録日時", rationale: "判定理由",
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
    location: "Location", method: "Recorded test method", captured: "Captured at", rationale: "Judgement rationale",
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

// Keep every observation behind a criterion. Different locations or methods can
// disagree; severity ordering must not silently discard their evidence.
export function screeningMappings(observation) {
  if (Array.isArray(observation.profile_mappings)) return observation.profile_mappings;
  return observation.profile_requirement_id ? [{ requirement_id: observation.profile_requirement_id,
    report_outcome: observation.report_outcome, applicability: observation.applicability, rationale: observation.report_rationale }] : [];
}

export function screeningProjections(observation) {
  return screeningMappings(observation).map((mapping) => guardScreeningProjection({ ...observation,
    profile_requirement_id: mapping.requirement_id, report_outcome: mapping.report_outcome,
    applicability: mapping.applicability, report_rationale: mapping.rationale }));
}

export function groupScreeningProjections(observations) {
  const groups = new Map();
  for (const observation of observations.flatMap(screeningProjections)) {
    const group = groups.get(observation.profile_requirement_id) ?? { observations: [] };
    if (!group.observations.some((item) => item.requirement_id === observation.requirement_id)) group.observations.push(observation);
    groups.set(observation.profile_requirement_id, group);
  }
  for (const group of groups.values()) {
    const outcomes = new Set(group.observations.map((item) => item.report_outcome));
    const applicability = new Set(group.observations.map((item) => item.applicability));
    group.conflicts = [...(outcomes.size > 1 ? ["report_outcome"] : []), ...(applicability.size > 1 ? ["applicability"] : [])];
    group.report_outcome = group.conflicts.length ? "cant_tell" : group.observations[0].report_outcome;
    group.applicability = applicability.size > 1 ? "undetermined" : group.observations[0].applicability;
    group.report_rationale = group.observations.length === 1 ? group.observations[0].report_rationale
      : group.observations.map((item) => `${item.location}: ${item.report_rationale}`).join("\n");
  }
  return groups;
}

export function screeningConflictReason(conflicts, locale = "ja") {
  if (!conflicts?.length) return "";
  const labels = locale === "ja" ? { report_outcome: "判定候補", applicability: "適用判断" }
    : { report_outcome: "outcome", applicability: "applicability" };
  return locale === "ja" ? `観測間で${conflicts.map((key) => labels[key]).join("・")}が一致しません。箇所・状態・根拠を人が確認してください。`
    : `Observations disagree on ${conflicts.map((key) => labels[key]).join(" and ")}. Review their locations, states and evidence.`;
}

export function screeningReviewRecord(observation) {
  return { requirement_id: observation.profile_requirement_id ?? observation.requirement_id,
    outcome: observation.applicability === "not_applicable" ? "not_applicable" : observation.report_outcome,
    applicability: observation.applicability, rationale: observation.report_rationale,
    evidence: [{ location: observation.location, method: observation.method, observation: observation.observation, captured_at: observation.captured_at }],
    ...(observation.review_details ? { review_details: structuredClone(observation.review_details) } : {}) };
}

// Keep one inspection record per source observation, with each criterion's
// decision visible inside it; evidence is stored only on the source.
export function screeningInspectionRecord(observation) {
  const projections = screeningProjections(observation);
  const records = projections.map(screeningReviewRecord);
  const outcomes = new Set(records.map((record) => record.outcome));
  return { requirement_id: observation.requirement_id,
    profile_requirement_id: projections.length === 1 ? projections[0].profile_requirement_id : null,
    outcome: outcomes.size === 1 ? [...outcomes][0] : (observation.report_outcome ?? "cant_tell"),
    source_kind: "screening", evidence_level: observation.evidence_level,
    rationale: observation.report_rationale ?? observation.observation,
    evidence: screeningReviewRecord(observation).evidence, review_details: observation.review_details,
    ...(projections.length ? { screening_observations: records.map((record) => projections.length > 1
      ? { ...record, rationale: `${record.requirement_id}: ${record.rationale}` } : record) } : {}) };
}

export function reviewDetailLines(row, locale = "ja") {
  if (row.human_reviews?.length) {
    const ja = locale !== "en", states = ja ? { single_review: "単独レビュー", agreement: "全員の結果が一致", unresolved_disagreement: "不一致・未解決" }
      : { single_review: "Single review", agreement: "Unanimous agreement", unresolved_disagreement: "Unresolved disagreement" };
    return [ja ? `人手レビューの集約: ${states[row.review_consensus]}` : `Human review resolution: ${states[row.review_consensus]}`,
      ...row.human_reviews.flatMap((review) => [
        `${ja ? "レビュー" : "Review "}${review.number}: ${review.state === "active" ? (ja ? "有効" : "active") : (ja ? "更新前" : "superseded")} / ${review.outcome}`,
        `${review.reviewer_name}${review.reviewer_role ? " / " + review.reviewer_role : ""} / ${review.review_date}`,
        ...(review.supersedes ? [ja ? `レビュー${review.supersedes}を訂正` : `Supersedes review ${review.supersedes}`] : []),
        `${ja ? "手順" : "Procedure"}: ${review.procedure}`,
        ...reviewDetailLines(review, locale),
        ...(review.findings ?? []).map((finding) => `${ja ? "このレビューの指摘" : "This review's finding"}: ${finding.priority} / ${finding.location} / ${finding.observation}`)
      ]),
      ...(row.review_consensus === "unresolved_disagreement" ? [ja
        ? "次の確認: 確認者間で証拠と判定理由を照合し、訂正が必要な確認者が元のレビューIDを指定して再提出する。"
        : "Next check: compare the reviewers' evidence and rationale; reviewers who revise their judgement must submit an explicit superseding review."] : [])];
  }
  if (row.screening_observations?.length) return [
    ...(row.screening_conflicts?.length ? [screeningConflictReason(row.screening_conflicts, locale)] : []),
    ...row.screening_observations.flatMap((observation) => reviewDetailLines(observation, locale))
  ];
  const text = messages[locale] ?? messages.ja;
  const details = row.review_details;
  const pending = ["not_tested", "cant_tell"].includes(row.outcome);
  const evidence = row.evidence ?? [];
  if (!details && !pending && !evidence.length) return [row.rationale];
  const checks = details?.performed_checks ?? [];
  const lines = evidence.length ? evidence.flatMap((item) => [
    ...(item.location ? [`${text.location}: ${item.location}`] : []),
    ...(item.method ? [`${text.method}: ${item.method}`] : []),
    ...(item.observation ? [`${text.observation}: ${item.observation}`] : []),
    ...(item.captured_at ? [`${text.captured}: ${item.captured_at}`] : [])
  ]) : [`${text.observation}: ${row.rationale}`];
  if (evidence.length && row.rationale) lines.push(`${text.rationale}: ${row.rationale}`);
  if (checks.length || !evidence.length) lines.push(`${text.performed}: ${checks.length ? checks.map((check) =>
    `${text.checks[check.id]} ${text[check.outcome]} / ${check.environment} / ${check.evidence}`).join("; ") : text.noPerformed}`);
  if (pending || details?.reason || details?.next_checks?.length) {
    lines.push(`${text.reason}: ${text[details?.reason] ?? text.unknown}`);
    const next = details?.next_checks?.length ? details.next_checks : [text[requiredCheck(row.requirement_id)] ?? text.defaultNext];
    lines.push(...next.map((step) => `${text.next}: ${step}`));
  }
  return lines;
}
