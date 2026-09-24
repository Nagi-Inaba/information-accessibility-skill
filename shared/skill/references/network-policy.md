# Run-bound network access

Current run 9 records a concrete `permissions.network_policy` whenever `network` is `allowlisted`; `denied` records `null`. The `local_read_only` CLI alias also requires this policy. A saved declaration never grants permission to contact a service: every adapter invocation additionally needs explicit caller origins or exact URLs. Both scopes must permit each request. Historical runs 1–8 remain read-only; a legacy `allowlisted` enum without destinations is reported as unverified.

## Declare the scope before inspection

```sh
accessibility-audit network-policy --target https://example.org/page --include-official-sources true --profile web-modern --output network-policy.json
```

This command performs no network access. It prints a proposal and optionally saves a new file. `--target` proposes the target origin; use repeatable `--exact-target` for exact URLs, including their query strings. `--include-official-sources true` proposes the installed profile's primary-source URLs in a separate `standards_sources` scope. Review the concrete proposal within the requester's existing authorization, then pass `--network-policy network-policy.json` to `init --network allowlisted`. Do not infer permission from a link, a copied run, a tool's availability or the proposal itself.

The policy fixes GET and/or HEAD, redirect rules, iframe and subresource rules, private-address denial, pinned DNS resolution, per-response bytes and requests per adapter invocation. Origins cannot contain paths; exact URLs retain paths and queries. Credentials, wildcard hosts, fragments and ambiguous URL forms are rejected. Cross-origin redirects require `redirects: allowlisted` and both the saved and caller scopes must include every hop. Cross-origin subresources such as CDNs additionally require `subresources: declared`.

`targets` and `standards_sources` do not authorize each other. The Node transport's explicit `purpose: standards_source` uses only the latter scope and `source_document` requests. Other browser integrations, search tools or standards-source fetchers are unverified unless they implement the enforcing contract; never describe their traffic as enforced by this run.

## HTTP and browser captures

```sh
accessibility-audit capture-targets --run run.json --specs target-specs.json --allow-origin https://example.org --network-log-output artifacts/capture-network.json --output artifacts/targets.json
accessibility-audit bind-targets --run run.json --targets artifacts/targets.json --allow-origin https://example.org --network-log-output artifacts/bind-network.json --output run.bound.json
accessibility-audit register --run run.bound.json --artifact artifacts/screening.json --allow-origin https://example.org --network-log-output artifacts/register-network.json --output run.1.json
```

HTTP remeasurement requires a new private log path on each CLI invocation. `--allow-url` is an exact-URL alternative. Loopback fixtures require **both** the saved `allow_localhost_fixture: true` and caller `--allow-localhost true`. Other private, link-local and reserved destinations remain denied. Every DNS result is checked; the HTTP connection uses the validated address without another lookup. Each redirect is revalidated. No cookies, authorization headers or client certificates are forwarded; compressed responses are rejected instead of silently bypassing byte bounds.

```sh
accessibility-audit scan-web --run run.json --url https://example.org/page --profile web-modern --browser-channel chrome --allow-origin https://example.org --network-log-output artifacts/browser-network.json --output artifacts/scan.json --axe-output artifacts/axe.json --evidence-output artifacts/web.json
```

The standalone `capture-web-evidence.mjs` script accepts the same `--run`, `--network-log-output`, `--allow-origin` and `--allow-url` options; its localhost flag, like scan-web, takes no value. Run-backed browser capture uses CDP Fetch to pause every HTTP request and redirect hop, and the Node transport retrieves bounded bytes at pinned addresses. Browser DNS is disabled; an owned local refusing proxy blocks browser traffic that escapes that gateway. The isolated capability preflight runs before target access. Requests without matching browser metadata fail closed.

The browser adapter currently supports same-origin iframes. A cross-origin iframe remains blocked as `cross_origin_iframe_capture_unavailable` even when the generic policy permits it, because that browser target cannot be fully observed by this adapter. WebSockets, WebTransport, WebRTC, workers and service workers are blocked or unavailable. A blocked request/channel or transport failure stops capture; do not present the incomplete page as successfully inspected. Authentication-dependent or compressed-only pages can also require another explicitly authorized inspection method. Standalone captures without `--run` are marked `standalone_scope_not_run_verified` and do not prove enforcement of a run policy.

The transport caps each response at the declared limit (maximum 10 MiB), each session at 32 MiB of received body bytes and four concurrent requests. The browser gateway queues at most 64 requests. The declared request limit is at most 1,000 per adapter invocation (default 500). A Node HTTP redirect chain allows at most five hops; browser redirects also remain subject to Chromium's limit. Bounds apply to adapter invocations, not an aggregate budget across an entire multi-target audit.

A gateway failure aborts active transport requests and prevents queued requests from starting. The gateway uses a fixed credential-free HTTP request profile rather than forwarding browser headers, so content negotiation or Origin-dependent behavior may differ from a normal browser session. Preserve that limitation for affected checks.

## Save and bind the evidence

Logs record the run ID, policy digest, caller scope, adapter and purpose, URL including query, method, resource type, initiator, redirect origin, pinned IP, time, response status and received bytes. `decision` records authorization; `outcome` and `request_sent` distinguish pre-transmission blocking from a transmitted failure. Limits and dropped-entry counts are explicit. Logs remain `private_by_default`; they may contain sensitive paths and queries. Log creation does not register an accessibility observation, authenticate its producer or establish an outcome.

After binding measured targets, use `bind-evidence --type network_log` to attach a saved log to a draft screening observation, then register that artifact. The runtime checks the log's run, policy, target and bounded request contract, as well as the ordinary raw-file SHA-256/context binding. Registered bytes are revalidated during status, merge and report without network access. Library users of `checkRunTargets`/`registerArtifactChecked` must persist their `onNetworkEvidence` callback output; only CLI entry points enforce output-file creation automatically. A failed operation may leave a private log without an inventory or registered artifact; retain it as failure evidence rather than treating it as a completed capture.

`status` displays exact declared scope and says that adapter evidence is still required. Public reports display destination counts, methods and redirect/resource rules; they omit private destinations, log paths, pinned addresses and policy hashes. Neither declaration nor a saved log proves that an unrelated host tool enforced this policy.
