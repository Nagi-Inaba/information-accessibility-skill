# Import scanner evidence

`accessibility-audit import axe` converts native axe-core results into a new, unregistered screening candidate. It preserves all four result categories, unknown rules and original private bytes. It never creates a profile pass/fail or authenticates a scanner operator. The importer is version 1.0.0 and accepts structurally complete stable axe-core 4.x results.

## Capture and import

Use an initialized run and its existing private artifact directory. For the package scanner, save the native frame results together with the browser evidence:

```sh
accessibility-audit scan-web --url https://example.org/page --profile web-modern --output artifacts/scan.json --axe-output artifacts/axe.json --evidence-output artifacts/web.json
```

`--axe-output` and `--evidence-output` are paired. All outputs must be distinct new paths. `--browser-channel chrome` selects installed system Chrome explicitly. The existing scanner network policy still applies; a run or a saved result does not grant network permission. Import itself reads local saved files and does not execute a browser, a scanner, page code, URLs, or supplied configuration.

Create target specifications referring to the saved bundle:

```json
[
  {
    "kind": "web_state",
    "target_ref": "https://example.org/page",
    "bundle_path": "artifacts/web.json",
    "locale": "ja-JP",
    "authentication_state_id": "anonymous",
    "feature_flags": []
  }
]
```

The URL must exactly match the run target. Use the actual locale and declared authentication/UI state of the capture; never insert credentials into state identifiers.

```sh
accessibility-audit capture-targets --run run.json --specs target-specs.json --output artifacts/targets.json
accessibility-audit bind-targets --run run.json --targets artifacts/targets.json --output run.bound.json
accessibility-audit import axe --run run.bound.json --input artifacts/axe.json --output artifacts/screening.json
accessibility-audit register --run run.bound.json --artifact artifacts/screening.json --output run.screened.json
```

Create and register an input-linked human-review queue for every mapped profile requirement before merge, using the normal [orchestration workflow](agent-orchestration.md). Machine passes also require that queue. Review source limitations and unknown rules before interpreting the candidate. A human review is required to record a profile outcome.

The input, optional configuration, candidate and import record must remain inside the private artifact root. The default normalized record path is `<output>.import.json`; `--record-output` can name a different new private path. `--artifact-id` is optional. A multi-target run requires `--target-ref`. The selected target must be a bound saved `web_state`; file/HTTP bytes alone are not a rendered browser state. Import rechecks that saved state, while registration performs the full run target check.

## Native JSON from another runner

The same command accepts the native JSON object returned by `axe.run`. Preserve its engine/version, timestamp, URL, environment and all `violations`, `incomplete`, `passes` and `inapplicable` arrays. Summary-only and omitted-category reporters are rejected. No missing category is silently treated as empty.

Optional `--configuration artifacts/config.json` preserves an explicit JSON object containing the external runner's `axe.configure` settings, run options and execution context. This is recorded as caller-declared configuration and is never executed. Without it, the importer preserves reported `toolOptions` and states that full configuration/context are unavailable. Configuration embedded in a package export cannot be replaced at import time.

Native axe JSON does not contain a DOM hash. The caller explicitly associates it with the saved target; the importer requires its final URL and both viewport dimensions to match. Missing dimensions or node check arrays (`any`, `all`, `none`) are rejected as incomplete input. The record therefore says `declared_saved_capture`, not that simultaneous capture or producer identity has been proved. Package exports additionally match the exact saved bundle, DOM and AX hashes and retain per-frame state measurements; this is `hash_linked_saved_capture`. A detected DOM/URL change or mismatch with the later main-frame capture becomes `state_changed_requires_review`, with inconclusive observations. Scans are not atomic, and hashes are not signatures.

## Preserved metadata and interpretation

The versioned [record schema](scanner-import-record.schema.json) stores:

- importer and mapping versions/hashes, original JSON path/hash, run/environment and target snapshot IDs;
- tool/version, timestamp, reported browser environment and configuration assurance;
- complete frame coverage, failed/skipped reasons and available before/after state hashes;
- source JSON pointer, exact nested frame/shadow selectors, HTML, check details and failure summary;
- rule/help URL, source-reported ACT IDs, impact and explicitly unestimated confidence;
- registered screening-check relation, unverified profile candidates, unknown-rule status and correlation keys.

The original JSON remains authoritative for source-specific fields that are not repeated in the normalized record. Both files are saved evidence with hashes checked during registration, validation, merge and reporting. Changing either invalidates the registered record. Existing evidence is never overwritten; a failed multi-file publication may leave a private, unregistered record for inspection.

[scanner-rule-mappings.json](scanner-rule-mappings.json) relates selected axe rules to existing registered screening checks. Other rules are retained as `unsupported_rule_retained`, including best-practice or custom rules. Profile candidates derived from source WCAG tags and ACT identifiers supplied by a tool remain unverified; neither establishes equivalence with a criterion procedure or an ACT implementation. The importer does not infer a numerical confidence score.

`dedup_key` is a correlation aid across runs and tools that use the same registered check. It includes the exact target reference, frame, nested selector chain and declared locale/viewport/authentication/feature state. It excludes tool/run/version/snapshot/impact, so those changes can be reviewed separately. Unknown rules stay in a tool-specific namespace. A separate `source_key` distinguishes individual raw occurrences. Keys do not prove that two findings are equivalent: no row, false-positive candidate, conflicting result or repeated occurrence is automatically removed or merged. False-positive decisions remain human review records.

Raw HTML, selectors, frame URLs, settings, hashes and arbitrary tool prose remain private. Public screening text uses fixed templates and recognized rule IDs. A report may describe unknown mappings and collection limits without copying the scanner's raw text. Review the final report before external distribution.

## Compatibility and verification

Importer 1.0.0 reads native stable 4.x result shapes and package `axe-scan-export` 1.0.0. Native 4.10.3 and 4.13.0 shapes have fixture coverage; the browser E2E pins axe-core 4.13.0 and Playwright 1.62.1. Other major versions and malformed/truncated results fail without an implicit downgrade. Store the original JSON when an input is unsupported.

An importer or mapping change must use a new version when its normalized meaning changes. Keep prior private records and candidate artifacts as captured; never rewrite their hashes or reimport over them. The current output uses existing run 8, envelope 3 and screening payload 3 contracts, so recorded imports remain ordinary immutable saved evidence even if a later importer changes. Additional scanner adapters must document their own shape/version support and map to the same registered-check vocabulary explicitly.

The Web evidence CI workflow runs real scanner → saved capture → import → registration → human queue → merge → report against a controlled local fixture. It checks that machine results do not become profile outcomes and raw secrets do not appear in the public report. Local deterministic tests also cover unknown rules, exact nested selectors, different states, partial frame coverage, mismatched capture hashes, original-file tampering, unsupported engine versions and private-output boundaries.

Source contract: [axe-core 4.13.0 API documentation](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/API.md). This is a package-maintained adapter, not a certification or endorsement by the source tool's authors.
