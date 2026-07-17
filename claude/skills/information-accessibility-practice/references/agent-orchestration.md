# Audit orchestration boundary

## Internal contracts

`audit-run` and all role artifacts are internal traceability records. They preserve the declared producer, inputs, resource hashes, permissions, and state history needed to validate an audit workflow; they are not public findings and do not raise the evidence level of the assessment.

The orchestration registry is authoritative for role output types and allowed state transitions. A transition is accepted only when its required artifact type is present, the artifact envelope names the role registered to produce that type, and the payload passes that type's schema. No AI role can record a profile outcome or produce `fix-authorization`. Only the non-default `authorized_fixer` role can write an audited target, and only after a validated `fix-authorization` produced by the declared external requester.

The `input_types` array order is part of the canonical serialized role contract so registry artifacts remain deterministic. Task 5 must treat those values as an allowed-input set, not as semantic priority or execution order.

An initial run uses `supersedes_run_id: null`. A new run that follows an authorized source change names the predecessor whose terminal state was `retest_required`; that predecessor relationship requires orchestration-level validation against the stored run, not merely string-shape validation.

Before an input is registered, an orchestration validator must confirm that it belongs to the same run, that its exact SHA-256 matches, and that it names a registered artifact. JSON Schema fixes the required fields and their shapes but cannot compare values across stored records. Schema validation does not authenticate identity or grant authorization. `declared-human-review` and `fix-authorization` therefore record declarations and explicitly keep `identity_authenticated: false`.

Audit target and scope references may identify public Web URLs or files, matching the assessment record. Fix commands are data, not shell text. Each authorized command contains one `executable`, an `args` array, and a relative `cwd`; authorization, artifact, and change-record paths are relative, URL-free, and traversal-free. This contract layer does not execute commands or write the audited target.

## Public reporting boundary

`render-audit-report.mjs` consumes only the validated assessment. The current public report path does not read the orchestration registry, audit-run manifest, artifact envelopes, or role payloads.

The later `render-orchestrated-report.mjs` may consume validated run artifacts, but its public output never exposes agent identifiers, local paths, Git branches, run IDs, or transition history. It may publish only assessment and remediation content that has independently passed the relevant public-report validation and claim guards.
