from pathlib import Path
import re
import runpy

# Apply the broad candidate patch. It intentionally stops before writing the
# catalog file because the legacy formatting around that write varies.
try:
    runpy.run_path("scripts/_apply_safe_assessment_output.py")
except SystemExit as error:
    if "catalog write anchor missing" not in str(error):
        raise

catalog_path = Path("scripts/build-criteria-catalog.mjs")
text = catalog_path.read_text(encoding="utf-8")

import_anchor = 'import { fileURLToPath } from "node:url";'
import_replacement = (
    'import { fileURLToPath } from "node:url";\n'
    'import { assertNewOutputPath, writeNewText } from '
    '"../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";'
)
if "assertNewOutputPath, writeNewText" not in text:
    if import_anchor not in text:
        raise SystemExit("catalog safe-writer import anchor missing")
    text = text.replace(import_anchor, import_replacement, 1)

helper_anchor = "async function refreshCatalog(root) {"
helper = '''export function writeCatalogCandidate(output, catalog) {
  return writeNewText(path.resolve(output), `${JSON.stringify(catalog, null, 2)}\\n`);
}

async function refreshCatalog(root) {'''
if "export function writeCatalogCandidate" not in text:
    if helper_anchor not in text:
        raise SystemExit("catalog helper anchor missing")
    text = text.replace(helper_anchor, helper, 1)

legacy_preflight = '  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`);'
safe_preflight = '''  try {
    assertNewOutputPath(output);
  } catch (error) {
    if (/Refusing to overwrite existing file/u.test(error.message)) {
      throw new Error(`Refusing to overwrite existing output: ${output}`);
    }
    throw error;
  }'''
if legacy_preflight in text:
    text = text.replace(legacy_preflight, safe_preflight, 1)
elif safe_preflight not in text:
    raise SystemExit("catalog output preflight anchor missing")

pattern = re.compile(
    r'''  fs\.mkdirSync\(path\.dirname\(output\), \{ recursive: true \}\);\n'''
    r'''  fs\.writeFileSync\(output, `\$\{JSON\.stringify\(catalog, null, 2\)\}\\n`, \{ encoding: "utf8", flag: "wx" \}\);\n'''
    r'''  return \{ status: "PASS", mode: "refresh", output, counts: \{ wcag: 55, jis: 38, japan_additional: 18 \} \};'''
)
replacement = '''  const writtenOutput = writeCatalogCandidate(output, catalog);
  return { status: "PASS", mode: "refresh", output: writtenOutput, counts: { wcag: 55, jis: 38, japan_additional: 18 } };'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1 and replacement not in text:
    raise SystemExit("catalog safe writer replacement did not match exactly once")
catalog_path.write_text(text, encoding="utf-8")

for path in [
    Path("codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/accessibility-audit.mjs"),
]:
    text = path.read_text(encoding="utf-8")
    old = '''    summary: "Create a complete not-tested assessment for an active profile.",
    usage: "accessibility-audit assessment --profile <id> [assessment options]"'''
    new = '''    summary: "Create a validator-valid assessment record or an explicit placeholder template.",
    usage: "accessibility-audit assessment --profile <id> --target-name <name> --target-version <version> --target-ref <url|file> --evaluator <name> --evaluated-at <date> [--output <file>] | accessibility-audit assessment --template --profile <id> [--output <file>]"'''
    if old not in text:
        raise SystemExit(f"assessment help anchor missing: {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

for filename, template_line, note in [
    (
        "README.md",
        r'node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --template --profile web-modern --output .\assessment.template.json',
        'プレースホルダーを含む編集用ひな形が必要な場合だけ `--template` を使います。template modeは `TEMPLATE_CREATED` を返し、検証済みassessmentとは扱いません。安全なwriterが不足する出力ディレクトリをcomponent単位で作成します。後続処理が失敗しても、競合時の誤削除を避けるため、この処理が作成した空ディレクトリは自動削除しません。'
    ),
    (
        "README.en.md",
        r'node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --template --profile web-modern --output .\assessment.template.json',
        'Use `--template` only when an editable placeholder template is required. Template mode returns `TEMPLATE_CREATED` and is not a validated assessment. The safe writer creates missing output directories one component at a time. Empty directories created before a later failure are retained to avoid unsafe cleanup during concurrent operations.'
    ),
]:
    path = Path(filename)
    lines = path.read_text(encoding="utf-8").splitlines()
    updated = []
    first_generator_index = None
    for line in lines:
        if "generate-assessment.mjs" in line and "--profile web-modern" in line and "--output" in line and "--target-name" not in line and "--template" not in line:
            line = line.replace(
                " --output ",
                ' --target-name "Example" --target-version "2026-08-22" --target-ref "https://example.com/" --evaluator "External reviewer" --evaluated-at "2026-08-22" --output '
            )
        if first_generator_index is None and "generate-assessment.mjs" in line:
            first_generator_index = len(updated)
        updated.append(line)
    if first_generator_index is None:
        raise SystemExit(f"README generator command missing: {filename}")
    if "--template --profile web-modern" not in "\n".join(updated):
        updated[first_generator_index:first_generator_index] = [note, "", "```powershell", template_line, "```", ""]
    path.write_text("\n".join(updated) + "\n", encoding="utf-8")

# Existing tests should exercise the new explicit CLI contract rather than
# freezing the legacy one-line help shape or omitting record identity.
import_test = Path("tests/generate-assessment-import.test.mjs")
text = import_test.read_text(encoding="utf-8")
old = '''    assert.match(result.stdout, /Usage: node scripts\\/generate-assessment\\.mjs/u);'''
new = '''    assert.match(result.stdout, /Usage:\\s+node scripts\\/generate-assessment\\.mjs/u);'''
if old not in text:
    raise SystemExit("generate-assessment help expectation anchor missing")
import_test.write_text(text.replace(old, new, 1), encoding="utf-8")

cli_test = Path("tests/unified-cli.test.mjs")
text = cli_test.read_text(encoding="utf-8")
old = '''  const overwrite = runCli([
    "assessment",
    "--profile", "web-modern",
    "--output", assessment
  ]);'''
new = '''  const overwrite = runCli([
    "assessment",
    "--profile", "web-modern",
    "--target-name", "Unified CLI fixture",
    "--target-version", "fixture-v1",
    "--target-ref", "https://example.test/",
    "--evaluator", "external-human-review-required",
    "--evaluated-at", "2026-07-18",
    "--output", assessment
  ]);'''
if old not in text:
    raise SystemExit("unified CLI overwrite invocation anchor missing")
cli_test.write_text(text.replace(old, new, 1), encoding="utf-8")
