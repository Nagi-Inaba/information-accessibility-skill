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
| Standalone assessment | One validated standards ledger and one report | One JSON record; suitable for a bounded snapshot but not a multi-stage artifact history |
| Run-backed audit | Multi-stage screening, external review, remediation, authorization, and retest | Immutable run versions, registered artifact hashes, producer roles, and transition history |

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
