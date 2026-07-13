# Standards Assessment

Use this reference only when the user asks for standards-based evaluation, evidence records, procurement support, or conformance wording. Keep the five-gate participation review as a separate result.

## 1. Select The Profile

Read `standards-registry.json` and select a profile:

- `web-modern`: web pages and web applications evaluated against WCAG 2.2 Level A and AA. Apply WAI-ARIA requirements only where ARIA is used.
- `jp-public-web`: Japanese public-facing web content evaluated against JIS X 8341-3:2016 Level A and AA plus the 18 WCAG 2.2 A/AA criteria not included in that JIS edition. Keep the JIS and added-WCAG results distinguishable.
- `authoring-agent`: planned profile for this skill or another authoring process component against applicable ATAG 2.0 Part B Level A and AA criteria. In the current release it is reference-only because the criterion catalog and feature mapping are not bundled.
- `participation-practice`: the five-gate model only. It is not a formal conformance profile.

The current release contains complete A/AA criterion metadata for `web-modern` (55 records) and `jp-public-web` (38 JIS records plus 18 separately identified additions). It does not contain a complete executable test procedure for every criterion. Its maximum claim tier is therefore `evaluated_subset` for active Web profiles and `reference_only` for `authoring-agent`. Treat all planned profiles as guidance-only.

## 2. Fix The Scope Before Testing

Record:

- target name, version, commit, URL, or file;
- included and excluded pages, states, files, technologies, and third-party content;
- complete user processes such as sign-up, purchase, submission, recovery, or export;
- test environment, browsers, assistive technologies, and input modes;
- evaluator role, evaluation date, limitations, and next review date.

For WCAG, conformance applies to full pages and complete processes, not selected components. A representative sample can support evaluation work, but it does not by itself prove that an unsampled site conforms.

## 3. Record Requirement Results

Start from a generated full-profile record so omissions remain visible:

Resolve `<skill_root>` as the directory containing the active `SKILL.md`; do not assume the audited target's working directory contains the scripts.

```powershell
node <skill_root>/scripts/generate-assessment.mjs --profile web-modern --output <assessment.json>
node <skill_root>/scripts/generate-assessment.mjs --profile jp-public-web --output <assessment.json>
```

The generator refuses to overwrite an existing file and initializes every requirement as `not_tested`, with E0 evidence and `reference_only` wording.

Before changing a row from `not_tested`, follow its `method_key` in `web-audit-methods.json`, open the row's exact primary and official method sources, determine applicability, and record target-specific evidence. The family playbook is a reproducibility floor; the normative criterion and criterion-specific Understanding material control the evaluation.

Use exactly one outcome for each requirement:

- `pass`: the applicable requirement was tested and the evidence supports it.
- `fail`: the evidence shows that the requirement is not met.
- `not_applicable`: the applicability condition is false; record the rationale.
- `not_tested`: the requirement is in scope but has not been tested.
- `cant_tell`: available evidence cannot support a result; state what evidence is missing.

Never infer `pass` from absence of an automated finding. Never hide `not_tested` or `cant_tell` in an average score.

For every `fail`, add an `assessment.findings` record. Use `P0`, `P1`, or `P2`; reference the failed requirement ID; and record the exact location, affected users, observation, remediation, and retest method. The validator rejects a new-style record that contains a failed result without a linked finding. A finding may omit requirement IDs only when it documents a participation issue that has no corresponding standards result.

Classify every result:

- Use `screening_check` with a `SCREEN-` identifier for automated, static, or exploratory checks. Keep `mapping_status` as `unverified` and set `method_kind` to `automated`, `manual`, or `hybrid` explicitly.
- Use `profile_requirement` only when its ID is present in the selected profile's registry list, a person maps it to the registered primary-source document, and `mapping_status` is `human_verified`.
- Use only the evidence types allowed by the JSON schema. E2 or higher requires at least one human-verified profile requirement with `method_kind: manual` or `hybrid` and at least one enumerated manual evidence item. Screening checks and automated evidence alone cannot raise the record above E1.

For repeatable checks, structure the method after ACT Rules Format 1.1: identifier, plain-language description, requirement mapping, input aspects, applicability, expectations, assumptions, accessibility support, examples, and rule version. Do not reproduce copyrighted ISO or JIS text; store identifiers, public URLs, and an original summary.

## 4. Grade Evidence Separately

| Level | Minimum meaning | Safe description |
| --- | --- | --- |
| E0 Guidance | Advice based on a profile; no target testing | Profile-informed guidance |
| E1 Screening | Automated, static, or limited spot checks | Screened; not a conformance evaluation |
| E2 Criterion Review | Applicable requirements reviewed manually with recorded evidence | Evaluated against the named profile; results and limits apply |
| E3 Interaction Verified | Complete processes plus keyboard, device, and relevant assistive-technology checks | Candidate for human conformance review only if the result set is complete |
| E4 Independent Audit | Independent evaluator, representative scope, environments, and publishable report | Independent audit evidence; responsibility remains with the claimant |
| E5 Legal/Procurement Dossier | Audit plus declaration, ACR/statement, exceptions, ownership, and complaint route | Legal or procurement review package; not legal advice |

The evidence level describes the assessment process, not the accessibility quality of the target.

For E4, complete the independent-audit assurance fields with evaluator independence, scope method, and report location. For E5, also record the responsible dossier owner and dossier artifacts. The validator rejects self-declared E4/E5 values without these records.

## 5. Apply The Claim Guard

Use these claim tiers:

- `reference_only`: no target evaluation or only E0 evidence.
- `screened`: limited E1 checks; never use `conforms`, `complies`, `準拠`, or `適合`.
- `evaluated_subset`: E2 or higher evidence is recorded for named requirements, with results and limitations disclosed. This is the highest tier available in the current release.
- `evaluated_complete`, `conformance_candidate`, and `human_signoff_required`: reserved for a future release with a complete applicable requirement catalog and additional profile conditions.

The validator never declares conformance. It rejects internally inconsistent records and enforces the current profile ceiling. Even E3-E5 evidence cannot raise a metadata-complete but method-incomplete profile above `evaluated_subset`.

In the current metadata-catalog release, set `proposed_wording` to one of the exact Japanese or English templates in `standards-registry.json` for the requested tier. A tier without a registered template and all free-form claim wording are rejected. State target-specific checks, observations, and unreviewed scope in the separate human-readable summary, not by editing the registered claim template.

Additional profile rules:

- WCAG claims must identify the claim date, WCAG title/version/URI, level, scoped pages, and relied-upon technologies.
- WAIC `準拠` requires the published accessibility policy, testing, all target criteria passed, and published test results. `一部準拠` and `配慮` have different conditions; do not collapse them.
- Do not describe JIS X 8341-3:2016 as WCAG 2.2. For `jp-public-web`, report the JIS result and the 18 additional WCAG 2.2 results separately.
- For ATAG, name the exact process component and produced technology. Do not imply full-tool or Part A conformance when those were not evaluated.

## 6. Produce And Validate The Record

1. Generate a new working record with `generate-assessment.mjs`; use the blank template only for an unsupported or planned profile.
2. Replace all placeholders, fix scope and environment, and record target-specific evidence.
3. Run:

```powershell
node <skill_root>/scripts/validate-assessment.mjs <assessment.json>
```

4. Report validation errors before making any claim proposal.
5. Confirm `catalog_coverage.complete`, then separately inspect `evaluation_coverage`; never describe catalog completeness as audit completeness. Use `profile_outcome_counts` for registered requirements, `screening_outcome_counts` for supporting checks, and `profile_group_outcome_counts` for profile subgroups. `outcome_counts` is a legacy aggregate across all result kinds.
6. Generate the standalone report only after validation:

```powershell
node <skill_root>/scripts/render-audit-report.mjs --input <assessment.json> --output <report.md>
```

The renderer refuses invalid input and existing output files. It reports failures, untested items, `cant_tell` items, claim eligibility, structured findings, and required retests without inferring conformance.

## Non-Goals

- Do not provide legal certification, W3C certification, JIS marks, or a generic accessibility score.
- Do not treat VPAT as a certification.
- Do not use a Web profile as a complete PDF, native-app, event, or organization profile.
- Do not promote planned profiles to active without adding their applicable requirement sets, test methods, and claim rules.
