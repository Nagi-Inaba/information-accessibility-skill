# Measured target identities

Current run schema 10.0.0 fixes a measured target inventory before the first artifact is registered. Envelope 3.0.0 records the exact inventory snapshot IDs. Registration remeasures the targets and rejects drift before adding evidence. Run 9 and earlier retain their frozen read contracts; create a new run for current registration.

`capture-targets` measures the references declared in an existing valid run and writes a new private JSON companion inside its artifact root. It does not change the run, the target, evidence levels or accessibility judgements. Existing outputs are never overwritten.

```sh
accessibility-audit capture-targets --run run.json --specs target-specs.json --output artifacts/targets-01.json
accessibility-audit bind-targets --run run.json --targets artifacts/targets-01.json --output run.bound.json
```

Capture alone creates a companion. `bind-targets` validates and rechecks that companion, then writes a new run version with its inventory fixed. Binding is allowed once, only on an initialized run with no artifacts or history. All subsequent envelopes must carry `target_snapshot_ids` containing exactly those IDs. A run without measured targets supports E0 planning with empty evidence references, queues and candidate plans; it cannot register E1 observations, human findings or fix authorization. Start a fresh run if planning artifacts have already been registered.

The specifications file contains a JSON array. Every declared target reference must occur exactly once, and no additional reference is accepted. Different Git scopes or rendered states for the same reference require separate runs in this version. Choose a specification appropriate to the actual target:

```json
[
  { "kind": "file", "target_ref": "page.html" },
  { "kind": "git", "target_ref": "repository", "paths": ["src", "public"] },
  { "kind": "http", "target_ref": "https://example.org/page" },
  {
    "kind": "web_state",
    "target_ref": "https://example.org/app",
    "bundle_path": "artifacts/saved-web-bundle.json",
    "locale": "ja-JP",
    "authentication_state_id": "anonymous",
    "feature_flags": []
  }
]
```

The array above illustrates all four types; use only entries matching the actual run. Relative file, repository and bundle paths resolve from the run manifest directory. A Git specification may also provide `expected_commit` with a full object ID. A saved state must be an existing `web-evidence-bundle` with its original capture time, DOM, accessibility tree, matching hashes and viewport.

For HTTP, first initialize with a concrete policy as described in [network-policy.md](network-policy.md), then pass an explicit caller origin or exact-URL allowlist and a private request-log output:

```sh
accessibility-audit capture-targets --run run.json --specs target-specs.json --allow-origin https://example.org --network-log-output artifacts/capture-network.json --output artifacts/targets-02.json
```

Repeat `--allow-origin` for permitted redirect origins. Loopback fixtures additionally require `--allow-localhost true`. Credentials in URLs, private/reserved network destinations, unapproved redirects, oversized responses and timeouts fail closed. The HTTP observer sends a credential-free GET with identity encoding. It neither executes page scripts nor recreates authenticated browser sessions.

HTTP inventories require the same explicit caller policy on `bind-targets` and on every `register` invocation. Permissions stored in a run never authorize network access by themselves:

```sh
accessibility-audit bind-targets --run run.json --targets artifacts/targets-02.json --allow-origin https://example.org --network-log-output artifacts/bind-network.json --output run.bound.json
accessibility-audit register --run run.bound.json --artifact artifacts/screening.json --allow-origin https://example.org --network-log-output artifacts/register-network.json --output run.1.json
```

If a target changes, preserve the old run and capture the new state in a new run. Do not edit the old inventory or substitute a new ID in existing evidence. Registered `change-record` artifacts are the deliberate exception to live remeasurement: a completed authorized change has already modified its target. They retain the old inventory IDs and exact authorization/input bindings, and move the run to `retest_required`. The fresh retest starts without an inventory and must capture and bind its new state before observations.

## Identity and limitations

| Type | Measured identity | Practical limit |
| --- | --- | --- |
| File | Canonical local path, byte length and SHA-256 | Proves the read bytes at observation time. Symbolic links, junctions, device paths and network shares are rejected. |
| Git | Worktree/common-directory identity, actual HEAD, selected paths, index/tree modes and object IDs, working byte hashes and dirty state | Only selected files are covered. Working executable mode is measured on POSIX and recorded as null on Windows. External filters, diff tools and fsmonitor are not run; transformed checkouts can differ from `git status`. Submodules and symbolic links need separate treatment. |
| HTTP | Requested/final URL, redirect chain, status, ETag, Last-Modified, content type/encoding, body hash and retrieval time | Dynamic responses can change on every GET. A response is not a rendered DOM and is not continuously monitored. |
| Saved web state | Bundle hash, DOM/AX hashes, final URL, viewport, locale, environment hash, authentication-state identifier and feature flags | Measures a saved capture. Authentication identifiers/flags are declarations, not credentials or authenticated producer identity. New live states require a new capture. |

The default byte bound is 10 MiB per target (hard maximum 50 MiB); Git applies it to the sum of selected working files. Git and HTTP observations have bounded elapsed time. Inventories contain at most 32 snapshots. URLs, local paths, state identifiers and all snapshot metadata remain `private_by_default`; the companion is not a public report attachment.

`run-targets.mjs` offers offline inventory validation and before/after comparison. It reports changed identity fields independently from an environment change; it does not infer accessibility improvement. These offline functions never reopen a target or access the network.

```sh
accessibility-audit compare-targets --before before/run.json --after after/run.json --output after/artifacts/target-comparison.json
```

Both inventories must be bound and both runs must validate. Comparison output must be a new file inside the after-run private artifact root. Historical `validate-run`, `status`, `merge` and `report` check recorded inventory consistency and saved evidence without contacting current targets. Their success is not a fresh drift check.

The active check API used by binding and registration remeasures targets, requires caller-supplied network permission again and creates an in-process, single-use check bound to the entire run and inventory. The check expires within 30 seconds from the start of verification. Consumption remeasures local state, including Git HEAD/index; serializing a check or replaying it on another run does not preserve it. The synchronous registration API supports local inventories; HTTP requires `registerArtifactChecked` with explicit policy. This is a runtime guard, not a digital signature or continuous monitoring.

DOM and AX evidence references must use their measured snapshot ID and match that snapshot's saved DOM/AX byte hashes. File/Git source bytes can support static DOM inspection. A credential-free HTTP response alone cannot be labeled a rendered DOM. Other evidence still requires run, target, environment and raw-file bindings; matching hashes do not establish that an observation is correct. Public reports omit inventories and reject known inventory identifiers/digests inserted into public prose.
