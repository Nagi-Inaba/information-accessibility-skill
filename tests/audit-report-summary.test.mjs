import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { summarizeAuditReport } from "../codex/skills/information-accessibility-practice/scripts/summarize-audit-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fullReport = `# WCAG検査レポート

> Notice

## 1. 総合判定

- 総合判定: 不適合

## 2. 検査対象

- 対象: Example

## 3. 達成基準別の判定

| 達成基準 | 判定 |
| --- | --- |
| 1.1.1 | 不適合 |
| 1.2.1 | 未確認 |

## 4. 改善事項

| 問題 | 改善案 |
| --- | --- |
| 画像の目的が不明 | 代替テキストを修正 |

## 7. 記録の範囲

- 人による確認済み: 1/55
`;

test("summary retains decisions and improvements but removes the criterion appendix", () => {
  const summary = summarizeAuditReport(fullReport);
  assert.match(summary, /総合判定: 不適合/u);
  assert.match(summary, /画像の目的が不明/u);
  assert.match(summary, /人による確認済み: 1\/55/u);
  assert.doesNotMatch(summary, /## 3\. 達成基準別の判定/u);
  assert.doesNotMatch(summary, /\| 1\.2\.1 \| 未確認 \|/u);
  assert.match(summary, /全達成基準[^\n]*完全版レポート/u);
});

test("summary CLI writes a new file without changing the complete report", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "report-summary-"));
  const input = path.join(temp, "full.md");
  const output = path.join(temp, "summary.md");
  fs.writeFileSync(input, fullReport);
  const script = path.join(root, "codex/skills/information-accessibility-practice/scripts/summarize-audit-report.mjs");
  const result = spawnSync(process.execPath, [script, "--input", input, "--output", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(input, "utf8"), fullReport);
  assert.match(fs.readFileSync(output, "utf8"), /要約版/u);
});

test("Codex and Claude summary renderers remain byte-identical", () => {
  const codex = fs.readFileSync("codex/skills/information-accessibility-practice/scripts/summarize-audit-report.mjs", "utf8");
  const claude = fs.readFileSync("claude/skills/information-accessibility-practice/scripts/summarize-audit-report.mjs", "utf8");
  assert.equal(codex, claude);
});
