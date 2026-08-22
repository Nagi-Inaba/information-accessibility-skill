# Getting started / はじめに

This guide gives a new user one short path through the package without requiring knowledge of its internal schemas or agent graph.
このガイドは、内部スキーマやエージェント構成を先に理解しなくても、最初の1回を実行できるようにするものです。

## 1. Choose the result you need / 欲しい結果を選ぶ

| Goal / 目的 | Entry / 入口 | Result / 成果物 |
| --- | --- | --- |
| Find likely barriers and improvement ideas / 問題候補と改善案を知る | Natural-language skill or reviewer agent / 自然言語のスキル・reviewer | Review summary and human follow-up / レビュー要約と人による追加確認 |
| Create a standards ledger / 規格台帳を作る | `assessment create` | JSON with every profile row initialized as `not_tested` |
| Preserve a multi-step audit trail / 監査工程を追跡する | `init` → artifacts → `merge` → `report` | Immutable run chain, merged assessment, report |

The CLI is a record and validation control plane. It does not open a browser or obtain an accessibility tree by itself.
CLIは記録・検証のcontrol planeであり、それ単体でブラウザーを開いたりaccessibility treeを取得したりはしません。

## 2. Five-minute standalone path / 5分で試すstandalone経路

Run from the repository root. The example creates a complete WCAG 2.2 A/AA ledger whose rows remain explicitly untested, validates it, and renders a guarded report.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --target-name "Example Site" --target-version "2026-08-23" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-23" --output .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit.json --output .\audit-report.md
```

Expected files / 生成物:

- `audit.json`: complete profile ledger; initialization is not completed inspection / 完全な規格台帳。初期化は検査完了ではない
- `audit-report.md`: human-readable report showing `未確認` until evidence is added / 証拠追加前は未確認と示すレポート

## 3. When to use run-backed auditing / run-backedを使う場合

Use a run when you need immutable target metadata, explicit permissions, registered evidence artifacts, external human review, remediation provenance, or retest history.

1. Create an empty artifact directory and initialize the run.
2. Create the baseline assessment for the same target and profile.
3. Materialize and register screening, queue, human-review, and remediation artifacts as applicable.
4. Merge only registered artifacts into a new assessment.
5. Validate and render the public report.

The complete control-plane contract is documented in:

- [`agent-orchestration.md`](../codex/skills/information-accessibility-practice/references/agent-orchestration.md)
- [`standards-assessment.md`](../codex/skills/information-accessibility-practice/references/standards-assessment.md)
- [`development-web-audit-request.template.md`](../codex/skills/information-accessibility-practice/assets/development-web-audit-request.template.md)
- [`architecture-and-glossary.md`](architecture-and-glossary.md)

## 4. Evidence boundary / 証拠の境界

- AI and automated tools may create E0/E1 screening observations.
- A profile requirement becomes evaluated only through an external human review using the applicable procedure and target-specific evidence.
- Missing, uncertain, and not-applicable states remain visible; they are never converted to pass by omission.
- The generated report is not third-party certification or a formal organizational conformance statement.

AI・自動処理はE0/E1のscreeningを作れます。規格条項の評価は、対象固有の証拠を伴う外部人手reviewによってのみ記録します。未確認や不明を省略して適合へ変換しません。
