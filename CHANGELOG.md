# Changelog

All notable public changes to this project are documented here.

This project uses a Keep a Changelog-style structure. Until a tagged release is cut, changes remain under `Unreleased`.

## Unreleased

### Added

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

- Empty or incomplete profile results no longer become implicit passes.
- `screened` claims require target-specific screening evidence.
- Validation and reportability requirements for failed results are aligned.
- Assessment generation now separates templates from validated records and uses the shared safe writer.
- Additional WCAG requirement IDs used by `jp-public-web` are accepted by screening validation.
- Formal claim blockers are separated from auxiliary screening candidates.

## Compatibility notes

- `scan-web` requires axe-core `4.13.0` and the optional Playwright host capability `1.62.1` with Chromium installed.
- `automated-web-scan-context` is experimental until the later run-artifact import and binding slice is complete.
- Schema or claim-boundary changes that require migration must include an explicit migration note in this file before release.
