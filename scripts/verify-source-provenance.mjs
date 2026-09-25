import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSourceProvenance, verifySourceProvenance, thirdPartyNoticeMarkdown } from "../shared/skill/scripts/lib/source-provenance.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function verifySourceNotices(packageRoot = root) {
  const skillRoot = path.join(packageRoot, "shared/skill");
  const manifest = loadSourceProvenance(skillRoot);
  const result = verifySourceProvenance({ skillRoot, manifest });
  const expected = thirdPartyNoticeMarkdown(manifest);
  for (const file of ["THIRD_PARTY_NOTICES.md", "shared/skill/references/third-party-notices.md", "codex/skills/information-accessibility-practice/references/third-party-notices.md", "claude/skills/information-accessibility-practice/references/third-party-notices.md"]) {
    if (fs.readFileSync(path.join(packageRoot, file), "utf8").replace(/\r\n/gu, "\n") !== expected) throw new Error(`Generated third-party notice differs from source metadata: ${file}`);
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !["--check", "--write-notices"].includes(process.argv[2])) throw new Error("Use --check or --write-notices; this command never updates source review hashes.");
    if (process.argv[2] === "--write-notices") {
      const skillRoot = path.join(root, "shared/skill");
      const manifest = loadSourceProvenance(skillRoot); verifySourceProvenance({ skillRoot, manifest });
      const notice = thirdPartyNoticeMarkdown(manifest);
      for (const file of ["THIRD_PARTY_NOTICES.md", "shared/skill/references/third-party-notices.md"]) fs.writeFileSync(path.join(root, file), notice, "utf8");
      console.log(JSON.stringify({ status: "PASS", mode: "write-notices", next: "Run sync-distributions --write, then --check." }));
    } else console.log(JSON.stringify(verifySourceNotices()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
