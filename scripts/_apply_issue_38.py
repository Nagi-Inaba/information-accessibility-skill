from pathlib import Path

for path in [
    Path("codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/validate-assessment.mjs"),
]:
    text = path.read_text(encoding="utf-8")
    old = '''  if (findingsProvided) {
    for (const result of results.filter((item) => item.outcome === "fail")) {
      if (!findingRequirementIds.has(result.requirement_id)) {
        errors.push(`A finding must reference failed requirement: ${result.requirement_id}`);
      }
    }
  } else if (results.some((result) => result.outcome === "fail")) {
    warnings.push("Legacy assessment record has failed results but no structured findings; use findings to make remediation and retest traceable.");
  }'''
    new = '''  const failedResults = results.filter((item) => item.outcome === "fail");
  if (failedResults.length > 0 && !findingsProvided) {
    errors.push("findings is required when assessment contains failed results");
  }
  if (findingsProvided) {
    for (const result of failedResults) {
      if (!findingRequirementIds.has(result.requirement_id)) {
        errors.push(`A finding must reference failed requirement: ${result.requirement_id}`);
      }
    }
  }'''
    if old not in text:
        raise SystemExit(f"findings validation anchor missing: {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

test_path = Path("tests/audit-report.test.mjs")
text = test_path.read_text(encoding="utf-8")
old = '''    assert.match(legacyRejected.stderr || legacyRejected.stdout, /failed results without structured findings/);'''
new = '''    assert.match(legacyRejected.stderr || legacyRejected.stdout, /findings is required when assessment contains failed results/);'''
if old not in text:
    raise SystemExit("audit-report legacy error expectation anchor missing")
test_path.write_text(text.replace(old, new, 1), encoding="utf-8")
