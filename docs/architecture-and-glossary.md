# Information accessibility audit architecture / 情報アクセシビリティ監査の全体像

This document explains how the skill, agents, CLI, and audit artifacts work together. It is written for users who need to understand the workflow before reading schemas or implementation code.

この文書は、スキル、エージェント、CLI、成果物の関係を、スキーマや実装コードを読む前に把握できるように整理したものです。

## End-to-end flow / 全体フロー

```text
Request and named target / 依頼と対象
  ↓
information-accessibility-reviewer
  ├─ participation-oriented review / 情報利用の5観点
  └─ standards-aware audit routing / 規格監査への振り分け
       ↓
audit run + baseline assessment
  ↓
E0/E1 screening observations
  ↓
human review queue
  ↓
external human review, when performed
  ↓
remediation plan
  ↓
registered-artifact merge
  ↓
validation and public report
  ↓
change record and fresh retest, when applicable
```

Creating a baseline ledger is not the same as inspecting the target. All profile rows begin as `not_tested`. AI and automated tools may record screening observations, but only an external human review using the applicable procedure and target-specific evidence may record a profile-requirement outcome.

初期台帳の作成は、対象の検査完了を意味しません。全条項は `not_tested` から始まります。AIや自動検査はscreening observationを記録できますが、規格条項の判定は、該当手順と対象固有の証拠を用いた外部人手レビューだけが記録します。

## Three usage paths / 3つの利用経路

| Path / 経路 | Best for / 用途 | State and provenance / 状態と追跡性 |
| --- | --- | --- |
| Natural-language review / 自然言語レビュー | First-pass barriers, improvement ideas, non-Web materials, event or participation reviews | Conversational output; use structured artifacts when durable evidence is required |
| Standalone assessment / 単独評価台帳 | One validated standards ledger and one report | One JSON record; suitable for a bounded snapshot but not a multi-stage artifact history |
| Run-backed audit / 監査実行記録を使う監査 | Multi-stage screening, external review, remediation, authorization, and retest | Immutable run versions, registered artifact hashes, producer roles, and transition history |

## Components and responsibilities / 構成要素と責任範囲

| Component | Responsibility | Must not do |
| --- | --- | --- |
| `information-accessibility-practice` skill | Select the relevant references, preserve the evidence boundary, and format findings and follow-up work | Treat absent evidence as pass or invent formal conformance claims |
| `information-accessibility-reviewer` | Public entry point and orchestration | Record a human profile outcome on its own |
| `information-accessibility-e1-inspector` | Produce E0/E1 target observations from read-only inspection | Elevate observations to E2 or human-verified results |
| `information-accessibility-human-queue-planner` | Convert registered requirements and observations into human review work | Pretend that a queued item has been reviewed |
| external human reviewer | Perform the named procedure and record target-specific evidence and outcome | Claim broader scope than the performed review supports |
| `information-accessibility-remediation-planner` | Connect verified failures or unverified candidates to proposed changes and retest steps | Change the target or turn candidates into verified failures |
| unified CLI | Create, validate, register, merge, and report records | Open a browser or obtain an accessibility tree unless a host integration provides that capability |
| authorized fixer feature | Prepare or execute separately authorized change workflows through bounded runtime contracts | Mutate targets without explicit authorization and verification bindings |

## Artifact map / 成果物の関係

| Artifact | Typical producer | Main inputs | Purpose | Public by default? |
| --- | --- | --- | --- | --- |
| `audit-run` | orchestrator/runtime | target, profile, scope, environment, permissions | Immutable control-plane state and transition history | No; contains internal paths, IDs, and hashes |
| baseline assessment | generator/orchestrator | profile catalog and target metadata | Complete ledger initialized as `not_tested` | Internal until reviewed and sanitized |
| `screening-observations` | E1 inspector or importer | target observations | E0/E1 candidates and report-only mappings | Summarized only |
| `human-review-queue` | queue planner | profile lookup and screening observations | Procedures and evidence requested from a person | Usually internal work material |
| `declared-human-review` | external human reviewer | queue, target-specific evidence | Profile outcomes and rationale | Summarized with privacy controls |
| `remediation-plan` | remediation planner | verified failures and screening candidates | Proposed change, priority, ownership, and verification | Selected fields may be public |
| merged assessment | deterministic merge runtime | registered artifacts | Canonical standards record for the current run | Input to validation/reporting |
| public report | renderer | validated assessment and run evidence | Human-readable bounded result | Yes, after publication review |
| change record | trusted runtime or declared external process | authorization and measured target change | Before/after provenance and retest requirement | Internal audit trail |

## Evidence levels / 証拠レベル

| Level | Meaning |
| --- | --- |
| E0 | Reference material or an initialized ledger; no target conclusion |
| E1 | Read-only automated or AI-assisted screening observation tied to the target |
| E2 | External human review of a subset using target-specific manual or hybrid evidence |
| E3 | Broader interaction evidence including keyboard and relevant assistive technology in a declared environment |
| E4 | Independent audit evidence with scope, method, evaluator independence, and report location |
| E5 | Organization-ready legal or procurement dossier with responsible ownership and retained artifacts |

A higher declared level must be supported by the evidence actually recorded. A profile's implementation status and method coverage may impose a lower claim ceiling.

## Bilingual glossary / 日英用語対応表

Human-facing documents may use natural Japanese or English, while machine-readable IDs and enum values remain unchanged. The following translations are the preferred terms for documentation and review handoffs.

人向け文書では自然な日本語または英語を使いますが、機械可読なIDとenum値は翻訳しません。文書と引き継ぎでは、次の対応語を優先します。

| English | 日本語 | Meaning / 意味 |
| --- | --- | --- |
| Natural-language review | 自然言語レビュー | A conversational first pass that identifies likely barriers, improvements, and follow-up work / 問題候補、改善案、追加確認を会話形式で整理する入口 |
| standalone assessment | 単独評価台帳 | One validated assessment JSON for a bounded snapshot, without a multi-stage artifact history / 一時点の対象を1つのassessment JSONで記録する経路 |
| run-backed audit | 監査実行記録を使う監査 | A multi-stage audit whose artifacts and transitions are bound to immutable run versions / artifactと状態遷移を不変のrun版へ結び付ける監査 |
| audit run | 監査実行記録 | Control-plane record containing target metadata, permissions, registered artifacts, and history / 対象、権限、登録成果物、履歴を保持する制御記録 |
| baseline assessment | 初期評価台帳 | A complete profile ledger initialized as `not_tested` / 全profile条項を`not_tested`で初期化した台帳 |
| screening observation | スクリーニング観測 | E0/E1 automated or AI-assisted evidence that may inform a report but is not a formal profile outcome / レポート判断の参考にはなるが正式な条項判定ではないE0／E1観測 |
| profile requirement | プロファイル条項 | A standards requirement that may receive an allowed human-reviewed outcome / 許可された人手レビュー経路で判定を記録できる規格条項 |
| human review queue | 人手確認キュー | A worklist containing the procedure, location, and evidence requested from a person / 人に依頼する手順、対象箇所、必要証拠をまとめた作業一覧 |
| declared human review | 申告された人手レビュー | A human-supplied review artifact; identity assurance is tracked separately / 人が提出したreview artifact。本人性の保証は別に扱う |
| remediation plan | 改善計画 | Proposed changes, priority, ownership, and verification steps / 改善案、優先度、担当、再確認手順の記録 |
| report-only judgement | レポート専用判定 | A human-readable projection of limited screening evidence, not a machine-readable profile outcome / 限定的なscreening evidenceを人向けに示す表示であり、機械可読な条項判定ではない |
| claim tier | 主張可能範囲 | The strongest registered wording supported by the evidence and profile ceiling / 証拠とprofile上限が許す最も強い固定表現 |
| public report | 公開用レポート | A sanitized, human-readable result intended for sharing after publication review / 公開前確認とsanitizationを経て共有する人向け成果物 |
| retest | 再検査 | A fresh audit after a measured target change; prior evidence is not silently inherited / 対象変更後に新しく行う検査。以前の証拠は自動継承しない |

## Requirement terminology / 条項に関する用語

| Term | Meaning |
| --- | --- |
| profile | A versioned set of requirements and report groups, such as WCAG 2.2 A/AA |
| profile requirement | A standards requirement that may receive a human-reviewed outcome |
| `SCREEN-*` | A supporting check or target observation; never a formal profile outcome by itself |
| criterion-specific procedure | A detailed, versioned human review procedure for one requirement |
| generic playbook | A family-level fallback method when no criterion-specific procedure is bundled |
| mapping status | Whether the profile row is still unverified or was recorded through an allowed human-review path |
| report-only judgement | A public presentation of limited screening evidence; not a machine-readable profile outcome |
| claim tier | The strongest fixed wording supported by the recorded evidence and profile ceiling |

## Information-use perspectives / 情報利用の5観点

The participation-oriented review is related to, but distinct from, WCAG or JIS outcomes.

1. **Find / 見つける** — Can the intended audience locate the information?
2. **Receive / 受け取る** — Can they receive it in a usable form through text, audio, image alternatives, assistive technology, or saved records?
3. **Understand / 理解する** — Are structure, wording, dates, links, charts, and technical terms understandable?
4. **Participate / 行動する** — Can they register, ask, submit, use the service, request support, or otherwise complete the intended action?
5. **Continue / 後から確認する** — Can they retrieve summaries, materials, decisions, and next steps later?

These perspectives may reveal barriers that do not map neatly to a single standards criterion. They must not be converted automatically into WCAG/JIS pass or fail outcomes.

## Target support matrix / 対象別の対応状況

| Target | Natural-language review | Structured screening | Standards ledger | Formal claim target |
| --- | --- | --- | --- | --- |
| Web site or Web application | Supported | Supported when the host provides browser capabilities | `web-modern`, `jp-public-web` | Limited by method and human-review coverage |
| PDF, document, or slide | Supported | Guidance-oriented | No active dedicated profile in the current release | No |
| Video or audio | Supported | Guidance-oriented | May be reviewed through relevant Web profile rows when embedded in a named Web scope | No standalone media claim |
| Event, meeting, or community process | Supported | Guidance-oriented | No active dedicated profile in the current release | No |
| Authoring tool / AI authoring process | Reference guidance | Partial | `authoring-agent` remains inactive | No current structured claim path |

## Public and internal boundaries / 公開範囲

Run IDs, artifact IDs, hashes, local paths, private URLs, raw evidence, authorization details, and reviewer personal data are internal unless an explicit publication policy permits them. The public report should retain useful target, finding, evidence-strength, limitation, and follow-up information without exposing control-plane metadata.
