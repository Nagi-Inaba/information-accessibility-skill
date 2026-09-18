import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceReference, validateEvidenceReference, verifyEvidenceReference } from "../codex/skills/information-accessibility-practice/scripts/lib/evidence-reference.mjs";
import { createFileTargetSnapshot, createUrlTargetSnapshot, createGitTargetSnapshot, assertTargetSnapshot } from "../codex/skills/information-accessibility-practice/scripts/lib/target-snapshot.mjs";

const bytes = Buffer.from("captured content");
const common = { snapshotId: "snapshot-1", capturedAt: "2026-09-18T00:00:00.123Z" };
const evidence = { evidenceType: "dom_snapshot", relativePath: "evidence/page.html", bytes, capturedAt: common.capturedAt, environmentRef: "environment-1", targetSnapshotId: common.snapshotId };

test("evidence references survive JSON round trips and reject content or publication tampering", () => {
  const reference = createEvidenceReference(evidence);
  assert.ok(Object.isFrozen(reference));
  assert.deepEqual(validateEvidenceReference(reference), []);
  assert.equal(verifyEvidenceReference(JSON.parse(JSON.stringify(reference)), new Uint8Array(bytes)), true);
  assert.throws(() => verifyEvidenceReference(reference, Buffer.from("changed")), /hash mismatch/u);
  assert.throws(() => verifyEvidenceReference(reference, "captured content"), /bytes must/u);
  for (const publication of [undefined, "public"]) assert.throws(() => verifyEvidenceReference({ ...reference, publication }, bytes), /publication/u);
  assert.throws(() => createEvidenceReference({ ...evidence, environmentRef: " " }), /environment_ref/u);
  assert.throws(() => createEvidenceReference({ ...evidence, targetSnapshotId: " " }), /target_snapshot_id/u);
});

test("identity paths reject traversal, absolute and Windows alias paths on every platform", () => {
  for (const relativePath of [".", "..", "../page.html", "a/../page.html", "/page.html", "C:/page.html", "C:page.html", "a\\b", "a//b", "a/", "page.html:stream", "a\0b", "a\nb", "NUL", "con.txt", "a/LPT1.txt", "a./b", "a /b"]) {
    assert.throws(() => createEvidenceReference({ ...evidence, relativePath }), /path/u, relativePath);
    assert.throws(() => createFileTargetSnapshot({ ...common, relativePath, bytes }), /relativePath/u, relativePath);
    if (relativePath !== ".") assert.throws(() => createGitTargetSnapshot({ ...common, repository: "example/repo", commitSha: "a".repeat(40), subpath: relativePath }), /subpath/u, relativePath);
  }
  assert.equal(createEvidenceReference({ ...evidence, relativePath: "証拠/page.html" }).path, "証拠/page.html");
});

test("timestamps must be real UTC instants rather than normalized invalid dates", () => {
  for (const capturedAt of ["2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-09-18T24:00:00Z", "2026-09-18T00:00:00+00:00", "bad"]) {
    assert.throws(() => createEvidenceReference({ ...evidence, capturedAt }), /captured_at/u);
    assert.throws(() => createFileTargetSnapshot({ ...common, capturedAt, relativePath: "page.html", bytes }), /capturedAt/u);
  }
  assert.ok(createEvidenceReference({ ...evidence, capturedAt: "2024-02-29T00:00:00Z" }));
});

test("file snapshots retain path, version and content identity and cannot be mutated in memory", () => {
  const current = { ...common, kind: "file", relativePath: "page.html", bytes, version: "release-1" };
  const snapshot = createFileTargetSnapshot(current);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.identity));
  assert.throws(() => { snapshot.identity.version = "release-2"; }, TypeError);
  assert.equal(assertTargetSnapshot(JSON.parse(JSON.stringify(snapshot)), current), true);
  for (const change of [{ relativePath: "other.html" }, { version: "release-2" }, { bytes: Buffer.from("changed") }, { kind: "git" }]) assert.throws(() => assertTargetSnapshot(snapshot, { ...current, ...change }), /changed|drifted/u);
});

test("URL snapshots detect request, redirect, status and captured-body changes", () => {
  const current = { ...common, kind: "url", requestedUrl: "https://example.com/start#section", finalUrl: "https://example.com/page", bodyBytes: bytes, status: 200 };
  const snapshot = createUrlTargetSnapshot(current);
  assert.equal(snapshot.identity.requested_url, "https://example.com/start");
  assert.equal(assertTargetSnapshot(snapshot, current), true);
  for (const change of [{ requestedUrl: "https://example.com/other" }, { finalUrl: "https://example.com/other" }, { status: 201 }, { bodyBytes: Buffer.from("changed") }]) assert.throws(() => assertTargetSnapshot(snapshot, { ...current, ...change }), /drifted/u);
  for (const requestedUrl of ["file:///tmp/page", "https://user:secret@example.com/", "not-a-url"]) assert.throws(() => createUrlTargetSnapshot({ ...current, requestedUrl }), /URL/u);
  assert.throws(() => createUrlTargetSnapshot({ ...current, status: 0 }), /status/u);
});

test("Git snapshots compare full repository, object ID and subpath without asserting live repository state", () => {
  for (const length of [40, 64]) {
    const current = { ...common, kind: "git", repository: "example/repo", commitSha: "a".repeat(length), subpath: "src" };
    const snapshot = createGitTargetSnapshot(current);
    assert.equal(assertTargetSnapshot(snapshot, current), true);
    for (const change of [{ repository: "example/other" }, { commitSha: "b".repeat(length) }, { subpath: "test" }]) assert.throws(() => assertTargetSnapshot(snapshot, { ...current, ...change }), /drifted/u);
    assert.throws(() => assertTargetSnapshot({ ...snapshot, content_sha256: "a".repeat(64) }, current), /must be null/u);
  }
  assert.throws(() => createGitTargetSnapshot({ ...common, repository: "example/repo", commitSha: "abc" }), /full lowercase/u);
});

test("deserialized snapshots are validated before identity comparison", () => {
  const current = { ...common, kind: "file", relativePath: "page.html", bytes };
  const snapshot = createFileTargetSnapshot(current);
  for (const change of [{ schema_version: "9.0.0" }, { captured_at: "2026-02-30T00:00:00Z" }, { identity: null }, { identity: { relative_path: "../page.html", version: null } }]) assert.throws(() => assertTargetSnapshot({ ...snapshot, ...change }, current));
  assert.throws(() => assertTargetSnapshot(null, null), /must be objects/u);
});
