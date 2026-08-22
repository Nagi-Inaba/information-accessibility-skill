from pathlib import Path

for path in [
    Path("codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/validate-assessment.mjs"),
]:
    text = path.read_text(encoding="utf-8")
    old = '''  let evidenceCeiling = "reference_only";
  if (evidenceLevel === "E1" && results.length > 0) evidenceCeiling = "screened";'''
    new = '''  const evidencedScreeningResults = results.filter((result) =>
    result.requirement_kind === "screening_check"
      && Array.isArray(result.evidence)
      && result.evidence.length > 0
  );
  let evidenceCeiling = "reference_only";
  if (evidenceLevel === "E1") {
    if (evidencedScreeningResults.length === 0) {
      errors.push("E1 requires at least one screening_check with target-specific evidence");
    } else {
      evidenceCeiling = "screened";
    }
  }'''
    if old not in text:
        raise SystemExit(f"evidence ceiling anchor missing: {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
