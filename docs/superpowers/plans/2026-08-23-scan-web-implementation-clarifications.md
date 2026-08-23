# `scan-web` Implementation Clarifications

The second independent review returned `APPROVED FOR IMPLEMENTATION`. The following clarifications are binding during implementation:

- `scan_status: complete` means the pipeline completed and published requested outputs; it does not mean frame coverage was complete. `frame_coverage` counts appear in both full scan and compact context. Frame failures do not change the success exit code when the scan otherwise completes.
- Compact-context truncation never hides aggregate frame-coverage counts. Coverage-failure and reflow summary signals are represented outside the capped item list. The capped item list prioritizes machine violations, then frame-coverage review candidates, then reflow/other candidates; omitted counts are tracked by class.
- Missing Playwright or any version other than the supported exact `1.62.1` is an exit-code `4` runtime/dependency error in this initial slice. This strictness is deliberate for reproducible first-use behavior and may be relaxed by a later compatibility policy.
- DOM/AX characterization hashes are asserted only for the static repository fixture.
- Extra origins are normalized as URL origins (`scheme://ASCII-host:effective-port`), with default ports normalized by the URL parser, IDNs converted to ASCII by `URL`, trailing-dot hostnames rejected, and credentials/query/fragment rejected.
- Deduplication that removes numeric `nth-child`/`nth-of-type` indices records `occurrence_count` and preserves bounded original node selectors so repeated siblings are not silently lost.
- An explicit horizontal-scroll container means the candidate is contained by an element whose computed `overflow-x` is `auto` or `scroll` and whose `scrollWidth > clientWidth`; such content is recorded in reflow evidence but not promoted to a generic overflow review candidate solely for horizontal extent.
- The 512 KiB compact-context limit is measured as UTF-8 bytes of final serialized JSON. If it binds before item/node caps, items are removed from the end of the deterministic priority order until the serialized object fits; truncation counts are updated by class.
- Compact context includes `stability: "experimental"` in the emitted object and schema.
- The manual workflow SHA-pins checkout, setup-node, and upload-artifact actions and explicitly sets seven-day artifact retention.