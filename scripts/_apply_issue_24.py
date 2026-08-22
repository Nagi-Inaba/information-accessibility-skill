from hashlib import sha256
from pathlib import Path

schema_paths = [
    Path("codex/skills/information-accessibility-practice/references/screening-observations.schema.json"),
    Path("claude/skills/information-accessibility-practice/references/screening-observations.schema.json"),
]

old_pattern = r"^(?:WCAG-2\.2-SC-[0-9]+(?:\.[0-9]+){2}|JIS-X-8341-3-2016-SC-[0-9]+(?:\.[0-9]+){2})$"
new_pattern = r"^(?:WCAG-2\.2-SC-[0-9]+(?:\.[0-9]+){2}|WCAG-2\.2-ADDITIONAL-SC-[0-9]+(?:\.[0-9]+){2}|JIS-X-8341-3-2016-SC-[0-9]+(?:\.[0-9]+){2})$"

original = schema_paths[0].read_text(encoding="utf-8")
if original.count(old_pattern) != 1:
    raise SystemExit("screening schema pattern anchor did not match exactly once")
if schema_paths[1].read_text(encoding="utf-8") != original:
    raise SystemExit("Codex and Claude screening schemas diverged before update")

normalized = lambda text: text.replace("\r\n", "\n").encode("utf-8")
old_hash = sha256(normalized(original)).hexdigest()
updated = original.replace(old_pattern, new_pattern, 1)
new_hash = sha256(normalized(updated)).hexdigest()
if old_hash == new_hash:
    raise SystemExit("screening schema hash did not change")

for path in schema_paths:
    path.write_text(updated, encoding="utf-8")

hash_targets = [
    Path("codex/skills/information-accessibility-practice/references/orchestration-registry.json"),
    Path("claude/skills/information-accessibility-practice/references/orchestration-registry.json"),
    Path("codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/lib/audit-run.mjs"),
    Path("tests/audit-orchestration-contract.test.mjs"),
]
for path in hash_targets:
    text = path.read_text(encoding="utf-8")
    occurrences = text.count(old_hash)
    if occurrences < 1:
        raise SystemExit(f"current screening schema hash not found in {path}")
    path.write_text(text.replace(old_hash, new_hash), encoding="utf-8")

print({"old_hash": old_hash, "new_hash": new_hash})
