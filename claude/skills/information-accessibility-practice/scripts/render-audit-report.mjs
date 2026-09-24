import fs from "node:fs";
import { publicQueueItem, queueReviewLines } from "./lib/human-review-queue.mjs";
import { renderSourceNoticesMarkdown } from "./lib/source-provenance.mjs";
import { networkScopeSummary, networkScopeText } from "./lib/network-policy.mjs";
import { interactionScopeSummary, interactionScopeText } from "./lib/interaction-policy.mjs";
import { guardScreeningProjection, groupScreeningProjections, screeningProjections, screeningReviewRecord, reviewDetailLines } from "./lib/review-details.mjs";
import { isIP } from "node:net";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertStableFile,
  loadAuditResources,
  readStableFile,
  validateAuditRun,
  writeNewText
} from "./lib/audit-run.mjs";
import { validateAssessment } from "./validate-assessment.mjs";
import { buildRunFindings, declaredFindings, findingPlanMetadata, remediationPlanItems } from "./lib/run-findings.mjs";
import { reviewEntries, resolveHumanReviews, consensusReviewRows, consensusRemediationItems, reviewHistoryForReport } from "./lib/human-review-consensus.mjs";
import { isHumanReviewMapping, publicReviewerAssurance, reviewerAssuranceText, reviewerVerificationOptions, displayedEvidenceLevel } from "./lib/assessment-provenance.mjs";
import { loadReviewTrust } from "./lib/review-trust-input.mjs";
import { parseAttestationJson } from "./lib/attestation-canonical.mjs";
import { contextArtifacts, projectAuditContext } from "./lib/audit-context.mjs";
import { summarizeParticipantObservations } from "./lib/participant-observation.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);
const outcomes = ["pass", "fail", "not_applicable", "not_tested", "cant_tell"];
const priorityOrder = ["P0", "P1", "P2"];
const reportNotice = "> 注意：このレポートでは、改善判断のために「適合」「不適合」などの判定語を使用します。これらは記載した対象・範囲・環境・確認日時・証拠に基づく検査結果であり、第三者認証、法的判断、または組織による正式な適合表明ではありません。";
const outcomeLabels = {
  pass: "適合",
  fail: "不適合",
  not_tested: "未確認",
  cant_tell: "要確認"
};

export function reportJudgementForOutcome(outcome) {
  return outcomeLabels[outcome] ?? null;
}

export function overallReportJudgement(counts = {}) {
  const recorded = outcomes.reduce((total, outcome) => total + count(counts, outcome), 0);
  if (recorded === 0) return "未確認";
  if (count(counts, "fail") > 0) return "不適合";
  if (count(counts, "cant_tell") > 0) return "要確認";
  if (count(counts, "not_tested") > 0) return "未確認";
  return "適合";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readReference(relativePath) {
  return readJson(path.join(skillRoot, "references", relativePath));
}

function cell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]()#+!])/g, "\\$1")
    .replace(/\r\n|[\r\n]/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function list(values) {
  return values?.length ? values.map((value) => `- ${cell(value)}`).join("\n") : "- 記録なし。";
}

function count(counts, outcome) {
  return counts?.[outcome] ?? 0;
}

function outcomeRows(profileCounts, screeningCounts) {
  const labels = { ...outcomeLabels, not_applicable: "適用対象外" };
  return outcomes.map((outcome) => `| ${labels[outcome]} | ${count(profileCounts, outcome)} | ${count(screeningCounts, outcome)} |`).join("\n");
}

function groupRows(groups, groupCounts) {
  const labels = { ...outcomeLabels, not_applicable: "適用対象外" };
  return outcomes.map((outcome) => `| ${labels[outcome]} | ${groups.map((group) => count(groupCounts?.[group.id], outcome)).join(" | ")} |`).join("\n");
}

function findingTable(findings) {
  if (findings.length === 0) return "該当する指摘はありません。";
  return [
    "| ID | 達成基準 | 箇所 | 影響を受ける利用者 | 確認内容 | 改善案 | 再確認方法 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map((finding) => [
      finding.id,
      finding.requirement_ids.join(", "),
      finding.location,
      finding.affected_users.join(", "),
      finding.observation,
      finding.remediation ?? "改善計画は未策定。指摘を基に担当者が計画してください。",
      finding.verification ?? "改善計画の策定後に再確認方法を記録してください。"
    ].map(cell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  ].join("\n");
}

function resultRationale(result) {
  if (result.outcome === "not_tested" && /^Not yet evaluated\./u.test(result.notes ?? "")) {
    return "この検査では確認していません。";
  }
  return result.notes || result.evidence?.map((item) => `${item.location}: ${item.observation}`).join("; ") || "根拠の記録なし";
}

export function renderAuditReport(record, validation) {
  if (!validation?.valid) throw new Error("Assessment record must pass validation before a report can be rendered.");
  const assessment = record.assessment;
  const guard = validation.guard;
  const profileCounts = guard.profile_outcome_counts;
  const referenceGuidance = assessment.claim?.requested_tier === "reference_only";
  const reportTitle = referenceGuidance ? "# WCAG参照ガイダンス" : "# WCAG検査レポート";
  const summaryLabel = referenceGuidance ? "確認状況" : "総合判定";
  const findings = Array.isArray(assessment.findings) ? assessment.findings : [];
  const orderedFindings = priorityOrder.map((priority) => [priority, findings.filter((finding) => finding.priority === priority)]);
  const unlinkedFailures = assessment.results
    .filter((result) => result.outcome === "fail" && !findings.some((finding) => finding.requirement_ids.includes(result.requirement_id)))
    .map((result) => result.requirement_id);
  if (unlinkedFailures.length > 0) {
    throw new Error(`Assessment record has failed results without structured findings: ${unlinkedFailures.join(", ")}`);
  }

  const profileResults = assessment.results.filter((result) => result.requirement_kind === "profile_requirement");
  const judgementRows = profileResults
    .filter((result) => result.outcome !== "not_applicable")
    .map((result) => [
      result.requirement_id,
      reportJudgementForOutcome(result.outcome),
      resultRationale(result)
    ]);
  const notApplicableRows = profileResults
    .filter((result) => result.outcome === "not_applicable")
    .map((result) => [result.requirement_id, result.notes || "適用対象外とした理由の記録なし"]);

  const lines = [
    reportTitle,
    "",
    reportNotice,
    "",
    `- 文書区分: ${referenceGuidance ? "規格参照ガイダンス" : "検査レポート"}`,
    "",
    `## 1. ${summaryLabel}`,
    "",
    `- ${summaryLabel}: ${overallReportJudgement(profileCounts)}`,
    `- 不適合件数: ${count(profileCounts, "fail")}`,
    `- 要確認件数: ${count(profileCounts, "cant_tell")}`,
    `- 未確認件数: ${count(profileCounts, "not_tested")}`,
    `- 適用対象外件数: ${count(profileCounts, "not_applicable")}`,
    "",
    "## 2. 検査対象",
    "",
    `- 対象: ${cell(assessment.target.name)}`,
    `- 版・コミット: ${cell(assessment.target.version_or_commit)}`,
    `- URL・ファイル: ${cell(assessment.target.urls_or_files.length ? assessment.target.urls_or_files.join(", ") : "記録なし")}`,
    `- 適用プロファイル: ${assessment.profile.id}`,
    `- 確認日: ${assessment.evaluated_at}`,
    `- 確認者: ${cell(assessment.evaluator)}`,
    `- 証拠レベル: ${displayedEvidenceLevel(assessment.evidence_level, validation.guard.reviewer_assurance)}`,
    "",
    "## 3. 対象範囲",
    "",
    "### 含む範囲",
    "",
    list(assessment.scope.included),
    "",
    "### 除外した範囲",
    "",
    list(assessment.scope.excluded),
    "",
    "### 一連の利用手順",
    "",
    list(assessment.scope.complete_processes),
    "",
    "### 第三者コンテンツ",
    "",
    list(assessment.scope.third_party_content),
    "",
    `- ページ全体を確認: ${assessment.scope.full_pages_reviewed ? "はい" : "いいえ"}`,
    "",
    "## 4. 検査環境",
    "",
    "| 項目 | 記録内容 |",
    "| --- | --- |",
    `| OS | ${cell(assessment.environment.os.join(", ") || "記録なし")} |`,
    `| ブラウザー・表示環境 | ${cell(assessment.environment.browsers.join(", ") || "記録なし")} |`,
    `| 支援技術 | ${cell(assessment.environment.assistive_technologies.join(", ") || "記録なし")} |`,
    `| 入力方法 | ${cell(assessment.environment.input_modes.join(", ") || "記録なし")} |`,
    "",
    "## 5. 達成基準別の判定",
    "",
    publicTable(["達成基準", "判定", "根拠・未確認事項"], judgementRows, "判定対象の達成基準はありません。"),
    "",
    "### 適用対象外とした達成基準",
    "",
    publicTable(["達成基準", "理由"], notApplicableRows, "適用対象外とした達成基準はありません。"),
    "",
    "## 6. 指摘事項",
    ""
  ];

  for (const [priority, priorityFindings] of orderedFindings) {
    lines.push(`### ${priority}`, "", findingTable(priorityFindings), "");
  }
  lines.push(
    "## 7. 判定件数",
    "",
    "| 結果 | 登録済み達成基準 | 補助的なスクリーニング |",
    "| --- | ---: | ---: |",
    outcomeRows(profileCounts, guard.screening_outcome_counts),
    "",
    `- 登録件数: ${guard.catalog_coverage.recorded}/${guard.catalog_coverage.expected}`,
    `- 人手レビューの申告件数: ${guard.evaluation_coverage.human_declared}`,
    `- ${reviewerAssuranceText(guard.reviewer_assurance, "ja")}`,
    `- 主張可能な範囲: ${guard.assured_claim_wording.ja}`,
    ""
  );

  const reportGroups = guard.report_groups ?? [];
  if (reportGroups.length > 1) {
    lines.push(
      "### 達成基準の区分別件数",
      "",
      `| 結果 | ${reportGroups.map((group) => cell(group.label)).join(" | ")} |`,
      `| --- | ${reportGroups.map(() => "---:").join(" | ")} |`,
      groupRows(reportGroups, guard.profile_group_outcome_counts),
      ""
    );
  }

  lines.push(
    "## 8. 参加のしやすさに関する確認",
    "",
    "| 観点 | 結果 |",
    "| --- | --- |",
    ...["find", "receive", "understand", "participate", "continue"].map((gate) => `| ${gate} | ${assessment.participation_coverage[gate]} |`),
    "",
    "## 9. 制約と残る確認事項",
    "",
    list(assessment.limitations),
    "- 結果は、記載した対象の版と範囲を越えて適用しません。",
    "",
    "## 10. 改善と再確認",
    "",
    findings.length ? "各指摘事項の改善案と再確認方法を使用します。" : "- 改善項目の記録はありません。",
    assessment.next_review_at ? `- 次回確認日: ${assessment.next_review_at}` : "- 次回確認日: 記録なし。",
    ...(assessment.next_review_condition ? [`- 再確認条件: ${cell(assessment.next_review_condition)}`] : []),
    ...(assessment.next_review_owner ? [`- 担当者: ${cell(assessment.next_review_owner)}`] : []),
    `- 独立監査の申告: ${assessment.assurance.independent_audit.performed ? "はい" : "いいえ"}`,
    ...(assessment.assurance.independent_audit.scope_method ? [`- 監査範囲と方法: ${cell(assessment.assurance.independent_audit.scope_method)}`] : []),
    ...(assessment.assurance.independent_audit.report_location ? [`- 監査報告の所在: ${cell(assessment.assurance.independent_audit.report_location)}`] : []),
    `- 資料整備の申告: ${assessment.assurance.legal_or_procurement_dossier.prepared ? "はい" : "いいえ"}`,
    ...(assessment.assurance.legal_or_procurement_dossier.responsible_owner ? [`- 資料担当者: ${cell(assessment.assurance.legal_or_procurement_dossier.responsible_owner)}`] : []),
    ...(assessment.assurance.legal_or_procurement_dossier.artifacts.length ? [`- 資料: ${cell(assessment.assurance.legal_or_procurement_dossier.artifacts.join(", "))}`] : [])
  );

  return `${lines.join("\n").trimEnd()}\n\n${renderSourceNoticesMarkdown("ja")}`;
}

function parseSnapshotJson(snapshot, label) {
  try {
    return structuredClone(parseAttestationJson(snapshot.bytes));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function envelopeFromRecord(record) {
  return record?.envelope ?? record;
}

function sortedByRequirement(values) {
  return [...values].sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en"));
}

function collectRunEvidence(envelopesById) {
  const queues = [];
  const humanReviews = [];
  const humanSources = [];
  const screeningObservations = [];
  const remediationItems = [];
  for (const record of envelopesById.values()) {
    const envelope = envelopeFromRecord(record);
    if (envelope?.artifact_type === "human-review-queue") queues.push(...(envelope.payload?.items ?? []));
    if (envelope?.artifact_type === "declared-human-review") {
      humanSources.push({ payload: envelope.payload, artifact_id: envelope.artifact_id });
      humanReviews.push(...(envelope.payload?.reviews ?? []).map((review) => ({
        ...review,
        reviewer_name: envelope.payload.reviewer_name,
        review_date: envelope.payload.review_date
      })));
    }
    if (envelope?.artifact_type === "screening-observations") screeningObservations.push(...(envelope.payload?.observations ?? []));
    if (envelope?.artifact_type === "remediation-plan") remediationItems.push(...remediationPlanItems(envelope.payload));
  }
  const resolved = resolveHumanReviews(reviewEntries(humanSources));
  return { queues, humanReviews: consensusReviewRows(resolved), humanReviewHistory: humanReviews, resolved,
    context: projectAuditContext(envelopesById),
    screeningObservations, remediationItems: consensusRemediationItems(resolved, remediationItems) };
}

function uniqueMap(values, key, label) {
  const result = new Map();
  for (const value of values) {
    const id = value?.[key];
    if (result.has(id)) throw new Error(`Run-backed report has duplicate ${label}: ${String(id)}.`);
    result.set(id, value);
  }
  return result;
}

function expectedRunBackedLimitations(evidence, assessmentVersion = "1.0.0") {
  const limitations = [
    "All profile requirements are initialized as not_tested; no accessibility conclusion has been made.",
    "Automated checks, if added, are supporting screening evidence and do not determine requirement outcomes."
  ];
  if (evidence.humanReviews.length > 0) {
    limitations.push(assessmentVersion === "1.0.0" ? "External human reviewer identity was declared but not authenticated (identity_authenticated: false)."
      : "Reviewer identity assurance must be reverified from the portable review records under the recipient's external trust policy; declarations and role labels do not authenticate a person.");
  }
  for (const item of [...evidence.remediationItems]
    .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"))) {
    if (!limitations.includes(item.residual_limitation)) limitations.push(item.residual_limitation);
  }
  limitations.push(...(evidence.context?.limitations ?? []));
  return limitations;
}

function addString(values, value) {
  if (typeof value === "string" && value.length > 0) values.add(value);
}

function collectSchemaIdPatterns(schema, patterns) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const item of schema) collectSchemaIdPatterns(item, patterns);
    return;
  }
  if (typeof schema.pattern === "string" && /(?:RUN|ART)-/u.test(schema.pattern)) {
    patterns.add(schema.pattern.replace(/^\^/u, "").replace(/\$$/u, ""));
  }
  for (const value of Object.values(schema)) collectSchemaIdPatterns(value, patterns);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function containsIdentifierToken(value, token) {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegExp(token)}(?=$|[^A-Za-z0-9_-])`, "u").test(value);
}

function visitStrings(value, location, visit) {
  if (typeof value === "string") {
    visit(value, location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitStrings(item, `${location}[${index}]`, visit));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) visitStrings(item, `${location}.${key}`, visit);
  }
}

function internalControlTerms({ run, envelopesById, resources }) {
  const terms = new Set();
  addString(terms, run.run_id);
  addString(terms, run.supersedes_run_id);
  addString(terms, run.artifact_root);
  for (const key of ["sha256", "target_context_sha256", "environment_sha256"]) addString(terms, run.target_inventory?.[key]);
  for (const snapshot of run.target_inventory?.snapshots ?? []) {
    addString(terms, snapshot.snapshot_id);
    visitStrings(snapshot.identity, "identity", (value, location) => {
      if (/(?:sha256|_oid|head_commit|authentication_state_id|feature_flags)(?:\[\d+\])?$/u.test(location)) addString(terms, value);
    });
    for (const binding of snapshot.evidence_bindings ?? []) addString(terms, binding.sha256);
  }
  for (const artifact of run.artifacts ?? []) {
    addString(terms, artifact.artifact_id);
    addString(terms, artifact.producer_role);
    addString(terms, artifact.path);
  }
  for (const entry of run.history ?? []) {
    addString(terms, entry.actor_role);
    for (const artifactId of entry.artifact_ids ?? []) addString(terms, artifactId);
  }
  for (const record of envelopesById.values()) {
    const envelope = envelopeFromRecord(record);
    addString(terms, envelope?.artifact_id);
    addString(terms, envelope?.run_id);
    addString(terms, envelope?.producer?.role_id);
    for (const id of envelope?.target_snapshot_ids ?? []) addString(terms, id);
    for (const source of [...(envelope?.payload?.observations ?? []), ...(envelope?.artifact_type === "audit-context" ? [envelope.payload] : [])]) {
      for (const reference of source.evidence_refs ?? []) {
        for (const key of ["path", "sha256", "environment_ref", "target_snapshot_id", "target_context_sha256"]) addString(terms, reference[key]);
      }
    }
    for (const input of envelope?.inputs ?? []) {
      addString(terms, input?.artifact_id);
      addString(terms, input?.run_id);
    }
  }
  for (const role of resources?.orchestrationRegistry?.roles ?? []) {
    addString(terms, role.id);
    addString(terms, role.agent_id);
  }
  return terms;
}

function internalIdPatterns(resources) {
  const patterns = new Set();
  collectSchemaIdPatterns(resources?.auditRunSchema, patterns);
  collectSchemaIdPatterns(resources?.envelopeSchema, patterns);
  return [...patterns].map((source) => new RegExp(source, "u"));
}

function assertPublicReportModelHasNoInternalControlMetadata(model, context) {
  const terms = internalControlTerms(context);
  const idPatterns = internalIdPatterns(context.resources);
  visitStrings(model, "public_model", (value, location) => {
    for (const term of terms) {
      if (containsIdentifierToken(value, term)) {
        throw new Error(`Run-backed public report contains internal control metadata at ${location}.`);
      }
    }
    for (const pattern of idPatterns) {
      if (pattern.test(value)) {
        throw new Error(`Run-backed public report contains internal control metadata at ${location}.`);
      }
    }
  });
}

const publicWithheldLabel = "Withheld from public report";

function isLocalPathLike(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return /\bfile:(?:\/{0,2})/iu.test(normalized)
    || /[A-Za-z]:[\\/]/u.test(normalized)
    || /\\\\[^\s\\]/u.test(normalized)
    || /^\/\//u.test(normalized)
    || /[^:]\/\/[^\/\s]/u.test(normalized)
    || /(?:^|[^A-Za-z0-9])\/(?!\/)[^\s]/u.test(normalized)
    || /(?:^|[^A-Za-z0-9])(?:~[\\/]|\.{1,2}[\\/])/u.test(normalized);
}

function isMachineSpecificEnvironmentValue(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  const ipv4Tokens = normalized.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu) ?? [];
  const ipv6Tokens = normalized.match(/(?<![A-Za-z0-9_:-])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![A-Za-z0-9_:-])/gu) ?? [];
  const hostnameTokens = normalized.match(/\b[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}\.)+[A-Za-z0-9-]{1,63}\b/gu) ?? [];
  const contextualHostname = /\b(?:(?:Windows(?:\s+\d+(?:\.\d+)*)?|macOS(?:\s+\d+(?:\.\d+)*)?|Linux(?:\s+\d+(?:\.\d+)*)?|Android(?:\s+\d+(?:\.\d+)*)?|iOS(?:\s+\d+(?:\.\d+)*)?)\s+on\s+[A-Za-z0-9][A-Za-z0-9.-]*|(?:hostname|host|machine|device)\s*[:=]\s*[A-Za-z0-9][A-Za-z0-9.-]*|hostname\s+is\s+[A-Za-z0-9][A-Za-z0-9.-]*)\b/iu;
  const identifierIsHostname = [...normalized.matchAll(/\b(?:host|machine|device)\s+is\s+([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)\b/giu)]
    .some((match) => /[0-9.-]/u.test(match[1]));
  return /\blocalhost\b/iu.test(normalized)
    || hostnameTokens.some((token) => hasReservedHostnameSuffix(token))
    || ipv4Tokens.some((token) => isNonPublicIpv4(token))
    || ipv6Tokens.some((token) => isIP(token) === 6 && isNonPublicIpv6(token))
    || contextualHostname.test(normalized)
    || identifierIsHostname
    || /\b(?:DESKTOP|LAPTOP)-[A-Za-z0-9-]+\b/iu.test(normalized)
    || /\b[A-Za-z0-9][A-Za-z0-9._-]*-(?:PC|MAC|LAPTOP|DESKTOP|WS[0-9A-Z-]{2,})\b/iu.test(normalized)
    || /\b(?:WIN|MAC|HOST)-[A-Za-z0-9-]{3,}\b/iu.test(normalized)
    || /\b[A-Za-z0-9][A-Za-z0-9_-]*\.(?:local|lan)\b/iu.test(normalized);
}

const reservedHostnameSuffixes = [
  "local",
  "lan",
  "internal",
  "localhost",
  "invalid",
  "test",
  "example",
  "corp",
  "localdomain",
  "home.arpa"
];

function hasReservedHostnameSuffix(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return reservedHostnameSuffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function isNonPublicIpv4(hostname) {
  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function expandIpv6(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "").split("%", 1)[0];
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function isNonPublicIpv6(hostname) {
  const parts = expandIpv6(hostname);
  if (!parts) return true;
  const allZero = parts.every((part) => part === 0);
  const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  const ipv4Compatible = parts.slice(0, 6).every((part) => part === 0) && !allZero && !loopback;
  if (ipv4Mapped || ipv4Compatible) {
    const ipv4 = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`;
    if (isNonPublicIpv4(ipv4)) return true;
  }
  return allZero
    || loopback
    || (parts[0] & 0xfe00) === 0xfc00
    || (parts[0] & 0xffc0) === 0xfe80
    || (parts[0] & 0xffc0) === 0xfec0
    || (parts[0] & 0xff00) === 0xff00
    || (parts[0] === 0x2001 && parts[1] === 0x0db8);
}

function isNonPublicHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isNonPublicIpv4(normalized);
  if (ipVersion === 6) return isNonPublicIpv6(normalized);
  return normalized === "localhost"
    || !normalized.includes(".")
    || hasReservedHostnameSuffix(normalized);
}

function isBranchLikeVersion(value) {
  return typeof value === "string" && /[\\/]/u.test(value.trim());
}

function publicUrlOrFile(value) {
  const normalized = value.trim();
  if (normalized === publicWithheldLabel) return normalized;
  if (!/^https?:\/\//iu.test(normalized)) return publicWithheldLabel;
  const afterInitialScheme = normalized.replace(/^https?:\/\//iu, "");
  if (/https?:\/\//iu.test(afterInitialScheme)) return publicWithheldLabel;
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash
        || isNonPublicHostname(parsed.hostname)) {
      return publicWithheldLabel;
    }
    return normalized;
  } catch {
    return publicWithheldLabel;
  }
}

// Extend this allowlist only for stable public semantic sequences that use slash as prose, not paths.
const publicSafeSlashSequences = new Set([
  "Node.js/PDF.js",
  "WCAG/JIS/EN",
  "pass/fail/unknown",
  "input/output/error"
]);

function hasUnsafeSlashToken(value) {
  const slashTokens = value.match(/\S*[\\/]\S*/gu) ?? [];
  const leadingWrappers = new Set(["(", "[", "{", "\"", "'", "“", "‘"]);
  const trailingWrappersAndPunctuation = new Set([")", "]", "}", "\"", "'", "”", "’", ".", ",", ";", ":", "!", "?"]);
  return slashTokens.some((token) => {
    let start = 0;
    let end = token.length;
    while (start < end && leadingWrappers.has(token[start])) start += 1;
    while (end > start && trailingWrappersAndPunctuation.has(token[end - 1])) end -= 1;
    return !publicSafeSlashSequences.has(token.slice(start, end));
  });
}

function hasBranchReference(value) {
  const knownBranchNames = new Set(["main", "master", "develop", "dev", "trunk", "head"]);
  const isBranchIdentifier = (token) => knownBranchNames.has(token.toLowerCase()) || /[0-9._\\/-]/u.test(token);
  const explicitLabel = value.match(/\bbranch\s*[:=]\s*([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\b/iu);
  const gitBranch = value.match(/\bgit\s+branch\s+([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\b/iu);
  const prefixBranches = value.matchAll(/\bbranch\s+([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\b/giu);
  const suffixBranches = value.matchAll(/\b([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\s+branch\b(?!\s+offices?\b)/giu);
  return Boolean(explicitLabel || gitBranch)
    || [...prefixBranches].some((match) => isBranchIdentifier(match[1]))
    || [...suffixBranches].some((match) => isBranchIdentifier(match[1]));
}

function sanitizePublicString(value) {
  const normalized = value.trim();
  if (normalized === publicWithheldLabel) return normalized;
  const httpPattern = /\bhttps?:\/\/\S+/giu;
  const httpUrls = [...normalized.matchAll(httpPattern)].map((match) => match[0]);
  if (httpUrls.some((httpUrl) => publicUrlOrFile(httpUrl) === publicWithheldLabel)) return publicWithheldLabel;
  const textWithoutHttpUrls = normalized.replace(httpPattern, " ");
  if (/\bhttps?:/iu.test(textWithoutHttpUrls)
      || isLocalPathLike(textWithoutHttpUrls)
      || hasUnsafeSlashToken(textWithoutHttpUrls)
      || hasBranchReference(textWithoutHttpUrls)
      || isMachineSpecificEnvironmentValue(textWithoutHttpUrls)) {
    return publicWithheldLabel;
  }
  return normalized;
}

function sanitizePublicVersion(value) {
  const normalized = value.trim();
  if (normalized === publicWithheldLabel) return normalized;
  if (sanitizePublicString(normalized) === publicWithheldLabel
      || /^(?:main|master|develop|dev|trunk|HEAD)$/iu.test(normalized)
      || /[\\/]/u.test(normalized)) {
    return publicWithheldLabel;
  }
  const semanticVersion = /^v?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
  const releaseNumber = /^(?:release|rel)[-_]v?\d+(?:[._-]\d+){0,3}$/iu;
  const calendarDate = /^\d{4}[-.]\d{2}[-.]\d{2}$/u;
  const commitHash = /^[a-f0-9]{7,64}$/iu;
  return [semanticVersion, releaseNumber, calendarDate, commitHash].some((pattern) => pattern.test(normalized))
    ? normalized
    : publicWithheldLabel;
}

function sanitizePublicModelStrings(value, pathParts = []) {
  if (typeof value === "string") {
    if (pathParts[0] === "target" && pathParts[1] === "urls_or_files") return publicUrlOrFile(value);
    if (pathParts[0] === "target" && pathParts[1] === "version_or_commit") return sanitizePublicVersion(value);
    return sanitizePublicString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizePublicModelStrings(item, [...pathParts, index]));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, sanitizePublicModelStrings(item, [...pathParts, key])]));
  }
  return value;
}

function publicLocation(value) {
  return sanitizePublicString(value);
}

function publicText(value, { branchLike = false, environment = false } = {}) {
  const sanitized = sanitizePublicString(value);
  if (sanitized === publicWithheldLabel
      || (branchLike && isBranchLikeVersion(sanitized))
      || (environment && isMachineSpecificEnvironmentValue(sanitized))) return publicWithheldLabel;
  return sanitized;
}

function publicEvidence(evidence) {
  return evidence.map((entry) => ({
    ...structuredClone(entry),
    location: publicLocation(entry.location)
  }));
}

function publicFinding(finding) {
  if (!finding) return null;
  return {
    priority: finding.priority,
    location: publicLocation(finding.location),
    affected_users: structuredClone(finding.affected_users),
    observation: finding.observation,
    remediation: finding.remediation,
    verification: finding.verification
  };
}

function publicRemediationReference(item) {
  if (!item) return null;
  return {
    proposed_change: item.proposed_change,
    verification: item.verification,
    owner: item.owner ?? null,
    residual_limitation: item.residual_limitation
  };
}

function publicLimitations(limitations) {
  return limitations.map((limitation) => limitation === "All profile requirements are initialized as not_tested; no accessibility conclusion has been made."
    ? "All profile requirements begin without a recorded result; no accessibility conclusion has been made."
    : limitation);
}

function publicClaimTier(requestedTier) {
  return ({
    reference_only: "Reference only",
    screened: "Screened",
    evaluated_subset: "Evaluated subset",
    organization_ready: "Organization-ready evidence"
  })[requestedTier] ?? "Not recorded";
}

function outcomeCountsFor(results) {
  return Object.fromEntries(outcomes.map((outcome) => [
    outcome,
    results.filter((result) => result.outcome === outcome).length
  ]));
}

function buildReportProjection(profileResults, screeningObservations) {
  const profileIds = new Set(profileResults.map((result) => result.requirement_id));
  const aiByProfile = groupScreeningProjections(screeningObservations);
  for (const suppliedObservation of screeningObservations.flatMap(screeningProjections)) {
    const observation = guardScreeningProjection(suppliedObservation);
    const hasProjection = observation.profile_requirement_id !== null
      && observation.profile_requirement_id !== undefined;
    if (hasProjection) {
      if (!observation.profile_requirement_id || !profileIds.has(observation.profile_requirement_id)) {
        throw new Error(`Screening report projection references an unregistered profile requirement: ${String(observation.profile_requirement_id)}.`);
      }
      if (!observation.applicability || !observation.report_rationale) {
        throw new Error(`Screening report projection is incomplete for ${observation.requirement_id}.`);
      }
      if (observation.applicability === "not_applicable") {
        if (observation.report_outcome !== null) throw new Error(`Not-applicable report projection must use report_outcome null: ${observation.requirement_id}.`);
      } else if (!Object.hasOwn(outcomeLabels, observation.report_outcome)) {
        throw new Error(`Screening report projection has an invalid report_outcome: ${observation.requirement_id}.`);
      }
      continue;
    }
  }

  const checks = [];
  const notApplicable = [];
  for (const result of profileResults) {
    if (isHumanReviewMapping(result)) {
      const row = {
        requirement_id: result.requirement_id,
        outcome: result.outcome,
        rationale: resultRationale(result),
        applicability: result.outcome === "not_applicable" ? "not_applicable" : "applicable"
      };
      (row.applicability === "not_applicable" ? notApplicable : checks).push(row);
      continue;
    }
    const observation = aiByProfile.get(result.requirement_id);
    if (!observation) {
      checks.push({ requirement_id: result.requirement_id, outcome: "not_tested", rationale: "この検査では確認していません。", applicability: "undetermined" });
      continue;
    }
    const row = {
      requirement_id: result.requirement_id,
      outcome: observation.applicability === "not_applicable" ? "not_applicable" : observation.report_outcome,
      rationale: observation.report_rationale,
      applicability: observation.applicability,
      review_details: observation.observations.length === 1 ? observation.observations[0].review_details : undefined,
      screening_conflicts: observation.conflicts,
      screening_observations: observation.observations.map(screeningReviewRecord)
    };
    (row.applicability === "not_applicable" ? notApplicable : checks).push(row);
  }
  const counts = { pass: 0, fail: 0, not_applicable: notApplicable.length, not_tested: 0, cant_tell: 0 };
  for (const item of checks) counts[item.outcome] += 1;
  return { checks: sortedByRequirement(checks), notApplicable: sortedByRequirement(notApplicable), counts };
}

export function validateRunBackedAssessment({ run, assessment, envelopesById, resources, trust }) {
  const record = assessment?.assessment;
  if (!record) throw new Error("Run-backed report requires an assessment record.");
  if (record.profile?.id !== run.profile?.id || record.profile?.registry_version !== run.profile?.registry_version) {
    throw new Error("Assessment profile does not match the audit run.");
  }
  for (const [name, actual, expected] of [
    ["target", record.target, run.target],
    ["scope", record.scope, run.scope],
    ["environment", record.environment, run.environment]
  ]) {
    if (!isDeepStrictEqual(actual, expected)) throw new Error(`Assessment ${name} does not match the audit run.`);
  }

  const evidence = collectRunEvidence(envelopesById);
  const humanByRequirement = uniqueMap(evidence.humanReviews, "requirement_id", "declared human review requirement");
  const screeningByRequirement = uniqueMap(evidence.screeningObservations, "requirement_id", "screening observation requirement");
  const results = Array.isArray(record.results) ? record.results : [];
  const resultByRequirement = uniqueMap(results, "requirement_id", "assessment result requirement");
  const reflectedProfileIds = results
    .filter((result) => result.requirement_kind === "profile_requirement"
      && (result.mapping_status !== "unverified" || result.outcome !== "not_tested" || (result.evidence?.length ?? 0) > 0))
    .map((result) => result.requirement_id)
    .sort((left, right) => left.localeCompare(right, "en"));
  const declaredProfileIds = [...humanByRequirement.keys()].sort((left, right) => left.localeCompare(right, "en"));
  if (!isDeepStrictEqual(reflectedProfileIds, declaredProfileIds)) {
    throw new Error("Assessment profile results do not exactly match the current run human reviews.");
  }
  for (const [requirementId, review] of humanByRequirement) {
    const result = resultByRequirement.get(requirementId);
    if (!result
        || result.requirement_kind !== "profile_requirement"
        || !isHumanReviewMapping(result)
        || result.outcome !== review.profile_outcome
        || result.method_kind !== "manual"
        || result.method !== `Declared external human review: ${review.rationale}`
        || result.notes !== review.rationale
        || !isDeepStrictEqual(result.evidence, review.target_specific_evidence)) {
      throw new Error(`Assessment human-reviewed result does not match the current run evidence for ${requirementId}.`);
    }
  }

  const assessmentScreening = results.filter((result) => result.requirement_kind === "screening_check");
  const assessmentScreeningIds = assessmentScreening.map((result) => result.requirement_id).sort((left, right) => left.localeCompare(right, "en"));
  const runScreeningIds = [...screeningByRequirement.keys()].sort((left, right) => left.localeCompare(right, "en"));
  if (!isDeepStrictEqual(assessmentScreeningIds, runScreeningIds)) {
    throw new Error("Assessment screening rows do not exactly match the current run screening observations.");
  }
  for (const [requirementId, observation] of screeningByRequirement) {
    const result = resultByRequirement.get(requirementId);
    const expectedEvidence = [{
      type: "other",
      location: observation.location,
      observation: observation.observation,
      captured_at: observation.captured_at
    }];
    if (!result
        || result.mapping_status !== "unverified"
        || result.outcome !== "cant_tell"
        || result.method_kind !== "automated"
        || result.method !== observation.method
        || !isDeepStrictEqual(result.evidence, expectedEvidence)) {
      throw new Error(`Assessment screening row does not match the current run observation for ${requirementId}.`);
    }
  }

  const expectedFindings = buildRunFindings(evidence.resolved.findingReviews, evidence.remediationItems);
  const actualFindings = [...(record.findings ?? [])].sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (!isDeepStrictEqual(actualFindings, expectedFindings)) {
    throw new Error("Assessment findings do not exactly match the current run human finding / verified remediation evidence.");
  }
  const candidateIds = new Set(evidence.remediationItems
    .filter((item) => item.basis === "unverified_screening_candidate")
    .map((item) => item.requirement_id));
  if ((record.findings ?? []).some((finding) => finding.requirement_ids.some((id) => candidateIds.has(id)))) {
    throw new Error("An unverified screening candidate must not be promoted to an assessment finding.");
  }

  if (humanByRequirement.size > 0) {
    const expectedReviewers = [...new Set(evidence.humanReviewHistory.map((review) => review.reviewer_name))].sort().join(", ");
    const expectedDate = evidence.humanReviewHistory.map((review) => review.review_date).sort().at(-1);
    const hasPerformedReview = !["11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0"].includes(run.schema_version) || evidence.humanReviews.some((review) => review.profile_outcome !== "not_tested");
    const expectedLevel = hasPerformedReview ? "E2" : screeningByRequirement.size > 0 ? "E1" : "E0";
    if (record.evidence_level !== expectedLevel || record.evaluator !== expectedReviewers || record.evaluated_at !== expectedDate) {
      throw new Error("Assessment evaluation identity does not match the current run human review declarations.");
    }
  } else if (screeningByRequirement.size > 0 && record.evidence_level !== "E1") {
    throw new Error("Assessment evidence level does not match the current run screening evidence.");
  }
  if (!isDeepStrictEqual(record.participation_coverage, evidence.context.coverage)) {
    throw new Error("Run-backed participation outcomes do not exactly match registered audit-context evidence.");
  }
  if (!isDeepStrictEqual(record.assurance, evidence.context.assurance)) {
    throw new Error("Run-backed assessment must not add assurance claims that are absent from the registered artifacts.");
  }
  const expectedLimitations = expectedRunBackedLimitations(evidence, assessment.schema_version);
  if (!isDeepStrictEqual(record.limitations, expectedLimitations)) {
    throw new Error("Assessment limitations do not exactly match the current run evidence.");
  }
  const tier = record.claim?.requested_tier;
  const expectedClaim = resources?.standardsRegistry?.claim_templates?.[tier]?.[0];
  if (!["reference_only", "screened", "evaluated_subset"].includes(tier) || record.claim?.proposed_wording !== expectedClaim) {
    throw new Error("Run-backed assessment claim must use a supported tier and its fixed registry wording.");
  }
  const claimValidation = validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods,
    reviewerVerificationOptions({ run, envelopesById, trust }));
  if (!claimValidation.valid) {
    throw new Error(`Run-backed assessment claim/evidence validation failed: ${claimValidation.errors.join("; ")}`);
  }
  if (record.next_review_at !== evidence.context.next_review_at
      || (record.next_review_owner ?? null) !== evidence.context.next_review_owner
      || (record.next_review_condition ?? null) !== evidence.context.next_review_condition) {
    throw new Error("Run-backed next review schedule does not exactly match registered audit-context evidence.");
  }
  return evidence;
}

export function buildPublicReportModel({ run, assessment, envelopesById, resources = loadAuditResources(), trust }) {
  const validation = validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods,
    reviewerVerificationOptions({ run, envelopesById, trust }));
  if (!validation.valid) throw new Error(`Assessment reviewer/evidence validation failed: ${validation.errors.join("; ")}`);
  const evidence = collectRunEvidence(envelopesById);
  const publicContext = projectAuditContext(new Map(contextArtifacts(envelopesById)
    .filter((artifact) => artifact.payload.publication === "public")
    .map((artifact) => [artifact.artifact_id, artifact])));
  const privateLimitations = new Set(evidence.context.declarations
    .filter((item) => item.publication === "internal" && item.kind === "limitation")
    .map((item) => item.value.text));
  const recordedProfileResults = assessment.assessment.results.filter((result) => result.requirement_kind === "profile_requirement");
  const screeningResults = assessment.assessment.results.filter((result) => result.requirement_kind === "screening_check");
  const registeredRequirementIds = resources?.standardsRegistry?.profiles
    ?.find((profile) => profile.id === run.profile.id)?.requirement_ids ?? recordedProfileResults.map((result) => result.requirement_id);
  const recordedProfileById = new Map(recordedProfileResults.map((result) => [result.requirement_id, result]));
  const profileResults = registeredRequirementIds.map((requirementId) => recordedProfileById.get(requirementId) ?? ({
    requirement_id: requirementId,
    requirement_kind: "profile_requirement",
    mapping_status: "unverified",
    outcome: "not_tested",
    method_kind: "manual",
    method: "Not yet evaluated.",
    evidence: [],
    notes: "Not yet evaluated."
  }));
  const reportProjection = buildReportProjection(profileResults, evidence.screeningObservations);
  const expectedProfileCount = registeredRequirementIds.length;
  const performedReviews = evidence.humanReviews.filter((review) => !["11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0"].includes(run.schema_version) || review.profile_outcome !== "not_tested");
  const reviewedIds = new Set(performedReviews.map((review) => review.requirement_id));
  const resultByRequirement = new Map(assessment.assessment.results.map((result) => [result.requirement_id, result]));
  const findingById = uniqueMap(assessment.assessment.findings ?? [], "id", "assessment finding ID");
  const remediationById = uniqueMap(evidence.remediationItems, "remediation_id", "remediation ID");
  const pendingByRequirement = new Map();
  for (const item of evidence.queues) {
    if (!reviewedIds.has(item.requirement_id) || evidence.resolved.groups.get(item.requirement_id)?.status === "unresolved_disagreement") {
      pendingByRequirement.set(item.requirement_id, item);
    }
  }
  const confirmedPoints = sortedByRequirement(evidence.humanReviews
    .filter((review) => review.profile_outcome === "pass")
    .map((review) => ({
      requirement_id: review.requirement_id,
      rationale: review.rationale,
      evidence: publicEvidence(review.target_specific_evidence)
    })));
  const recordedHumanChecks = sortedByRequirement(evidence.humanReviews.map((review) => ({
    requirement_id: review.requirement_id,
    outcome: review.profile_outcome,
    rationale: review.rationale,
    evidence: publicEvidence(review.target_specific_evidence),
    ...(evidence.resolved.modern ? { review_consensus: evidence.resolved.groups.get(review.requirement_id).status,
      human_reviews: reviewHistoryForReport(evidence.resolved.groups.get(review.requirement_id)) } : {})
  })));
  const verifiedFailures = evidence.humanReviews
    .filter((review) => review.profile_outcome === "fail")
    .flatMap((review) => [...findingById.values()]
      .filter((finding) => finding.requirement_ids.includes(review.requirement_id))
      .map((finding) => ({
        requirement_id: review.requirement_id,
        rationale: review.rationale,
        finding: publicFinding(finding),
        remediation: publicRemediationReference(remediationById.get(finding.id))
      })))
    .sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en")
      || String(left.remediation?.proposed_change ?? "").localeCompare(String(right.remediation?.proposed_change ?? ""), "en"));
  const screeningCandidates = evidence.screeningObservations
    .map(({ evidence_refs: _privateReferences, ...observation }) => guardScreeningProjection(observation))
    .flatMap((observation) => {
      const remediations = evidence.remediationItems
        .filter((item) => item.basis === "unverified_screening_candidate" && (item.observation_refs
          ? item.observation_refs.some((ref) => ref.requirement_id === observation.requirement_id) : item.requirement_id === observation.requirement_id))
        .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"));
      return (remediations.length ? remediations : [null]).map((remediation) => ({
        ...observation,
        location: publicLocation(observation.location),
        remediation: publicRemediationReference(remediation),
        assessment_outcome: resultByRequirement.get(observation.requirement_id)?.outcome
      }));
    })
    .sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en")
      || String(left.remediation?.proposed_change ?? "").localeCompare(String(right.remediation?.proposed_change ?? ""), "en"));
  const declaredFindingRequirements = new Set(evidence.resolved.findingReviews.filter((review) => declaredFindings(review).length).map((review) => review.requirement_id));
  const remediation = [...evidence.remediationItems]
    .filter((item) => item.basis !== "verified_failure" || !declaredFindingRequirements.has(item.requirement_id))
    .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"))
    .map((item) => ({
      requirement_id: item.requirement_id,
      ...(item.finding_id ? { requirement_ids: item.requirement_ids, observation_ids: item.observation_refs.map((ref) => ref.requirement_id) } : {}),
      evidence_status: item.basis === "verified_failure" ? "Verified failure" : "Unverified screening candidate",
      priority: item.priority,
      location: publicLocation(item.location),
      affected_users: item.affected_users,
      issue: item.issue,
      proposed_change: item.proposed_change,
      owner: item.owner ?? null,
      verification: item.verification,
      residual_limitation: item.residual_limitation
    }));
  for (const finding of findingById.values()) {
    if (!finding.requirement_ids.some((id) => declaredFindingRequirements.has(id))) continue;
    remediation.push({
      requirement_id: finding.requirement_ids[0],
      requirement_ids: finding.requirement_ids,
      observation_ids: evidence.remediationItems.find((item) => item.finding_id === finding.id)?.observation_refs.map((ref) => ref.requirement_id) ?? [],
      evidence_status: "Verified failure",
      priority: finding.priority,
      location: publicLocation(finding.location),
      affected_users: structuredClone(finding.affected_users),
      issue: finding.observation,
      remediation_status: finding.remediation_status,
      proposed_change: finding.remediation,
      verification: finding.verification,
      ...findingPlanMetadata(finding, evidence.remediationItems)
    });
  }
  const model = {
    reviewerAssurance: publicReviewerAssurance(validation.guard.reviewer_assurance),
    networkScope: networkScopeSummary(run.permissions, { publicOutput: true }),
    interactionScope: interactionScopeSummary(run.permissions),
    target: {
      name: publicText(run.target.name),
      version_or_commit: publicText(run.target.version_or_commit, { branchLike: true }),
      urls_or_files: run.target.urls_or_files.map(publicUrlOrFile)
    },
    profile: structuredClone(run.profile),
    scope: {
      included: run.scope.included.map((value) => publicText(value)),
      excluded: run.scope.excluded.map((value) => publicText(value)),
      complete_processes: run.scope.complete_processes.map((value) => publicText(value)),
      third_party_content: run.scope.third_party_content.map((value) => publicText(value)),
      full_pages_reviewed: run.scope.full_pages_reviewed
    },
    environment: {
      os: run.environment.os.map((value) => publicText(value, { environment: true })),
      browsers: run.environment.browsers.map((value) => publicText(value, { environment: true })),
      assistive_technologies: run.environment.assistive_technologies.map((value) => publicText(value, { environment: true })),
      input_modes: run.environment.input_modes.map((value) => publicText(value, { environment: true }))
    },
    evaluatedAt: assessment.assessment.evaluated_at,
    standardsRegistryVersion: resources?.standardsRegistry?.schema_version ?? "Not recorded",
    recordedHumanChecks,
    confirmedPoints,
    verifiedFailures,
    pendingHumanChecks: sortedByRequirement([...pendingByRequirement.values()].map((item) => publicQueueItem(item, publicLocation))),
    screeningCandidates,
    remediation,
    limitations: publicLimitations(assessment.assessment.limitations.filter((item) => !privateLimitations.has(item))),
    auditContext: {
      participation_coverage: publicContext.coverage,
      independent_audit_performed: publicContext.assurance.independent_audit.performed,
      dossier_prepared: publicContext.assurance.legal_or_procurement_dossier.prepared,
      next_review_at: publicContext.next_review_at,
      next_review_condition: publicContext.next_review_condition
    },
    participantSummary: summarizeParticipantObservations(envelopesById, { visibility: "public" }),
    claim: {
      tier: publicClaimTier(assessment.assessment.claim.requested_tier),
      wording: validation.guard.assured_claim_wording.ja
    },
    evidenceLevel: displayedEvidenceLevel(assessment.assessment.evidence_level, validation.guard.reviewer_assurance),
    reviewedCount: performedReviews.length,
    screeningCount: evidence.screeningObservations.length,
    profileOutcomeCounts: outcomeCountsFor(profileResults),
    screeningOutcomeCounts: outcomeCountsFor(screeningResults),
    reportChecks: reportProjection.checks,
    notApplicableChecks: reportProjection.notApplicable,
    reportOutcomeCounts: reportProjection.counts,
    catalogCoverage: { recorded: recordedProfileResults.length, expected: expectedProfileCount },
    evaluationCoverage: {
      humanReviewed: profileResults.filter((result) => isHumanReviewMapping(result) && (!["11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0"].includes(run.schema_version) || result.outcome !== "not_tested")).length,
      expected: expectedProfileCount
    }
  };
  const sanitizedModel = sanitizePublicModelStrings(model);
  assertPublicReportModelHasNoInternalControlMetadata(sanitizedModel, { run, envelopesById, resources });
  return sanitizedModel;
}

function publicTable(headers, rows, emptyMessage) {
  if (rows.length === 0) return emptyMessage;
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)
  ].join("\n");
}

export function renderRunBackedReport(model) {
  const reportChecks = model.reportChecks ?? [];
  const notApplicableChecks = model.notApplicableChecks ?? [];
  const reportCounts = model.reportOutcomeCounts ?? model.profileOutcomeCounts ?? {};
  const evidenceStatus = (value) => value === "Verified failure" ? "確認済みの不適合" : "要確認の候補";
  const lines = [
    "# WCAG検査レポート",
    "",
    reportNotice,
    "",
    `> 文書区分：検査・改善ハンドオフ（${({ "Reference only": "規格参照のみ", Screened: "スクリーニング", "Evaluated subset": "一部を人手評価" })[model.claim?.tier] ?? "主張範囲未記録"}）`,
    "",
    "## 1. 総合判定",
    "",
    `- 総合判定: ${overallReportJudgement(reportCounts)}`,
    `- 適合: ${count(reportCounts, "pass")}`,
    `- 不適合: ${count(reportCounts, "fail")}`,
    `- 要確認: ${count(reportCounts, "cant_tell")}`,
    `- 未確認: ${count(reportCounts, "not_tested")}`,
    `- 適用対象外: ${notApplicableChecks.length}`,
    "",
    "## 2. 検査対象",
    "",
    `- 対象: ${cell(model.target.name)}`,
    `- 版・コミット: ${cell(model.target.version_or_commit)}`,
    `- URL・ファイル: ${cell(model.target.urls_or_files.join(", ") || "記録なし")}`,
    `- 適用プロファイル: ${cell(model.profile.id)}`,
    `- 確認日: ${cell(model.evaluatedAt)}`,
    `- 規格台帳の版: ${cell(model.standardsRegistryVersion)}`,
    ...(model.networkScope ? [`- ${cell(networkScopeText(model.networkScope, "ja"))}`] : []),
    ...(model.interactionScope ? [`- ${cell(interactionScopeText(model.interactionScope, "ja"))}`] : []),
    `- ${cell(reviewerAssuranceText(model.reviewerAssurance, "ja"))}`,
    "",
    "## 3. 達成基準別の判定",
    "",
    publicTable(
      ["達成基準・検査項目", "判定", "根拠・未確認事項"],
      reportChecks.map((item) => [item.requirement_id, reportJudgementForOutcome(item.outcome), reviewDetailLines(item, "ja").join("\n")]),
      "判定対象の達成基準はありません。"
    ),
    "",
    "### 適用対象外とした達成基準",
    "",
    publicTable(
      ["達成基準", "理由"],
      notApplicableChecks.map((item) => [item.requirement_id, reviewDetailLines(item, "ja").join("\n")]),
      "適用対象外とした達成基準はありません。"
    ),
    "",
    "## 4. 改善事項",
    "",
    publicTable(
      ["優先度", "達成基準・検査項目", "証拠の状態", "箇所", "影響を受ける利用者", "問題", "改善案", "担当", "残る確認事項"],
      model.remediation.map((item) => [
        item.priority,
        item.requirement_id,
        evidenceStatus(item.evidence_status),
        item.location,
        item.affected_users.join(", "),
        item.issue,
        item.proposed_change,
        item.owner ?? "未設定",
        item.residual_limitation
      ]),
      "改善項目の記録はありません。"
    ),
    "",
    "### 再確認方法",
    "",
    publicTable(
      ["優先度", "達成基準・検査項目", "再確認方法", "担当"],
      model.remediation.map((item) => [item.priority, item.requirement_id, item.verification, item.owner ?? "未設定"]),
      "再確認方法の記録はありません。"
    ),
    "",
    "## 5. 今後の確認事項",
    "",
    publicTable(
      ["検査項目", "判定", "箇所", "確認内容"],
      model.screeningCandidates.map((item) => [item.requirement_id, "要確認", item.location, item.observation]),
      "追加確認が必要な候補はありません。"
    ),
    "",
    "### 確認手順が残っている達成基準",
    "",
    publicTable(
      ["達成基準", "判定", "手順の有無", "確認作業", "要確認となる条件"],
      model.pendingHumanChecks.map((item) => [
        item.requirement_id,
        "未確認",
        item.procedure_availability,
        [...queueReviewLines(item), ...item.human_actions].join("; "),
        item.cant_tell_conditions.join("; ")
      ]),
      "未実施の確認手順はありません。"
    ),
    "",
    "## 6. 対象範囲と検査環境",
    "",
    `- 含む範囲: ${cell(model.scope.included.join(", ") || "記録なし")}`,
    `- 除外した範囲: ${cell(model.scope.excluded.join(", ") || "記録なし")}`,
    `- 一連の利用手順: ${cell(model.scope.complete_processes.join(", ") || "記録なし")}`,
    `- 第三者コンテンツ: ${cell(model.scope.third_party_content.join(", ") || "記録なし")}`,
    `- ページ全体を確認: ${model.scope.full_pages_reviewed ? "はい" : "いいえ"}`,
    `- OS: ${cell(model.environment.os.join(", ") || "記録なし")}`,
    `- ブラウザー・表示環境: ${cell(model.environment.browsers.join(", ") || "記録なし")}`,
    `- 支援技術: ${cell(model.environment.assistive_technologies.join(", ") || "記録なし")}`,
    `- 入力方法: ${cell(model.environment.input_modes.join(", ") || "記録なし")}`,
    "",
    "## 7. 記録の範囲",
    "",
    `- 登録済み達成基準: ${model.catalogCoverage.recorded}/${model.catalogCoverage.expected}`,
    `- 人手レビューが申告された達成基準: ${model.evaluationCoverage.humanReviewed}/${model.evaluationCoverage.expected}`,
    `- 主張可能な範囲: ${cell(model.claim.wording)}`,
    `- 記録済みスクリーニング: ${model.screeningCount}`,
    `- 証拠レベル: ${cell(model.evidenceLevel)}`,
    "- 結果は、記載した対象の版・範囲・環境・証拠を越えて適用しません。",
    ...model.limitations.map((limitation) => `- ${cell(limitation)}`),
    "",
    "## 8. 参加観点と次回確認",
    "",
    ...Object.entries(model.auditContext?.participation_coverage ?? {}).map(([key, outcome]) => `- ${key}: ${cell(outcome)}`),
    `- 次回確認日: ${cell(model.auditContext?.next_review_at ?? "記録なし")}`,
    ...(model.auditContext?.next_review_condition ? [`- 再確認条件: ${cell(model.auditContext.next_review_condition)}`] : []),
    `- 独立監査の申告: ${model.auditContext?.independent_audit_performed ? "はい" : "いいえ"}`,
    `- 資料整備の申告: ${model.auditContext?.dossier_prepared ? "はい" : "いいえ"}`,
    ...(model.participantSummary ? [
      "",
      "## 9. 当事者による利用テスト",
      "",
      "この観測は規格の適合判定ではありません。",
      `- 集計対象の参加者: ${model.participantSummary.participant_count ?? "公表可能な集計なし"}`,
      ...model.participantSummary.themes.map((theme) => `- ${cell(theme.label)}: ${theme.participant_count}`)
    ] : [])
  ];
  return `${lines.join("\n").trimEnd()}\n\n${renderSourceNoticesMarkdown("ja")}`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (!["--input", "--run", "--assessment", "--output", "--trust-policy", "--trust-policy-sha256"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    const key = ({ "--trust-policy": "trustPolicy", "--trust-policy-sha256": "trustPolicySha256" })[arg] ?? arg.slice(2);
    if (options[key] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/render-audit-report.mjs --input <assessment.json> [--output <report.md>]",
    "  node scripts/render-audit-report.mjs --run <audit-run.json> --assessment <assessment.json> --output <new-report.md>",
    "  Optional: --trust-policy <recipient-policy.json> --trust-policy-sha256 <independently selected hash>"
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const runBacked = Boolean(options.run || options.assessment);
  const trustInput = loadReviewTrust(options);
  if (options.input && runBacked) throw new Error("Use either --input or the --run/--assessment interface, not both.");
  if (runBacked) {
    if (!options.run || !options.assessment || !options.output) {
      throw new Error("--run, --assessment, and --output are required for a run-backed report.");
    }
    const runSnapshot = readStableFile(path.resolve(options.run), { label: "audit run" });
    const assessmentSnapshot = readStableFile(path.resolve(options.assessment), { label: "merged assessment" });
    const run = parseSnapshotJson(runSnapshot, "audit run");
    const assessment = parseSnapshotJson(assessmentSnapshot, "merged assessment");
    const runValidation = validateAuditRun(run, { skillRoot, runFile: runSnapshot.path });
    if (!runValidation.valid) throw new Error(`Audit run validation failed:\n- ${runValidation.errors.join("\n- ")}`);
    const currentRunVersion = runValidation.resources.auditRunSchema.properties.schema_version.const;
    if (!["10.0.0", "11.0.0", "12.0.0", "13.0.0", currentRunVersion].includes(run.schema_version)) {
      throw new Error(`Run-backed reporting requires audit-run 10.0.0, 11.0.0, 12.0.0, 13.0.0 or current schema_version ${currentRunVersion}; use the original package for older records.`);
    }
    const validation = validateAssessment(
      assessment,
      runValidation.resources.standardsRegistry,
      runValidation.resources.assessmentSchema,
      runValidation.resources.criteriaCatalog,
      runValidation.resources.auditMethods,
      reviewerVerificationOptions({ run, envelopesById: runValidation.envelopesById, trust: trustInput.trust })
    );
    if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
    validateRunBackedAssessment({
      run,
      assessment,
      envelopesById: runValidation.envelopesById,
      resources: runValidation.resources,
      trust: trustInput.trust
    });
    const report = renderRunBackedReport(buildPublicReportModel({
      run,
      assessment,
      envelopesById: runValidation.envelopesById,
      resources: runValidation.resources,
      trust: trustInput.trust
    }));
    const artifactSnapshots = [...runValidation.envelopesById.values()].map((record) => record.snapshot).filter(Boolean);
    const output = writeNewText(path.resolve(options.output), report, {
      beforeWrite() {
        assertStableFile(runSnapshot, "audit run");
        assertStableFile(assessmentSnapshot, "merged assessment");
        for (const snapshot of artifactSnapshots) assertStableFile(snapshot, "registered artifact");
        for (const snapshot of runValidation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
        for (const snapshot of trustInput.snapshots) assertStableFile(snapshot, "external reviewer trust policy");
      }
    });
    console.log(JSON.stringify({ status: "PASS", report: output }));
    return;
  }
  if (!options.input) throw new Error("--input is required");
  const inputSnapshot = readStableFile(path.resolve(options.input), { label: "standalone assessment" });
  const record = parseSnapshotJson(inputSnapshot, "standalone assessment");
  const validation = validateAssessment(
    record,
    readReference("standards-registry.json"),
    readReference("assessment-record.schema.json"),
    readReference("criteria-catalog.json"),
    readReference("web-audit-methods.json"),
    { trust: trustInput.trust }
  );
  if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
  const report = renderAuditReport(record, validation);
  const assertInputsStable = () => {
    assertStableFile(inputSnapshot, "standalone assessment");
    for (const snapshot of trustInput.snapshots) assertStableFile(snapshot, "external reviewer trust policy");
  };
  if (!options.output) {
    assertInputsStable();
    process.stdout.write(report);
    return;
  }
  const legacyOutput = path.resolve(options.output);
  const output = writeNewText(legacyOutput, report, { beforeWrite: assertInputsStable });
  console.log(JSON.stringify({ status: "PASS", input: path.resolve(options.input), output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
