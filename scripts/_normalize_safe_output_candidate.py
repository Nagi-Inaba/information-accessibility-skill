from pathlib import Path

for path in [
    Path("codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/generate-assessment.mjs"),
]:
    text = path.read_text(encoding="utf-8")
    text = text.replace(r'\"', '"').replace(r'\\n', r'\n')
    path.write_text(text, encoding="utf-8")

for path in [Path("README.md"), Path("README.en.md")]:
    text = path.read_text(encoding="utf-8")
    text = text.replace(r"node .\\codex\\skills\\information-accessibility-practice\\scripts\\generate-assessment.mjs", r"node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs")
    path.write_text(text, encoding="utf-8")
