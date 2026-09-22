# Inspection levels

Choose the depth and intended report use before inspecting. Use explicit session choices first; ask one short question when the choice is unclear. The level controls the work and deliverables, while the standards profile controls the requirement catalog. `--detail summary|full` controls only rendering: a full rendering does not turn a quick inspection into a detailed one.

| Contract | `quick` — 簡易チェック | `detailed` — 詳細検査・改善用 |
| --- | --- | --- |
| Intended decision | Understand major barriers and decide the next investigation | Hand findings to someone who will plan and implement improvements |
| Agreed coverage | Named page/screen and basic rendered DOM, accessibility-tree, keyboard and reflow checks that apply | Named pages, states, processes and environments; all applicable supported checks within that agreement |
| Deliverables | Decision summary; remaining checks and next steps | Decision summary; per-finding remediation details; complete results and evidence; remaining checks |
| Common completion criteria | Agreed scope checked, target-specific evidence recorded, priorities reported, unresolved checks explained | Same common criteria |
| Additional completion criteria | None | Checks recorded for agreed states/environments; each finding has location, reproduction steps, evidence and impact; concrete change and retest procedure |

Record the requester’s intended use as `inspection_request.purpose`. Record scope and exclusions in `scope`, and declared test conditions in `environment`. These fields describe the agreement, not evidence that a check was performed. Do not invent browser versions, assistive-technology coverage, human reviews or permissions.

For each completion criterion, compare the agreed requirement with the actual registered observations/evidence and delivered report sections. Cite where it is satisfied; otherwise report the unmet condition and the next check. If a planned environment is unavailable, a finding lacks reproducible evidence or an implementation detail is unknown, deliver the supported results as partial work. Request clarification only for the consequential missing choice; do not silently weaken the agreement or present a rendered report as proof of completion.

In both modes, preserve all profile requirements in the assessment and explain unchecked requirements. A short report must retain the important unknowns. Detailed AI work remains E0/E1 unless separate external human evidence supports a higher level. Neither mode grants editing, sign-in, submission or publication authority.

## Runtime and compatibility

New audit-run 12.0.0 records require `inspection_request` with `mode`, nonblank `purpose`, canonical `deliverables` and `completion_criteria`. Initialize with `--inspection-mode quick|detailed --inspection-purpose <purpose>`. The runtime rejects missing choices and altered mode contracts. Historical audit-run 1.0.0–11.0.0 schemas are frozen for reading; historical records without an inspection request do not receive an inferred level. Current operations use a new run and bind measured targets before observations.

A retest inherits the predecessor's inspection request when present and may not change it. Retesting a supported older run without a request requires an explicit mode and purpose. A different depth or purpose starts a separate inspection; do not rewrite the predecessor. The contract displayed in a report is an agreed checklist, never an automatic completion verdict.
