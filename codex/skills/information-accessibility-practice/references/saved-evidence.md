# Saved screening evidence

Current `screening-observations` payloads use schema **3.0.0**. Every observation
has an `evidence_refs` array. E1 requires at least one saved DOM snapshot,
accessibility tree, screenshot, interaction log, network log, or other relevant
file. A description of a check alone is insufficient for E1.

## Minimum record

- E0 may use `evidence_refs: []`. Record the available source, location, method,
  observation time, capture limitation and next check. When the actual target
  cannot be observed, use `cant_tell` or `not_tested` for a mapped report outcome.
- E1 includes saved bytes relevant to the claimed observation, the method and
  exact location, and a capture time no later than the observation or artifact
  creation. Hash validation proves byte consistency, not that an arbitrary file
  supports a conclusion. The reviewer must inspect that relationship.
- A screenshot supports what is visible; it does not prove accessible names,
  focus order or screen-reader speech. Save the corresponding tree or interaction
  record when the observation depends on it. Preserve tool versions and settings
  in `evidence_provenance` where applicable.

The orchestrator saves actual capture output under the run's private
`artifact_root`. Specialist agents return candidates without writing artifact
files. Do not create a replacement capture from a prose summary, invent capture
times, or raise evidence levels merely because a reference can be serialized.

## Bind and register

First capture and bind the run's measured targets using [measured-targets.md](measured-targets.md). Prepare a new envelope version `3.0.0` with the bound inventory's exact `target_snapshot_ids`, payload version `3.0.0` and an
`evidence_refs` array in each observation. To bind an existing capture:

```text
node <skill_root>/scripts/accessibility-audit.mjs bind-evidence --run run.json --artifact artifacts/draft.json --observation SCREEN-DOM --file artifacts/capture.html --type dom_snapshot --target-ref https://example.invalid/ --captured-at 2026-09-18T09:00:00+09:00 --output artifacts/bound.json
node <skill_root>/scripts/accessibility-audit.mjs register --run run.json --artifact artifacts/bound.json --output run.1.json
```

`--target-ref` must exactly match a declared run target. The binder records the
run ID, declared target version, SHA-256 of the complete target context, SHA-256
of the environment, raw-file SHA-256, capture time and normalized relative path.
For current runs, `target_snapshot_id` is the matching bound `TARGET-…` ID;
an optional `--snapshot-id` must agree with it. DOM/AX bytes must match the
measured target's evidence hashes. Historical references may retain their
`RAW-…` IDs. Neither identifier authenticates the producer.

For multiple captures, bind each one into a new draft path. The binder validates
the selected observation; registration validates all observations together. It
does not change evidence levels, conclusions, or registered artifacts. Existing
outputs are never overwritten. Paths must stay inside the artifact root;
absolute stored paths, traversal, device names, streams, symbolic links and
junction traversal are rejected.

Registration, validation, status, merge and run-backed reports re-read the raw
files and compare their hashes and run bindings. Missing or changed bytes fail
closed. Restore only the original capture if it is available; otherwise create
a new observation/run rather than editing the original hash. The pure merge API
requires `evidence_snapshots_by_path`, a Map of reference paths to byte snapshots,
in addition to registered artifact snapshots.

## Private before/after comparison

```text
node <skill_root>/scripts/accessibility-audit.mjs compare-evidence --before before/run.json --after after/run.json --output comparison.private.json
```

Both runs and their referenced files must validate. Results group captures by
screening requirement, exact target reference and evidence type. Status is
`added`, `removed`, `bytes_changed` or `bytes_unchanged`. `context_changed` separately
identifies changes to the declared version, target context or environment, even
when the bytes match. The output retains hashes, capture dates and context
identifiers for private review. These are not accessibility judgements and do
not imply that two captures used equivalent methods or browser states.

## Privacy and compatibility

References and comparisons are `private_by_default`. Public report models omit
raw references; report generation does not embed raw files. Do not paste their
contents, paths, hashes or internal capture identifiers into public prose. A
public model containing known raw-reference metadata is rejected. The existing
publication review and redaction rules still apply to names and other sensitive
text that cannot be recognized automatically.

Payloads 1.0.0 and 2.0.0 remain available for read-only historical validation.
Current registration and merge require 3.0.0; missing historical captures are not
fabricated or silently upgraded. A run's resource hashes must match its installed
package, so older runs may require their original package version. No migration
or resource-hash rewrite is performed by these commands.

Current registration also checks the measured file/Git/HTTP or saved browser
state for drift. Historical validation and report generation remain offline.
A saved browser bundle proves its captured state, not the current live page;
capture a new state for retesting. For native axe results and package scanner
exports, follow [scanner-import.md](scanner-import.md); imported records preserve
tool configuration and raw hashes without promoting machine results.
