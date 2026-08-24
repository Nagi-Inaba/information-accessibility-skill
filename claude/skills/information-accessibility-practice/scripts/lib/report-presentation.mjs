import {
  groupForRequirement,
  recordsForProfile,
  reportGroups
} from "./profile-registry.mjs";
import {
  fixedClaimWording,
  localizedGroupLabel,
  localizedReportTitle,
  normalizeReportLocale,
  reportMessages
} from "./report-locale.mjs";

const outcomes = ["pass", "fail", "not_applicable", "not_tested", "cant_tell"];
const outcomeRank = { fail: 5, cant_tell: 4, not_tested: 3, not_applicable: 2, pass: 1 };

function emptyCounts() {
  return Object.fromEntries(outcomes.map((outcome) => [outcome, 0]));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function criterionParts(value) {
  return String(value ?? "").split(".").map((part) => Number.parseInt(part, 10));
}

function compareCriteria(left, right) {
  const leftParts = criterionParts(left.success_criterion);
  const rightParts = criterionParts(right.success_criterion);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return String(left.requirement_id).localeCompare(String(right.requirement_id), "en");
}

function resultRationale(result, messages) {
  if (!result) return messages.text.noEvidence;
  if (typeof result.notes === "string" && result.notes.trim().length > 0) {
    if (/^Not yet evaluated\./u.test(result.notes)) return messages.text.noEvidence;
    return result.notes;
  }
  const evidence = (result.evidence ?? [])
    .map((item) => `${item.location}: ${item.observation}`)
    .filter(Boolean)
    .join("; ");
  return evidence || messages.text.noEvidence;
}

function allCatalogRecords(catalog) {
  return Object.values(catalog?.catalogs ?? {}).flat();
}

function titleFor(record, locale, recordsById, recordsByCriterion) {
  const equivalent = record.web_modern_record_id ? recordsById.get(record.web_modern_record_id) : undefined;
  const peers = recordsByCriterion.get(record.success_criterion) ?? [];
  if (locale === "ja") {
    return record.title_ja
      ?? peers.find((item) => item.title_ja)?.title_ja
      ?? record.title_en
      ?? equivalent?.title_en
      ?? record.success_criterion;
  }
  return record.title_en
    ?? equivalent?.title_en
    ?? peers.find((item) => item.title_en)?.title_en
    ?? record.title_ja
    ?? record.success_criterion;
}

function primarySourceFor(record, profile) {
  return record.normative_url
    ?? record.checklist_source_url
    ?? record.profile_source_url
    ?? record.understanding_url
    ?? profile.standards?.[0]?.primary_url
    ?? "";
}

function criterionMetadata(registry, catalog, profileId, locale) {
  const profile = registry.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  const records = recordsForProfile({ profile, catalog });
  const everyRecord = allCatalogRecords(catalog);
  const recordsById = new Map(everyRecord.map((record) => [record.id, record]));
  const recordsByCriterion = new Map();
  for (const record of everyRecord) {
    const bucket = recordsByCriterion.get(record.success_criterion) ?? [];
    bucket.push(record);
    recordsByCriterion.set(record.success_criterion, bucket);
  }
  const metadata = records.map((record) => ({
    requirement_id: record.id,
    success_criterion: record.success_criterion,
    title: titleFor(record, locale, recordsById, recordsByCriterion),
    level: record.level,
    group_id: groupForRequirement(profile, record.id),
    primary_url: primarySourceFor(record, profile)
  }));
  const byId = new Map(metadata.map((item) => [item.requirement_id, item]));
  const ordered = profile.requirement_ids.map((id) => byId.get(id)).filter(Boolean);
  return { profile, metadata: ordered };
}

function countRows(rows) {
  const counts = emptyCounts();
  for (const row of rows) {
    if (!Object.hasOwn(counts, row.outcome)) throw new Error(`Unknown report outcome: ${String(row.outcome)}`);
    counts[row.outcome] += 1;
  }
  return counts;
}

function overallOutcome(counts) {
  if (counts.fail > 0) return "fail";
  if (counts.cant_tell > 0) return "cant_tell";
  if (counts.not_tested > 0) return "not_tested";
  if (counts.pass > 0 || counts.not_applicable > 0) return "pass";
  return "not_tested";
}

function selectScreeningCandidate(current, candidate) {
  if (!current) return candidate;
  const currentRank = outcomeRank[current.report_outcome] ?? 0;
  const candidateRank = outcomeRank[candidate.report_outcome] ?? 0;
  return candidateRank > currentRank ? candidate : current;
}

function buildGroups({ profile, rows, locale }) {
  const configured = reportGroups(profile);
  return configured.map((group) => {
    const groupRows = rows.filter((row) => row.group_id === group.id).sort(compareCriteria);
    return {
      id: group.id,
      label: localizedGroupLabel(group.id, locale),
      expected_count: groupRows.length,
      counts: countRows(groupRows),
      rows: groupRows
    };
  });
}

function localizedClaimReasons(validation, humanReviewed, expected, messages) {
  const reasons = [];
  if (humanReviewed === 0) reasons.push(messages.text.requestedReasonNone);
  else if (humanReviewed < expected) reasons.push(messages.text.requestedReasonPartial);
  const blockers = validation?.guard?.profile_blocking_outcomes ?? validation?.guard?.blocking_outcomes ?? [];
  if (blockers.length > 0) reasons.push(`${messages.text.blockerPrefix}: ${blockers.join(", ")}.`);
  const missing = validation?.guard?.catalog_coverage?.missing_ids ?? [];
  if (missing.length > 0) reasons.push(`${messages.text.missingPrefix}: ${missing.length}.`);
  return [...new Set(reasons)];
}

function buildClaim({ assessment, validation, registry, locale, rows }) {
  const requested = assessment.claim?.requested_tier ?? "reference_only";
  const maximum = validation?.guard?.max_tier ?? "reference_only";
  const humanReviewed = rows.filter((row) => row.source_kind === "human_review").length;
  return {
    requested_tier: requested,
    maximum_tier: maximum,
    wording: fixedClaimWording(registry, requested, locale),
    human_reviewed: humanReviewed,
    expected: rows.length,
    reasons: localizedClaimReasons(validation, humanReviewed, rows.length, reportMessages(locale))
  };
}

function commonPresentation({ assessment, validation, registry, locale, rows, target, scope, environment, evaluator, limitations, findings }) {
  const normalizedLocale = normalizeReportLocale(locale);
  const messages = reportMessages(normalizedLocale);
  const profileId = assessment.profile.id;
  const profile = registry.profiles.find((item) => item.id === profileId);
  const groups = buildGroups({ profile, rows, locale: normalizedLocale });
  const counts = countRows(rows);
  return {
    schema_version: "1.0.0",
    locale: normalizedLocale,
    title: localizedReportTitle(profileId, normalizedLocale),
    profile: {
      id: profileId,
      display_name: profile.display_name
    },
    target: clone(target),
    scope: clone(scope),
    environment: clone(environment),
    evaluated_at: assessment.evaluated_at,
    evaluator: evaluator ?? null,
    evidence_level: assessment.evidence_level,
    rows: [...rows].sort(compareCriteria),
    groups,
    counts,
    overall_outcome: overallOutcome(counts),
    claim: buildClaim({ assessment, validation, registry, locale: normalizedLocale, rows }),
    limitations: clone(limitations ?? []),
    findings: clone(findings ?? []),
    has_screening_projection: rows.some((row) => row.source_kind === "screening"),
    messages
  };
}

export function buildStandalonePresentation({ record, validation, registry, catalog, locale = "ja" }) {
  if (!validation?.valid) throw new Error("Assessment record must pass validation before report presentation is built.");
  const assessment = record.assessment;
  const normalizedLocale = normalizeReportLocale(locale);
  const messages = reportMessages(normalizedLocale);
  const { metadata } = criterionMetadata(registry, catalog, assessment.profile.id, normalizedLocale);
  const resultById = new Map((assessment.results ?? [])
    .filter((result) => result.requirement_kind === "profile_requirement")
    .map((result) => [result.requirement_id, result]));
  const rows = metadata.map((item) => {
    const result = resultById.get(item.requirement_id);
    const humanReviewed = result?.mapping_status === "human_verified";
    const outcome = result?.outcome ?? "not_tested";
    const sourceKind = humanReviewed ? "human_review" : "not_run";
    const evidenceLevel = humanReviewed ? "E2" : "E0";
    return {
      ...item,
      group_label: localizedGroupLabel(item.group_id, normalizedLocale),
      outcome,
      outcome_label: messages.outcomes[outcome],
      source_kind: sourceKind,
      source_label: messages.sources[sourceKind],
      evidence_level: evidenceLevel,
      rationale: resultRationale(result, messages),
      applicability: outcome === "not_applicable" ? "not_applicable" : humanReviewed ? "applicable" : "undetermined"
    };
  });
  return commonPresentation({
    assessment,
    validation,
    registry,
    locale: normalizedLocale,
    rows,
    target: assessment.target,
    scope: assessment.scope,
    environment: assessment.environment,
    evaluator: assessment.evaluator,
    limitations: assessment.limitations,
    findings: assessment.findings
  });
}

export function buildRunBackedPresentation({ run, assessment: assessmentRecord, validation, publicModel, registry, catalog, locale = "ja" }) {
  if (!validation?.valid) throw new Error("Run-backed assessment must pass validation before report presentation is built.");
  const assessment = assessmentRecord.assessment;
  const normalizedLocale = normalizeReportLocale(locale);
  const messages = reportMessages(normalizedLocale);
  const { metadata } = criterionMetadata(registry, catalog, run.profile.id, normalizedLocale);
  const checks = [...(publicModel.reportChecks ?? []), ...(publicModel.notApplicableChecks ?? [])];
  const checkById = new Map(checks.map((item) => [item.requirement_id, item]));
  const humanById = new Map((publicModel.recordedHumanChecks ?? []).map((item) => [item.requirement_id, item]));
  const screeningByProfileId = new Map();
  for (const candidate of publicModel.screeningCandidates ?? []) {
    const requirementId = candidate.profile_requirement_id;
    if (!requirementId) continue;
    screeningByProfileId.set(requirementId, selectScreeningCandidate(screeningByProfileId.get(requirementId), candidate));
  }
  const rows = metadata.map((item) => {
    const check = checkById.get(item.requirement_id) ?? {
      outcome: "not_tested",
      rationale: messages.text.noEvidence,
      applicability: "undetermined"
    };
    const human = humanById.get(item.requirement_id);
    const screening = screeningByProfileId.get(item.requirement_id);
    const sourceKind = human ? "human_review" : screening ? "screening" : "not_run";
    const evidenceLevel = human ? "E2" : screening ? (screening.evidence_level ?? "E1") : "E0";
    return {
      ...item,
      group_label: localizedGroupLabel(item.group_id, normalizedLocale),
      outcome: check.outcome,
      outcome_label: messages.outcomes[check.outcome],
      source_kind: sourceKind,
      source_label: messages.sources[sourceKind],
      evidence_level: evidenceLevel,
      rationale: check.rationale || messages.text.noEvidence,
      applicability: check.applicability ?? (check.outcome === "not_applicable" ? "not_applicable" : "undetermined")
    };
  });
  return commonPresentation({
    assessment,
    validation,
    registry,
    locale: normalizedLocale,
    rows,
    target: publicModel.target,
    scope: publicModel.scope,
    environment: publicModel.environment,
    evaluator: null,
    limitations: publicModel.limitations,
    findings: publicModel.remediation
  });
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\r\n|[\r\n]/gu, "<br>")
    .replace(/\|/gu, "\\|")
    .trim();
}

function markdownTable(headers, rows, emptyText) {
  if (rows.length === 0) return emptyText;
  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`)
  ].join("\n");
}

function renderCounts(counts, messages) {
  return markdownTable(
    [messages.fields.result, messages.fields.count],
    outcomes.map((outcome) => [messages.outcomes[outcome], counts[outcome]]),
    messages.text.noRecord
  );
}

function renderCriterionTable(rows, messages) {
  return markdownTable(
    [
      messages.fields.criterion,
      messages.fields.title,
      messages.fields.level,
      messages.fields.group,
      messages.fields.outcome,
      messages.fields.source,
      messages.fields.evidence,
      messages.fields.primarySource,
      messages.fields.rationale
    ],
    rows.map((row) => [
      row.success_criterion,
      row.title,
      row.level,
      row.group_label,
      row.outcome_label,
      row.source_label,
      row.evidence_level,
      row.primary_url,
      row.rationale
    ]),
    messages.text.noRecord
  );
}

function renderFindings(findings, messages) {
  if (!findings?.length) return messages.text.noFindings;
  const rows = findings.map((finding) => [
    finding.priority ?? "",
    finding.requirement_id ?? finding.requirement_ids?.join(", ") ?? "",
    finding.location ?? "",
    finding.issue ?? finding.observation ?? "",
    finding.proposed_change ?? finding.remediation ?? "",
    finding.verification ?? ""
  ]);
  return markdownTable(
    messages.locale === "ja"
      ? ["優先度", "達成基準・検査項目", "箇所", "問題", "改善案", "再確認方法"]
      : ["Priority", "Requirement or check", "Location", "Issue", "Remediation", "Verification"],
    rows,
    messages.text.noFindings
  );
}

function listValue(values, messages) {
  return Array.isArray(values) && values.length ? values.join(", ") : messages.text.noRecord;
}

export function renderReportMarkdown(presentation) {
  const messages = presentation.messages;
  const lines = [
    `# ${presentation.title}`,
    "",
    `> ${messages.text.reportNotice}`,
    "",
    `## ${messages.headings.summary}`,
    "",
    `- ${messages.text.judgementLabel}: ${messages.outcomes[presentation.overall_outcome]}`,
    `- ${messages.text.profileCountLabel}: ${presentation.rows.length}`,
    "",
    renderCounts(presentation.counts, messages),
    "",
    `## ${messages.headings.legend}`,
    "",
    `- ${messages.sources.human_review}: ${messages.text.provenanceHuman}`,
    `- ${messages.sources.screening}: ${messages.text.provenanceScreening}`,
    `- ${messages.sources.not_run}: ${messages.text.provenanceNotRun}`,
    ...(presentation.has_screening_projection ? ["", `> ${messages.text.screeningLegend}`] : []),
    "",
    `## ${messages.headings.claim}`,
    "",
    `- ${messages.fields.requestedTier}: \`${presentation.claim.requested_tier}\``,
    `- ${messages.fields.maximumTier}: \`${presentation.claim.maximum_tier}\``,
    `- ${messages.fields.fixedWording}: ${presentation.claim.wording}`,
    `- ${messages.fields.humanCoverage}: ${presentation.claim.human_reviewed}/${presentation.claim.expected}`,
    ...presentation.claim.reasons.map((reason) => `- ${reason}`),
    `- ${messages.text.formalBoundary}`,
    "",
    `## ${messages.headings.target}`,
    "",
    `- ${messages.fields.target}: ${markdownCell(presentation.target?.name ?? messages.text.noRecord)}`,
    `- ${messages.fields.version}: ${markdownCell(presentation.target?.version_or_commit ?? messages.text.noRecord)}`,
    `- ${messages.fields.references}: ${markdownCell(listValue(presentation.target?.urls_or_files, messages))}`,
    `- ${messages.fields.profile}: \`${presentation.profile.id}\``,
    `- ${messages.fields.date}: ${markdownCell(presentation.evaluated_at)}`,
    ...(presentation.evaluator ? [`- ${messages.fields.evaluator}: ${markdownCell(presentation.evaluator)}`] : []),
    `- ${messages.fields.evidenceLevel}: ${markdownCell(presentation.evidence_level)}`,
    ""
  ];

  for (const group of presentation.groups) {
    const open = presentation.locale === "ja" ? "（" : " (";
    const close = presentation.locale === "ja" ? "）" : ")";
    lines.push(
      `## ${group.label}${open}${group.expected_count}${close}`,
      "",
      renderCounts(group.counts, messages),
      "",
      renderCriterionTable(group.rows, messages),
      ""
    );
    if (presentation.profile.id === "jp-public-web" && group.id === "jis_x_8341_3_2016") {
      lines.push(`> ${messages.text.parsingNote}`, "");
    }
  }

  lines.push(
    `## ${messages.headings.findings}`,
    "",
    renderFindings(presentation.findings, { ...messages, locale: presentation.locale }),
    "",
    `## ${messages.headings.scope}`,
    "",
    `- ${messages.fields.included}: ${markdownCell(listValue(presentation.scope?.included, messages))}`,
    `- ${messages.fields.excluded}: ${markdownCell(listValue(presentation.scope?.excluded, messages))}`,
    `- ${messages.fields.processes}: ${markdownCell(listValue(presentation.scope?.complete_processes, messages))}`,
    `- ${messages.fields.thirdParty}: ${markdownCell(listValue(presentation.scope?.third_party_content, messages))}`,
    `- ${messages.fields.fullPages}: ${presentation.scope?.full_pages_reviewed ? messages.text.yes : messages.text.no}`,
    `- ${messages.fields.os}: ${markdownCell(listValue(presentation.environment?.os, messages))}`,
    `- ${messages.fields.browsers}: ${markdownCell(listValue(presentation.environment?.browsers, messages))}`,
    `- ${messages.fields.assistiveTechnologies}: ${markdownCell(listValue(presentation.environment?.assistive_technologies, messages))}`,
    `- ${messages.fields.inputModes}: ${markdownCell(listValue(presentation.environment?.input_modes, messages))}`,
    "",
    `## ${messages.headings.coverage}`,
    "",
    `- ${messages.fields.catalogCoverage}: ${presentation.rows.length}/${presentation.claim.expected}`,
    `- ${messages.fields.humanCoverage}: ${presentation.claim.human_reviewed}/${presentation.claim.expected}`,
    `- ${messages.fields.evidenceLevel}: ${markdownCell(presentation.evidence_level)}`,
    "",
    `## ${messages.headings.limitations}`,
    "",
    ...(presentation.limitations?.length
      ? presentation.limitations.map((limitation) => `- ${markdownCell(limitation)}`)
      : [`- ${messages.text.noLimitations}`])
  );

  return `${lines.join("\n").trimEnd()}\n`;
}
