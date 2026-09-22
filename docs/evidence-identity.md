# Evidence and target identity library

The Codex and Claude distributions provide matching `scripts/lib/evidence-reference.mjs`
and `scripts/lib/target-snapshot.mjs` modules. They create serializable, frozen
records and compare supplied bytes or identities without accessing a filesystem,
opening a browser, or executing Git.

```javascript
import {
  createFileTargetSnapshot,
  assertTargetSnapshot
} from "../codex/skills/information-accessibility-practice/scripts/lib/target-snapshot.mjs";
import {
  createEvidenceReference,
  verifyEvidenceReference
} from "../codex/skills/information-accessibility-practice/scripts/lib/evidence-reference.mjs";

const capturedAt = "2026-09-18T00:00:00Z";
const targetBytes = Buffer.from("<main>Example</main>");
const target = {
  kind: "file", snapshotId: "snapshot-1", capturedAt,
  relativePath: "target/page.html", bytes: targetBytes, version: "release-1"
};
const snapshot = createFileTargetSnapshot(target);
const reference = createEvidenceReference({
  evidenceType: "dom_snapshot", relativePath: "evidence/page.html",
  bytes: targetBytes, capturedAt, environmentRef: "environment-1",
  targetSnapshotId: snapshot.snapshot_id
});
assertTargetSnapshot(snapshot, target);
verifyEvidenceReference(reference, targetBytes);
```

File snapshots compare the relative path, declared version and SHA-256. URL
snapshots compare the requested URL, final URL, HTTP status and supplied body
bytes; fragments are excluded and embedded credentials are rejected. Git
snapshots compare repository identity, full SHA-1 or SHA-256 object ID and
subpath. The caller must obtain these values from the actual target. Git dirty
state, dynamic browser state and the meaning of a URL response are not inferred.

Evidence references retain a relative file path, SHA-256, real RFC 3339 capture time (preserving an explicit offset or `Z`),
environment reference and target snapshot ID. Validation requires
`publication: "private_by_default"`. A hash comparison detects changed bytes;
it does not authenticate the person who produced them or establish that the
environment or snapshot ID was truthfully declared.

Paths use normalized forward slashes and reject traversal, absolute paths,
Windows device names and alternate data stream syntax on all platforms.
Consumers must still enforce a trusted evidence root, reject symlinks and
verify the file bytes before use. These modules do not open the referenced path.

`run-evidence.mjs` integrates saved evidence with screening payloads 3.0.0 and 4.0.0.
`bind-evidence` creates references tied to the exact run, declared target version,
target context and environment. Registration, validation, status, merge and
run-backed reports verify the saved bytes. `compare-evidence` provides a private
before/after comparison with byte and context changes reported separately. E1
requires saved evidence; E0 may document unavailable capture. See the installed
[saved-evidence contract](../codex/skills/information-accessibility-practice/references/saved-evidence.md)
for examples, minimum evidence, privacy and historical read-only behavior.

Live target drift checks remain tracked by #54, and tool scan import by #65.
`capture-web` does not automatically register its output. These references bind
to declared context; they do not authenticate a producer or establish formal
conformance. URL queries, repository identifiers and evidence paths can be
private. Public reports omit raw references and do not embed the raw files.
