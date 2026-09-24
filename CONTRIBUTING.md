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
npm install --no-save --ignore-scripts --package-lock=false exceljs@4.4.0
node scripts/verify-all.mjs
```

Install test dependencies at the repository root so that local `node_modules` is not part of a skill distribution. XLSX tests use the same pinned ExcelJS version as the CLI package; its dependencies retain their own licenses and are not vendored in release archives.

For focused work, the underlying checks are:

```sh
node scripts/sync-distributions.mjs --write
node scripts/verify-package.mjs
node scripts/build-criteria-catalog.mjs --check
node --test tests/*.test.mjs
```

Platform-specific behavior must remain covered by the Ubuntu/Windows CI matrix.

## Source and distribution parity

Edit common skill/runtime files in `shared/skill/`, the Codex-only `openai.yaml` overlay in `platform/codex/agents/`, and shared agent bodies and metadata in `shared/agents/`. Generate both ignored skill distributions and the agent formats with `node scripts/sync-distributions.mjs --write`, then check with `node scripts/sync-distributions.mjs --check`. Do not hand-edit generated distributions to make a parity failure disappear. `verify-all` generates missing distributions on a fresh clone; the release builder generates them from committed source in a temporary checkout.

For schema changes, document current and frozen versions, read/write support and migration limits in [version support](docs/version-support.md) and [CHANGELOG](CHANGELOG.md). Keep historical schemas and recorded resource hashes immutable. A version-number replacement is not a migration; preserve signed/submitted records and create new runs when new evidence is needed. Changes to the evidence or claim ceiling need explicit regression coverage.

Release preparation uses [the release runbook](docs/releasing.md). A local archive or a green test does not authorize publication.

## Standards and source changes

Changes to WCAG, JIS/WAIC, ARIA, Digital Agency-derived metadata, procedures, or profile composition must identify the upstream source and distinguish normative standards from organization-specific policy. Do not silently broaden a source's scope.

The weekly `source-monitor.yml` workflow and its manual trigger fetch nine fixed official pages. Its artifact contains URL, redirect, HTTP metadata and SHA-256 observations, a short review sheet, and a review-only catalog candidate with a structural diff when parsing succeeds. A changed hash, redirect, or failed fetch fails the workflow for maintainer review; a failed fetch retains the previous baseline. The candidate's date is an observation date, not approval or a renewed `last_verified_at`. The monitored page list and initial hashes are in `scripts/monitor-official-sources.mjs` and `scripts/source-monitor-baseline.json`. After checking the actual upstream changes and terms, update the baseline in a reviewed commit; update the canonical source register or CHANGELOG only when the adopted source or product behavior actually changes. The workflow never modifies tracked sources or opens Issues automatically.

The canonical source register is `shared/skill/references/third-party-sources.json`. Before adopting changed metadata:

1. Check the exact upstream version, its own terms link, attribution, modifications and any applicable share-alike obligations. W3C documents can refer to different license editions. Record unknown terms explicitly; never substitute MIT or assume legal clearance.
2. Review the candidate and its `.sources.json` companion together. The companion binds the candidate's exact bytes and source hashes, but remains `pending_source_license_review`; generating it does not approve adoption. A failed write may leave an orphan companion, which must not be treated as an adopted catalog.
3. Update the register's adopted version, source hashes and canonical resource hashes only after reviewing the actual changed content and terms. Canonical hashes use `attestationDigest` from `scripts/lib/attestation-canonical.mjs` inside the skill. No refresh command automatically renews these review hashes. Preserve archived license bytes and their raw SHA-256.
4. Regenerate notices and synchronize the distribution:

```sh
node scripts/verify-source-provenance.mjs --write-notices
node scripts/sync-distributions.mjs --write
node scripts/verify-source-provenance.mjs --check
node scripts/verify-package.mjs
node scripts/build-criteria-catalog.mjs --check
```

Package and catalog checks reject changed bound resources, unreviewed catalog sources, changed archived terms and notice drift. The register documents source review, not a legal opinion. Redistribution must retain the applicable notices, register and archived terms; standalone assessment JSON also needs those companions. Seek a scoped legal review when reuse or mixed-data share-alike scope is unresolved.

## Pull requests

Describe:

- the problem being fixed;
- the behavioral change;
- tests and verification performed;
- schema or compatibility effects;
- security/privacy effects;
- whether the change closes an issue completely or is only part of it.
