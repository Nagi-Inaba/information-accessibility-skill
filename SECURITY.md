# Security Policy

## Supported versions

Security fixes target the current `main` branch and the latest published release, when one exists. Older development commits do not receive separate backports. Package `0.1.0` is still an untagged development series as of 2026-09-19; identify it by its full commit, not by the package version alone. See [supported versions and migration](docs/version-support.md).

## Reporting a vulnerability

Do not publish exploit details, credentials, private audit artifacts, local paths, or target-specific evidence in a public issue.

Use [Report a vulnerability](https://github.com/Nagi-Inaba/information-accessibility-skill/security/advisories/new) to send a private report to the repository maintainers. This route requires GitHub sign-in and repository private vulnerability reporting to be enabled. If it is unavailable, open a public issue asking only for a private contact channel; do not include the affected target, exploit, credentials or evidence. No maintainer email address should be inferred from Git history.

For ordinary non-sensitive defects, use the [bug report form](https://github.com/Nagi-Inaba/information-accessibility-skill/issues/new?template=bug.yml) with synthetic data. GitHub's [private reporting guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately) explains the reporting flow.

Please include:

- affected version or commit;
- affected command, script, or artifact type;
- reproduction steps using synthetic data where possible;
- expected and actual behavior;
- security impact and relevant trust boundary.

The maintainers will acknowledge and triage reports as capacity permits; no guaranteed response time or bounty is offered. Coordinate disclosure privately until a fix or mitigation is available. Report receipt, a proposed patch, and a published fix are separate states.

Scope includes network restrictions, filesystem confinement, private evidence redaction, artifact integrity, authorization/fixer boundaries and reviewer/bundle verification. A correct signature authenticates a signed record under the selected trust policy; it does not establish the truth of its accessibility conclusions.
