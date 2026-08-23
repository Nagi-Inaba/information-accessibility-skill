# Getting started / はじめに

This guide gives a new user one short path through the package without requiring knowledge of its internal schemas or agent graph.
このガイドは、内部スキーマやエージェント構成を先に理解しなくても、最初の1回を実行できるようにするものです。

## 1. Choose the result you need / 欲しい結果を選ぶ

| Goal / 目的 | Entry / 入口 | Result / 成果物 |
| --- | --- | --- |
| Find machine-detectable Web barriers / Webの機械検出可能な問題を調べる | `accessibility-audit scan-web` | Full internal scan and compact AI context / 内部用scanとAI用context |
| Find likely barriers and improvement ideas / 問題候補と改善案を知る | Natural-language skill or reviewer agent / 自然言語のスキル・reviewer | Review summary and human follow-up / レビュー要約と人による追加確認 |
| Create a standards ledger / 規格台帳を作る | `accessibility-audit assessment` or `generate-assessment.mjs` | JSON with every profile row initialized as `not_tested` |
| Preserve a multi-step audit trail / 監査工程を追跡する | `init` → artifacts → `merge` → `report` | Immutable run chain, merged assessment, report |

The unified CLI manages records and validation and now also exposes a rule-based browser scan. The browser capability requires the exact supported Playwright and axe-core versions. An actual screen-reader session remains an external human or host capability.

## 2. Five-minute standalone ledger / 5分で試すstandalone台帳

Run from the repository root. The example creates a complete WCAG 2.2 A/AA ledger whose rows remain explicitly untested, validates it, and renders a guarded report. Internal artifacts are written below the ignored `audit-runs/` directory so they are not mixed with source files.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --target-name "Example Site" --target-version "2026-08-23" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-23" --output .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit-runs\quickstart\audit.json --output .\audit-runs\quickstart\audit-report.md
```

Expected files / 生成物:

- `audit-runs/quickstart/audit.json`: complete profile ledger; initialization is not completed inspection / 完全な規格台帳。初期化は検査完了ではない
- `audit-runs/quickstart/audit-report.md`: reference guidance showing `未確認` until target-specific evidence and judgement are added / 対象固有の証拠と判定が入るまでは`未確認`を示す参照ガイダンス

The generator uses an exclusive safe writer. Existing files are not overwritten, and missing parent directories are created through the guarded output path.

## 3. Rule-based live Web scan / ルールベースの実Web検査

Install the optional browser capability:

```powershell
npm install --no-save --package-lock=false playwright@1.62.1 axe-core@4.13.0
npx playwright@1.62.1 install chromium
```

Then run:

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs scan-web --url "https://example.com/" --profile web-modern --output .\audit-runs\quickstart\automated-scan.json --context-output .\audit-runs\quickstart\automated-scan.context.json
```

Use `automated-scan.context.json` as the first AI input. It contains machine violations, unresolved review candidates, coverage, focus, and reflow summaries without the raw DOM or full accessibility tree. Open `automated-scan.json` only when the compact item needs its bounded HTML, selector, frame, or raw evidence context.

See [`web-inspection.md`](web-inspection.md) for network, interaction, output, and dependency details.

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
- Raw browser and scanner outputs are internal audit material and should not be copied directly into a public report.
