from pathlib import Path

renderers = [
    Path("codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/render-audit-report.mjs"),
]

for path in renderers:
    text = path.read_text(encoding="utf-8")

    replacements = [
        (
            '''export function overallReportJudgement(counts = {}) {
  if (count(counts, "fail") > 0) return "不適合";
  if (count(counts, "cant_tell") > 0) return "要確認";
  if (count(counts, "not_tested") > 0) return "未確認";
  return "適合";
}''',
            '''export function overallReportJudgement(counts = {}) {
  const recorded = outcomes.reduce((total, outcome) => total + count(counts, outcome), 0);
  if (recorded === 0) return "未確認";
  if (count(counts, "fail") > 0) return "不適合";
  if (count(counts, "cant_tell") > 0) return "要確認";
  if (count(counts, "not_tested") > 0) return "未確認";
  return "適合";
}''',
        ),
        (
            '''  const assessment = record.assessment;
  const guard = validation.guard;
  const profileCounts = guard.profile_outcome_counts;''',
            '''  const assessment = record.assessment;
  const guard = validation.guard;
  const profileCounts = guard.profile_outcome_counts;
  const referenceGuidance = assessment.claim?.requested_tier === "reference_only";
  const reportTitle = referenceGuidance ? "# WCAG参照ガイダンス" : "# WCAG検査レポート";
  const summaryLabel = referenceGuidance ? "確認状況" : "総合判定";''',
        ),
        (
            '''  const lines = [
    "# WCAG検査レポート",
    "",
    reportNotice,
    "",
    "## 1. 総合判定",
    "",
    `- 総合判定: ${overallReportJudgement(profileCounts)}`,''',
            '''  const lines = [
    reportTitle,
    "",
    reportNotice,
    "",
    `- 文書区分: ${referenceGuidance ? "規格参照ガイダンス" : "検査レポート"}`,
    "",
    `## 1. ${summaryLabel}`,
    "",
    `- ${summaryLabel}: ${overallReportJudgement(profileCounts)}`,''',
        ),
        (
            '''export function buildPublicReportModel({ run, assessment, envelopesById, resources }) {
  const evidence = collectRunEvidence(envelopesById);
  const profileResults = assessment.assessment.results.filter((result) => result.requirement_kind === "profile_requirement");
  const screeningResults = assessment.assessment.results.filter((result) => result.requirement_kind === "screening_check");
  const reportProjection = buildReportProjection(profileResults, evidence.screeningObservations);
  const expectedProfileCount = resources?.standardsRegistry?.profiles
    ?.find((profile) => profile.id === run.profile.id)?.requirement_ids?.length ?? profileResults.length;''',
            '''export function buildPublicReportModel({ run, assessment, envelopesById, resources }) {
  const evidence = collectRunEvidence(envelopesById);
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
  const expectedProfileCount = registeredRequirementIds.length;''',
        ),
        (
            '''    catalogCoverage: { recorded: profileResults.length, expected: expectedProfileCount },''',
            '''    catalogCoverage: { recorded: recordedProfileResults.length, expected: expectedProfileCount },''',
        ),
        (
            '''  const lines = [
    "# WCAG検査レポート",
    "",
    reportNotice,
    "",
    "## 1. 総合判定",''',
            '''  const lines = [
    "# WCAG検査レポート",
    "",
    reportNotice,
    "",
    "> 文書区分：検査・改善ハンドオフ（規格参照のみ）",
    "",
    "## 1. 総合判定",''',
        ),
    ]

    for old, new in replacements:
        if old not in text:
            raise SystemExit(f"Patch anchor missing in {path}: {old.splitlines()[0]}")
        text = text.replace(old, new, 1)

    path.write_text(text, encoding="utf-8")

readme = Path("README.md")
text = readme.read_text(encoding="utf-8")
anchor = "## できること\n"
addition = """## 出力文書の区分

`reference_only` の評価記録から生成する文書は、検査結果ではなく **参照ガイダンス** です。未確認の達成基準を一覧化し、次に必要な検査や人手確認へ引き継ぐために使います。
対象固有の証拠と判定がある場合に生成する **検査レポート** とは、タイトルと文書区分を分けて表示します。どちらの場合も、登録されていない達成基準を暗黙の適合として扱いません。

"""
if addition not in text:
    if anchor not in text:
        raise SystemExit("README.md anchor missing")
    readme.write_text(text.replace(anchor, addition + anchor, 1), encoding="utf-8")

readme = Path("README.en.md")
text = readme.read_text(encoding="utf-8")
anchor = "## What this package can do\n"
addition = """## Output document modes

A record at the `reference_only` tier produces **reference guidance**, not an inspection result. It lists unverified requirements and prepares a handoff for the next inspection or external human review.
An evidence-backed **inspection report** uses a separate title and document classification. In both modes, requirements that were not recorded are never treated as implicit passes.

"""
if addition not in text:
    if anchor not in text:
        raise SystemExit("README.en.md anchor missing")
    readme.write_text(text.replace(anchor, addition + anchor, 1), encoding="utf-8")
