# Audit orchestration boundary

## Current runtime contract

`audit-run` and all role artifacts are internal traceability records. Registered role artifacts preserve the declared producer, inputs, resource hashes, permissions, and transition records required to validate an audit workflow. They are not public findings and do not raise the assessment evidence level.

Specialist agents return candidate envelope JSON only. They must not write or materialize an artifact file and must not claim that their candidate is validated. The orchestrator alone materializes a new artifact under `artifact_root`, validates it, and invokes `register-audit-artifact.mjs`. A candidate is treated as validated only after that registration succeeds for the same run.

The orchestration registry is authoritative for role output types and allowed transitions. A transition is accepted only when its required artifact type is present, the artifact envelope names the registered producer role, its input belongs to the same run, has an exact SHA-256 matching a registered artifact, and its payload passes the registered schema. The `input_types` array order is part of the canonical serialized role contract. Schema validation does not authenticate identity or grant authorization. No AI role can record a profile outcome or produce `fix-authorization`. The non-default `authorized_fixer` role is reserved for a separately installed workflow and an exact validated authorization.

This contract layer does not execute commands or write the audited target.

The current read-only boundary is a behavioral contract, not a complete tool sandbox. Agent instructions prohibit target writes, authentication, forms, and state-changing interaction. They do not by themselves provide an operating-system or browser enforcement boundary.

`audit-run` schema version 3.0.0 and the current registry define the run-backed flow. The reviewer dispatches applicable specialists, the orchestrator materializes and registers candidates, `merge-audit-artifacts.mjs` produces the assessment, and `render-audit-report.mjs` with `--run` `<run.json>`, `--assessment` `<merged.json>`, and `--output` `<new-report.md>` creates the public report through stable and safe runtime checks.

## Public reporting boundary

The public report must never expose internal agent identifiers, run IDs, orchestration history, transition history, state history, local paths, Git branches, or raw artifact envelopes. It may publish only target and scope context, results with their evidence level, limitations, human checks, remediation, and retest information accepted by the report validator.

## Future mechanical enforcement

The following are future acceptance criteria and not yet implemented guarantees. Task 8 must provide a pre-execution enforcement layer that permits only an allowlisted executable with allowlisted arguments, applies a pre-execution `artifact_root` write gate, and ensures target-derived commands are never executed. It must deny authentication, form submission, and state-changing interactions. A malicious fixture must prove that target and out-of-scope hashes remain unchanged, and the result must include denial proof from the execution gate.

Task 9 must add a public-report privacy scan for local paths, private URLs, person names, and sensitive evidence. Until that scan exists and passes, distribution remains subject to the documented public-report review boundary rather than an implemented privacy guarantee.
