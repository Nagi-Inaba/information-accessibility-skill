# Contributing

Thank you for improving the information-accessibility skill package.

## Before opening a change

1. Search existing issues and pull requests.
2. Keep one behavior change per pull request where practical.
3. Preserve Codex and Claude distribution parity for shared runtime files.
4. Add or update regression tests for behavior changes.
5. Do not commit raw real-audit artifacts, credentials, private URLs, local paths, or personally identifying evidence. Reviewed public case-study documents must meet the conditions below.

## Public case-study documents

Edited case studies and feedback may be proposed in `docs/audits/` when the contributor is authorized to share the included material publicly and the maintainer reviews the document for privacy and evidence accuracy before merging. This is a narrow allowance for written summaries, not for raw audit artifacts. A public target URL does not establish permission to publish user testimony, personal information, or captured evidence.

- Include only observations needed to explain the case and proposed improvements. Do not include identifying user testimony or private target information.
- Keep HTML/DOM captures, screenshots, accessibility trees, recordings, assessment JSON, and run directories outside the repository.
- Identify the source of reported observations, the original inspection date, and the target version, tool version, and environment when recorded. State missing provenance rather than inventing it.
- Distinguish reported experience, observed evidence, hypotheses, unperformed tests, and proposed improvements. An editorial correction is not a new audit or human verification.
- Check criterion identifiers and result counts against the selected profile. Preserve the boundary between report-only judgements and human-verified profile outcomes.

The accepted PR records the submitted version and the maintainer's corrections; original reports need not be duplicated in the source tree.

## Verification

Run the unified verifier before requesting review:

```sh
node scripts/verify-all.mjs
```

For focused work, the underlying checks are:

```sh
node scripts/verify-package.mjs
node scripts/build-criteria-catalog.mjs --check
node --test tests/*.test.mjs
```

Platform-specific behavior must remain covered by the Ubuntu/Windows CI matrix.

## Source and distribution parity

Shared behavior exists in both the Codex and Claude distributions. Until the repository is moved to a single generated canonical source tree, shared changes must be applied to both distributions and verified with the package parity checks.

## Standards and source changes

Changes to WCAG, JIS/WAIC, ARIA, Digital Agency-derived metadata, procedures, or profile composition must identify the upstream source and distinguish normative standards from organization-specific policy. Do not silently broaden a source's scope.

## Pull requests

Describe:

- the problem being fixed;
- the behavioral change;
- tests and verification performed;
- schema or compatibility effects;
- security/privacy effects;
- whether the change closes an issue completely or is only part of it.
