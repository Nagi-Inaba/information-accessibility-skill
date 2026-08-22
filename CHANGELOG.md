# Changelog

All notable public changes to this project are documented here.

This project uses a Keep a Changelog-style structure. Until a tagged release is cut, changes remain under `Unreleased`.

## Unreleased

### Added

- Unified verification workflow across Ubuntu and Windows.
- Security and contributor governance documentation.

### Changed

- Report and claim behavior is being tightened so unevaluated content cannot be presented as conforming.

### Fixed

- Empty or incomplete profile results no longer become implicit passes.
- `screened` claims require target-specific screening evidence.
- Validation and reportability requirements for failed results are aligned.
- Assessment generation now separates templates from validated records and uses the shared safe writer.
- Additional WCAG requirement IDs used by `jp-public-web` are accepted by screening validation.
- Formal claim blockers are separated from auxiliary screening candidates.

## Compatibility notes

Schema or claim-boundary changes that require migration must include an explicit migration note in this file before release.
