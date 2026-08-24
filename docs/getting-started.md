# Getting started / はじめに

This guide gives a new user one short path through the package without requiring knowledge of its internal schemas or agent graph.
このガイドは、内部スキーマやエージェント構成を先に理解しなくても、最初の1回を実行できるようにするものです。

## 1. Choose the result you need / 欲しい結果を選ぶ

| Goal / 目的 | Entry / 入口 | Result / 成果物 |
| --- | --- | --- |
| Find machine-detectable Web barriers / Webの機械検出可能な問題を調べる | `accessibility-audit scan-web` | Full internal scan and compact AI context / 内部用scanとAI用context |
| Find likely barriers and improvement ideas / 問題候補と改善案を知る | Natural-language skill or reviewer agent / 自然言語のスキル・reviewer | Review summary and human follow-up / レビュー要約と人による追加確認 |
| Create a standards ledger / 規格台帳を作る | `accessibility-audit assessment` | JSON with every profile row initialized as `not_tested` |
| Preserve a multi-step audit trail / 監査工程を追跡する | `init` → artifacts → `merge` → `report` | Immutable run chain, merged assessment, report |

Before choosing a longer flow, inspect the installed version, active profiles, requirement catalog, and optional browser capability. The commands are read-only and return machine-readable output where appropriate.
長い監査フローへ進む前に、導入版、active profile、条項カタログ、任意のbrowser capabilityをread-onlyで確認できます。

```powershell
accessibility-audit --version
accessibility-audit profiles list
accessibility-audit requirements show 1.1.1 --profile web-modern
accessibility-audit requirements search "フォーカス" --profile web-modern
accessibility-audit requirements search "focus" --profile web-modern --level AA
accessibility-audit doctor
```

For complete, reproducible examples of Natural-language review, a Standalone ledger, and a Run-backed audit, see the [runnable examples](../examples/README.md).
自然言語レビュー、standalone台帳、run-backed監査を最初から最後まで再現する場合は、[実行可能なexamples](../examples/README.md)を参照してください。

The unified CLI manages records and validation and now also exposes a rule-based browser scan. The browser capability requires the exact supported Playwright and axe-core versions. An actual screen-reader session remains an external human or host capability.

## 2. Five-minute standalone ledger / 5分で試すstandalone台帳

Run from the repository root. The example creates a complete WCAG 2.2 A/AA ledger whose rows remain explicitly untested, validates it, and renders a guarded profile-aware report. Internal artifacts are written below the ignored `audit-runs/` directory so they are not mixed with source files.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs assessment --profile web-modern --target-name "Example Site" --target-version "2026-08-24" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-24" --output .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs validate-assessment .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs report --input .\audit-runs\quickstart\audit.json --locale ja --output .\audit-runs\quickstart\audit-report.md
```

Expected files / 生成物:

- `audit-runs/quickstart/audit.json`: complete profile ledger; initialization is not completed inspection / 完全な規格台帳。初期化は検査完了ではない
- `audit-runs/quickstart/audit-report.md`: profile-aware report showing every criterion as `未確認`／`Not tested` until target-specific evidence and judgement are added

The report displays criterion number, localized title, level, profile group, primary source, judgement source, evidence level, and rationale. Use `--locale ja` or `--locale en` for human-readable text; requirement IDs and enum values do not change.
レポートには条項番号、名称、レベル、profile group、一次資料、判定の出所、証拠レベル、根拠が表示されます。`--locale ja`と`--locale en`は人向け表示だけを変更し、内部IDやenumは変更しません。

The claim section separately shows the requested tier and the validator maximum tier. It uses only fixed wording registered in `standards-registry.json`; report judgement labels are not a formal conformance declaration.
主張可能な範囲では、要求されたtierと検証上限tierを分離し、registryに登録された固定表現だけを表示します。レポートの判定語だけで正式な適合表明を行うことはできません。

The generator and report writer use exclusive safe outputs. Existing files are not overwritten, and missing parent directories are created through the guarded output path.

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

Run-backed reporting uses the same profile title, criterion metadata, group counts, locale contract, and claim section as standalone reporting. Each row distinguishes external human review, AI/automated screening projection, and a check that was not run. Screening projections remain report-only judgements and never become `human_verified` profile outcomes.
run-backedレポートもstandaloneと同じ表示規則を使い、各行で外部人手レビュー、AI／自動スクリーニング、未実施を区別します。screening projectionはreport-only judgementであり、`human_verified`へ自動昇格しません。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs report --run .\audit-runs\example\audit-run.json --assessment .\audit-runs\example\merged-assessment.json --locale en --output .\audit-runs\example\audit-report.en.md
```

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
