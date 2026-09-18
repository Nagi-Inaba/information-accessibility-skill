# Measured target identities

Implementation status: target capture, comparison and in-process checks are available. Mandatory audit-run registration binding is still being integrated under Issue #54. Capturing this companion does **not** make the current registration command reject target drift. Do not describe #54 as complete or treat a companion as a registered artifact.

`capture-targets` measures the references declared in an existing valid run and writes a new private JSON companion inside its artifact root. It does not change the run, the target, evidence levels or accessibility judgements. Existing outputs are never overwritten.

```sh
accessibility-audit capture-targets --run run.json --specs target-specs.json --output artifacts/targets-01.json
```

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

For HTTP, pass an explicit origin allowlist in addition to the run's allowlisted network permission:

```sh
accessibility-audit capture-targets --run run.json --specs target-specs.json --allow-origin https://example.org --output artifacts/targets-02.json
```

Repeat `--allow-origin` for permitted redirect origins. Loopback fixtures additionally require `--allow-localhost true`. Credentials in URLs, private/reserved network destinations, unapproved redirects, oversized responses and timeouts fail closed. The HTTP observer sends a credential-free GET with identity encoding. It neither executes page scripts nor recreates authenticated browser sessions.

## Identity and limitations

| Type | Measured identity | Practical limit |
| --- | --- | --- |
| File | Canonical local path, byte length and SHA-256 | Proves the read bytes at observation time. Symbolic links, junctions, device paths and network shares are rejected. |
| Git | Worktree/common-directory identity, actual HEAD, selected paths, index/tree modes and object IDs, working byte hashes and dirty state | Only selected files are covered. Working executable mode is measured on POSIX and recorded as null on Windows. External filters, diff tools and fsmonitor are not run; transformed checkouts can differ from `git status`. Submodules and symbolic links need separate treatment. |
| HTTP | Requested/final URL, redirect chain, status, ETag, Last-Modified, content type/encoding, body hash and retrieval time | Dynamic responses can change on every GET. A response is not a rendered DOM and is not continuously monitored. |
| Saved web state | Bundle hash, DOM/AX hashes, final URL, viewport, locale, environment hash, authentication-state identifier and feature flags | Measures a saved capture. Authentication identifiers/flags are declarations, not credentials or authenticated producer identity. New live states require a new capture. |

The default byte bound is 10 MiB per target (hard maximum 50 MiB); Git applies it to the sum of selected working files. Git and HTTP observations have bounded elapsed time. Inventories contain at most 32 snapshots. URLs, local paths, state identifiers and all snapshot metadata remain `private_by_default`; the companion is not a public report attachment.

`run-targets.mjs` offers offline inventory validation and before/after comparison. It reports changed identity fields independently from an environment change; it does not infer accessibility improvement. These offline functions never reopen a target or access the network.

Its active check API remeasures targets, requires caller-supplied network permission again and creates an in-process, single-use check bound to the entire run and inventory. The check expires within 30 seconds from the start of verification. Consumption remeasures local state, including Git HEAD/index; serializing a check or replaying it on another run does not preserve it. This is a runtime guard, not a digital signature. Connecting this guard to the run schema, registration, evidence snapshot IDs and retest workflow remains the next implementation step.
