import fs from "node:fs";
import { queueReviewLines } from "./lib/human-review-queue.mjs";
import { renderSourceNoticesMarkdown } from "./lib/source-provenance.mjs";
import { networkScopeText } from "./lib/network-policy.mjs";
import { interactionScopeText } from "./lib/interaction-policy.mjs";
import { reviewDetailLines } from "./lib/review-details.mjs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertStableFile, readStableFile, validateAuditRun, writeNewText } from "./lib/audit-run.mjs";
import { validateAssessment } from "./validate-assessment.mjs";
import { reviewerAssuranceText, reviewerVerificationOptions, displayedEvidenceLevel } from "./lib/assessment-provenance.mjs";
import { loadReviewTrust } from "./lib/review-trust-input.mjs";
import { parseAttestationJson } from "./lib/attestation-canonical.mjs";
import { outcomes, outcomeLabels, reportJudgementForOutcome, overallReportJudgement, count, resultRationale } from "./lib/report-judgement.mjs";
import { validateRunBackedAssessment, buildPublicReportModel } from "./lib/run-backed-report-model.mjs";

export { reportJudgementForOutcome, overallReportJudgement } from "./lib/report-judgement.mjs";
export { validateRunBackedAssessment, buildPublicReportModel } from "./lib/run-backed-report-model.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);

const priorityOrder = ["P0", "P1", "P2"];
const reportNotice = "> 注意：このレポートでは、改善判断のために「適合」「不適合」などの判定語を使用します。これらは記載した対象・範囲・環境・確認日時・証拠に基づく検査結果であり、第三者認証、法的判断、または組織による正式な適合表明ではありません。";

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
