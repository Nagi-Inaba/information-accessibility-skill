# Audit orchestration boundary

## Current runtime contract

`audit-run` and all role artifacts are internal traceability records. Registered role artifacts preserve the declared producer, inputs, resource hashes, permissions, and transition records required to validate an audit workflow. They are not public findings and do not raise the assessment evidence level.

Specialist agents return candidate envelope JSON only. They must not write or materialize an artifact file and must not claim that their candidate is validated. The orchestrator alone materializes a new artifact under `artifact_root`, validates it, and invokes `register-audit-artifact.mjs`. A candidate is treated as validated only after that registration succeeds for the same run.

The orchestration registry is authoritative for role output types and allowed transitions. A transition is accepted only when its required artifact type is present, the artifact envelope names the registered producer role, its input belongs to the same run, has an exact SHA-256 matching a registered artifact, and its payload passes the registered schema. The `input_types` array order is part of the canonical serialized role contract. Schema validation does not authenticate identity or grant authorization. No AI role can record a profile outcome or produce `fix-authorization`. The non-default `authorized_fixer` role is reserved for a separately installed workflow and an exact validated authorization.

The authorized fixer distribution is installed only with `-IncludeAuthorizedFixer`. It is a read-only handoff agent with no generic command or write access. In registry 17 its output is a `fix-handoff` artifact and `can_write_target` is false. The orchestrator registers the candidate while the run is `fix_authorized`. A trusted operator invokes the installed runtime with that handoff. The separate `trusted_fix_executor` role is the only target writer and produces `change-record` 3 after the runtime executes the exact handoff.

Schema validation alone does not execute commands or write the audited target. A run 4 record with `source_write: authorized_only` declares only `command_execution: authorized_verification_only`; it grants no generic command execution. Target mutation is available only through `apply-authorized-fix.mjs`, after the runtime validates a current authorization envelope, the current run, the registered remediation binding, an independently supplied source root, and an exact change binding. Each binding fixes the relative path, operation, expected before SHA-256, and expected after SHA-256; the runtime checks the caller request, replacement bytes, and measured target state against those authorized hashes.

The authorized-fix runtime requires a registered `fix-handoff` and declared operator ID. It accepts only `create`, `modify`, or `delete` with bounded UTF-8 content. It acquires an exclusive source-root lease, atomically consumes the authorization in a package-owned global single-use ledger and a run-local evidence marker, measures before and after hashes, writes a separate diff artifact, runs selected authorization-sourced command IDs through the package-owned verifier with `shell: false`, and validates a change-record 3.0.0 payload. The record names the trusted runtime as producer and retains the declared operator, runtime and broker hashes, registered handoff hash, and execution times. Registration checks the portable and host-protected completion receipts; operator IDs and local receipts do not authenticate a person. The global ledger is outside the cloneable run artifact tree and is keyed by the authorization hash, run ID, and canonical source-root hash. Its location is derived from the operating-system account record rather than `HOME` or `USERPROFILE`; a host administrator must still protect that account-owned directory from deletion or replacement. The broker fixes an allowlisted executable and allowlisted arguments rather than evaluating target-derived commands. Verification failures remain nonzero command results and never become accessibility outcomes or conformance claims.

Before target mutation, the runtime captures every existing directory identity from the source root to the target parent and rechecks the chain around create, atomic replacement, or deletion. A parent replacement, junction, symlink, or identity change visible at a checkpoint fails closed. These checkpoints narrow accidental and cooperative path-substitution races but do not bind mutation to a kernel directory handle. Direct writes therefore require exclusive operator control of the source tree for the transaction duration; a concurrent process with unrestricted local filesystem access remains outside this runtime's security boundary.

A validated change record is first written under a non-registerable pending filename. The runtime publishes it at the requested artifact path only after lease release succeeds and the measured target state is rechecked. A lease-release failure leaves the authorization consumed, the completed artifact path absent, and pending evidence plus the lease or quarantine state available for manual reconciliation. Failures before lease release roll back an unchanged transaction-owned target when that rollback can be proven safe; ambiguous rollback retains the lease for manual reconciliation.

Lease recovery requires an expired lease, the exact predecessor run and authorization identity, and an unchanged allowed-path baseline. Recovery and release use verified tombstones and per-root guards. Ambiguous restoration or cleanup leaves a quarantine guard that blocks a new fixer until manual reconciliation.

After a registered authorized change or [externally declared change](declared-change-record.md), `retest --supersedes-run <old-run.json>` creates a fresh retest run from a valid run 5–17 predecessor in `retest_required`. An externally declared change binds the measured before and after target identities, saved change evidence, actor declaration and related remediation IDs without granting target write access. The new run must use a different run ID, target version, and empty non-overlapping artifact root while preserving the target, profile, references, scope and inspection request. For a declared change, its target version must equal the registered `after_version`. The fresh retest run starts at `initialized` with source writes denied and copies no prior artifacts, history, outcomes, evidence or measured inventory. Capture and bind the new target state before retest observations.

The current read-only boundary is a behavioral contract, not a complete tool sandbox. Agent instructions prohibit target writes, authentication, forms, and state-changing interaction. They do not by themselves provide an operating-system or browser enforcement boundary.

`audit-run` schema 17.0.0, orchestration registry 17.0.0 and artifact envelope 4.0.0 define the current run-backed flow. Older registry 16 runs and runs 1–16 remain bound to frozen resources and are read-only. New runs record the agreed inspection level, purpose, deliverables and completion criteria in `inspection_request`; see `inspection-levels.md`. Before observations, the orchestrator captures and binds a measured inventory as described in `measured-targets.md`. Each envelope names the exact inventory snapshot IDs, and registration rejects target drift. Completed authorized change records retain the prior IDs; external change declarations retain the old binding while verifying a measured after state. Both move the run to retesting. The reviewer dispatches applicable specialists, the orchestrator materializes and registers candidates, `merge-audit-artifacts.mjs` produces the assessment, and `render-audit-report.mjs` with `--run` `<run.json>`, `--assessment` `<merged.json>`, and `--output` `<new-report.md>` creates the public report through stable and safe runtime checks.

## Authoring without agent dispatch

Use `artifact init` with a completed payload JSON to create a valid candidate for any of the four standard review types: `screening-observations`, `human-review-queue`, `declared-human-review`, or `remediation-plan`. The CLI supplies the envelope version, artifact ID, run ID, registered producer role, UTC creation time, measured target IDs, omitted payload version, and exact hashes for each repeated `--input <registered-artifact-id>`. Its producer origin explicitly records caller-supplied content without agent dispatch.

```sh
accessibility-audit artifact init --run audit-run.json --type screening-observations --payload observations.json --output artifacts/screening.json
# Edit only payload fields in the unregistered candidate, then:
accessibility-audit artifact validate --run audit-run.json --artifact artifacts/screening.json
accessibility-audit register --run audit-run.json --artifact artifacts/screening.json --output audit-run.screened.json
```

`observations.json` contains the screening payload object, not an envelope. Supply actual observations and capture times; E1 requires saved evidence references described in [saved-evidence.md](saved-evidence.md). The command requires `--payload`: it does not fill invented observations, completed human tests, or remediation proposals into a blank template. An incompatible payload version or incomplete content is rejected before a candidate is written.

For guided authoring, use [`review-queue`](human-review-queue.md) after registering screening, then [`human-review export/import`](human-review-worksheet.md) for the person's answers. For a remediation payload, pass `--type remediation-plan --input <registered-screening-or-human-review-id>`; each item's `source_artifact_ids` must match its supporting inputs. Repeat `--input` for multiple sources. Unverified screening proposals remain unverified.

Declared human review 3 requires a stable `reviewer_id` and a unique `review_id` for each criterion review. Different reviewers may review the same criterion. Only unanimous active reviews determine its aggregate result; disagreements stay `cant_tell`. A same-reviewer correction names its predecessor in `supersedes_review_id` and preserves all source history. Do not rewrite past records or resolve disagreement by priority or registration order. IDs are self-declarations, not proof of authenticated identity or independence.

For `declared-human-review`, supply only the reviewer's actual completed declaration and observations. AI agents must not fill human outcomes or evidence on a person's behalf. The external-human producer role records the declared source of the payload, not the identity of the CLI caller. As with worksheet import and hand-written JSON registration, validation cannot prove who wrote the declaration or whether a test was performed; [reviewer assurance](reviewer-assurance.md) is a separate signature-verification workflow.

Candidates stay inside the private artifact root, use new filenames, and do not update the run. `artifact validate` checks current schemas, registration order, same-run inputs and hashes, target bindings, saved evidence and review/remediation relationships without writing files or contacting targets. Registration still rechecks the live target and creates a new run file. Registered artifacts are immutable. Optional `fix-authorization`, `fix-handoff` and `change-record` use the separate authorized-fix workflow above.

The repository's `examples/run-backed-web-audit` documents a synthetic workflow; its artifact-authoring integration test reuses the four payload fixtures through init → edit → validate → register → merge → report. No real human audit is implied.

## Public reporting boundary

Screening schema 3.0.0 requires `evidence_refs`, with saved run-bound captures for E1; see [saved-evidence.md](saved-evidence.md). It retains optional `signal_class`, `human_review_required`, and `evidence_provenance` fields. A signal-classified handoff must include the latter two fields; automated-tool provenance must identify the tool, version, and rule. `no_automated_signal` and `inconclusive` cannot produce a report-only pass or fail. Every signal-classified observation mapped to a profile requirement must reach an input-linked human-review queue before merge. Historical payloads remain read-only; none of these fields creates a formal profile outcome.

The public report must never expose internal agent identifiers, run IDs, orchestration history, transition history, state history, local paths, Git branches, or raw artifact envelopes. It may publish only target and scope context, results with their evidence level, limitations, human checks, remediation, and retest information accepted by the report validator.

## Residual enforcement boundary

The runtime uses canonical-path, file-identity, hard-link, symlink, junction, stable-read, exclusive-create, no-overwrite hard-link publication, and atomic-rename checks available through the host Node.js and operating-system APIs. These controls reduce path substitution, replay, and partial-write risk, but they are not a kernel sandbox and do not defend against an administrator or another process with unrestricted local filesystem control. A quarantine guard therefore requires manual reconciliation rather than automated deletion.

Public-report generation does not yet provide a complete privacy scan for private URLs, person names, or sensitive evidence. Distribution remains subject to the documented public-report review boundary and an explicit publication review.

Queue payload 3.0.0 binds each item to measured locations, registered screening observation references, review origins and priority reasons. Read [human-review-queue.md](human-review-queue.md). The current registry also permits initialized → human_queue_ready for an explicit manual or all-profile queue without screening. This transition records a review plan only. Frozen registries do not gain this transition.

## Findings and remedies

Human review 2 accepts either `finding` or a nonempty `findings` array for a failed criterion. Each finding contains `id`, `priority`, `location`, `affected_users`, and `observation`. Reuse an ID across criteria only when the reviewer declares the same finding with identical details. Different barriers on one criterion need different IDs. The worksheet keeps its single-finding entry; use an actual human-authored JSON payload with `artifact init` for plural findings. The CLI does not invent or authenticate these declarations.

Remediation plan 3 can separate barriers from remedies. This excerpt shows the complete payload shape; replace the example IDs with registered records from the same run and list both source artifacts in the envelope inputs:

```json
{
  "schema_version": "3.0.0",
  "findings": [{
    "finding_id": "FIND-IMAGE-ONE",
    "basis": "verified_failure",
    "requirement_ids": ["WCAG-2.2-SC-1.1.1", "WCAG-2.2-SC-4.1.2"],
    "observation_refs": [{"artifact_id": "ART-SCREEN-001", "requirement_id": "SCREEN-IMAGE-ONE"}],
    "human_review_refs": [
      {"artifact_id": "ART-HUMAN-001", "requirement_id": "WCAG-2.2-SC-1.1.1"},
      {"artifact_id": "ART-HUMAN-001", "requirement_id": "WCAG-2.2-SC-4.1.2"}
    ],
    "priority": "P1",
    "locations": ["Product image button"],
    "affected_users": ["Screen reader users"],
    "issue": "The reviewed image button lacks an accessible name."
  }],
  "items": [{
    "remediation_id": "REM-IMAGE001",
    "finding_id": "FIND-IMAGE-ONE",
    "proposed_change": "Provide the reviewed control with a name describing its action.",
    "verification": "Retest the image alternative and the control name with the registered procedures.",
    "residual_limitation": "The proposal has not been applied or retested."
  }]
}
```

Several observations and criteria can support one finding, and one criterion can have several findings. A remedy is stored once per finding, with further distinct remedies added as separate items. For explicit human findings, IDs, priority, affected users and issue must match the declaration; join multiple `locations` with a newline to match the human `location`. Source references, duplicate IDs, identical duplicate content and unused inputs are checked before registration. Shared evidence alone does not merge distinct barriers. `unverified_screening_candidate` findings refer only to observations and remain unverified, including when they have no criterion mapping. The compatibility item shape remains accepted, but plural human findings require explicit `finding_id` links.

Reports group related criteria and observations under each finding and distinguish human-declared finding counts from failed-criterion counts. `status --run <successor.json> --retest-of <predecessor.json>` reports criterion declarations and their aggregate for each predecessor finding. It requires the linked `retest_required` predecessor, the same target, profile, scope and inspection request, and a new target version. A pass declaration does not prove that every original location was repaired and does not close the finding. This comparison remains local; it does not rewrite either run.

For a saved before/after record, run `accessibility-audit compare-runs --before <old-run.json> --after <retest-run.json> --output <retest-artifacts/delta.json> --report <retest-artifacts/delta.md>`. Both outputs are private and must be new files inside the successor artifact root. The command validates both runs and registered evidence, checks `supersedes_run_id`, and compares old and new finding IDs, human profile outcomes, screening signals, saved evidence identities, remediation declarations, target versions, measured inventories when both exist, scope and environment. It never copies old evidence into the new run. A missing or inconclusive new review stays `not_retested`; an old finding is `resolved` only when every related requirement has a new human `pass` declaration, with the explicit limit that this does not prove every old location was repaired. Screening improvement is `improved_unverified` and never becomes a profile pass. When IDs change, provide a private JSON `--mapping` file such as `{"finding_ids":{"OLD-FINDING":"NEW-FINDING"},"screening_ids":{"SCREEN-OLD":"SCREEN-NEW"}}`; unmapped new IDs remain new. If target references, profile or scope differ, the delta marks outcomes non-comparable instead of inferring resolution. Neither run is modified.

For the operational lifecycle of a registered finding, read [finding-lifecycle.md](finding-lifecycle.md). The versioned private companion preserves assignee, owner, due date, external tracker IDs, decisions and hash-linked transition history. `status --lifecycle` and `report --lifecycle` show due-date and exception warnings without changing human outcomes or treating risk acceptance as remediation. A closure requires a registered change, measured retest, human pass declarations and saved verification evidence.
