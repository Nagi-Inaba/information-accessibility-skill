# Getting started / はじめに

This guide gives a new user one short path through the package without requiring knowledge of its internal schemas or agent graph.
このガイドは、内部スキーマやエージェント構成を先に理解しなくても、最初の1回を実行できるようにするものです。

## 1. Choose the result you need / 欲しい結果を選ぶ

| Goal / 目的 | Entry / 入口 | Result / 成果物 |
| --- | --- | --- |
| Find likely barriers and improvement ideas / 問題候補と改善案を知る | Natural-language skill or reviewer agent / 自然言語のスキル・reviewer | Review summary and human follow-up / レビュー要約と人による追加確認 |
| Create a standards ledger / 規格台帳を作る | `accessibility-audit assessment` or `generate-assessment.mjs` | JSON with every profile row initialized as `not_tested` |
| Preserve a multi-step audit trail / 監査工程を追跡する | `init` → artifacts → `merge` → `report` | Immutable run chain, merged assessment, report |

The unified CLI is primarily a record and validation control plane. The optional `capture-web-evidence.mjs` adapter can open Chromium and capture rendered DOM, accessibility-tree, focus-path, viewport, and request evidence when Playwright is installed. An actual screen-reader session remains an external human or host capability.

統一CLIは主に記録・検証のcontrol planeです。Playwrightを導入した環境では、任意の`capture-web-evidence.mjs` adapterを使ってChromiumを開き、rendered DOM、accessibility tree、focus path、viewport、request evidenceを取得できます。実機スクリーンリーダーによる確認は、引き続き外部の人またはhost capabilityが必要です。

## 2. Five-minute standalone path / 5分で試すstandalone経路

Run from the repository root. The example creates a complete WCAG 2.2 A/AA ledger whose rows remain explicitly untested, validates it, and renders a guarded report. Internal artifacts are written below the ignored `audit-runs/` directory so they are not mixed with source files.

リポジトリルートから実行します。WCAG 2.2 A/AAの全項目を明示的な`not_tested`として作成し、検証後にguard付きレポートを生成します。内部成果物は`.gitignore`対象の`audit-runs/`以下へ保存します。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --target-name "Example Site" --target-version "2026-08-23" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-23" --output .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit-runs\quickstart\audit.json --output .\audit-runs\quickstart\audit-report.md
```

Expected files / 生成物:

- `audit-runs/quickstart/audit.json`: complete profile ledger; initialization is not completed inspection / 完全な規格台帳。初期化は検査完了ではない
- `audit-runs/quickstart/audit-report.md`: reference guidance showing `未確認` until target-specific evidence and judgement are added / 対象固有の証拠と判定が入るまでは`未確認`を示す参照ガイダンス

The generator uses an exclusive safe writer. Existing files are not overwritten, and missing parent directories are created through the guarded output path.

## 3. Optional live Web evidence / 任意の実Web証拠取得

The browser adapter is optional and does not turn automated observations into a human-verified WCAG/JIS outcome.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\capture-web-evidence.mjs --url "https://example.com/" --output .\audit-runs\quickstart\web-evidence.json
```

Use the adapter only within its declared network and interaction boundary. Raw DOM and accessibility-tree evidence is internal audit material and must not be copied directly into a public report.

## 4. When to use run-backed auditing / run-backedを使う場合

Use a run when you need immutable target metadata, explicit permissions, registered evidence artifacts, external human review, remediation provenance, or retest history.

1. Initialize the run with a dedicated artifact root and explicit permissions.
2. Create the baseline assessment for the same target and profile.
3. Materialize and register screening, queue, human-review, and remediation artifacts as applicable.
4. Merge only registered artifacts into a new assessment.
5. Validate and render the guarded report.

The complete control-plane contract is documented in:

- [`agent-orchestration.md`](../codex/skills/information-accessibility-practice/references/agent-orchestration.md)
- [`standards-assessment.md`](../codex/skills/information-accessibility-practice/references/standards-assessment.md)
- [`development-web-audit-request.template.md`](../codex/skills/information-accessibility-practice/assets/development-web-audit-request.template.md)
- [`architecture-and-glossary.md`](architecture-and-glossary.md)

## 5. Evidence boundary / 証拠の境界

- AI and automated tools may create E0/E1 screening observations.
- A profile requirement becomes evaluated only through an external human review using the applicable procedure and target-specific evidence.
- Missing, uncertain, and not-applicable states remain visible; they are never converted to pass by omission.
- Browser evidence remains bound to the inspected target and environment; it is not a conformance statement by itself.
- The generated report is not third-party certification or a formal organizational conformance statement.

AI・自動処理はE0/E1のscreeningを作れます。規格条項の評価は、対象固有の証拠を伴う外部人手reviewによってのみ記録します。未確認や不明を省略して適合へ変換しません。ブラウザ証拠だけで正式な適合表明にはなりません。
