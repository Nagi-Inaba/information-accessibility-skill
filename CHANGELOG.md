# Changelog

All notable public changes to this project are documented here.

This project uses a Keep a Changelog-style structure. Until a tagged release is cut, changes remain under `Unreleased`.

## Unreleased

### Added

- Supported package/schema policy, private security-report routing, complete issue forms, versioned release notes and commit-pinned local release archives with per-file SHA-256 manifests.

- Source/version/terms register, archived W3C license editions, generated third-party notices, attribution in Markdown/HTML reports, and pending-review provenance companions for catalog refresh candidates. Package and catalog checks reject provenance or notice drift.

- Read-only `status --run ... --format text|json` with evidence validation, coverage, next transitions, operation readiness and sibling successor warnings.
- Optional declared-human `finding` details and an explicit unplanned-remediation assessment state, so a verified failure can be retained before remediation planning.
- Explicit `merge --claim-tier reference_only|screened|evaluated_subset`, checked by the same evidence guard as standalone assessments.
- `accessibility-audit scan-web` for rule-based Chromium and axe-core inspection before AI analysis.
- Strict full-scan and compact-context JSON contracts with target, engine, frame-coverage, network-policy, focus, and reflow evidence.
- Host-resolver pinning, active-channel blocking, HTTP method restrictions, and a dedicated real-Chromium E2E path for the Web scanner.
- Unified verification workflow across Ubuntu and Windows.
- Security and contributor governance documentation.

### Changed

- Browser rule findings remain machine observations with related criterion references rather than profile outcomes.
- The existing raw Web evidence adapter now shares its browser-session implementation with `scan-web` while retaining its default rendering behavior.
- Report and claim behavior is being tightened so unevaluated content cannot be presented as conforming.

### Fixed

- Current audit timestamps accept and preserve RFC 3339 offsets consistently. History, artifact input order, and fix-lease expiry compare actual instants without losing fractional precision; invalid legacy calendar values are rejected without rewriting frozen schemas.
- Claude installation uses the existing exclusive-copy routine for staging as well as activation, avoiding a native `fs.cpSync` crash observed on Windows with Node 22.19.0.
- Human findings no longer require a remediation plan when the reviewer records the required finding details; later plans preserve the original finding.
- Run-backed reports accept evidence-supported fixed claim templates and display their actual claim tier.
- Empty or incomplete profile results no longer become implicit passes.
- `screened` claims require target-specific screening evidence.
- Validation and reportability requirements for failed results are aligned.
- Assessment generation now separates templates from validated records and uses the shared safe writer.
- Additional WCAG requirement IDs used by `jp-public-web` are accepted by screening validation.
- Formal claim blockers are separated from auxiliary screening candidates.

## Compatibility notes

- Source notices are additive. Existing catalog metadata bytes and audit resource hashes are unchanged by their introduction; no audit schema migration is required. Third-party metadata retains source-specific terms, with unknown terms and uncompleted legal review explicitly recorded.

- The optional finding/status fields are additive. Existing planned findings and declared-review payloads remain valid; null remediation/verification require `remediation_status: "unplanned"`. Existing run resource hashes remain immutable. Use the pinned package for historical runs; migration across resource hashes remains Issue #28.
- `scan-web` requires axe-core `4.13.0` and the optional Playwright host capability `1.62.1` with Chromium installed.
- `scanner-import` now binds supported axe-core 4.x raw results to measured targets and registered screening evidence. Native raw JSON alone does not prove simultaneous DOM capture; unsupported scanners remain unsupported.
- **Breaking audit workflow changes:** new runs use audit-run 10.0.0 / orchestration registry 9.0.0 / envelope 3.0.0. Measured target identities, saved E1 evidence, explicit network permissions and live supervised interaction approval cannot be supplied by changing an old run's version number. Frozen run 1–9 schemas remain available for read-only use; start a new run to use current execution paths.
- **Breaking assessment change:** new assessments use 2.0.0 and bind declared human outcomes to portable review records. Assessment 1.0.0 remains readable, with human_verified treated as legacy self-declaration rather than authenticated identity. Re-review and new signatures are required where authenticated provenance is needed; no automatic migration is provided.
- Screening 3.0.0 requires saved evidence references for E1. Historical schema files and resource hashes remain unchanged; hashes and signatures must never be rewritten merely to pass current validation. See [supported versions and migration](docs/version-support.md).
- Schema or claim-boundary changes that require migration must include an explicit migration note in this file before release.
