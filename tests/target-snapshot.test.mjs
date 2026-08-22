import assert from "node:assert/strict";
import test from "node:test";
import { assertTargetSnapshot, createFileTargetSnapshot, createGitTargetSnapshot, createUrlTargetSnapshot } from "../codex/skills/information-accessibility-practice/scripts/lib/target-snapshot.mjs";

const capturedAt = "2026-08-22T04:05:06Z";

test("file snapshots detect content drift without relying on the path alone", () => {
  const bytes = Buffer.from("<button>Continue</button>");
  const snapshot = createFileTargetSnapshot({ snapshotId: "TARGET-FILE-1", relativePath: "fixtures/page.html", bytes, version: "v1", capturedAt });
  assert.equal(assertTargetSnapshot(snapshot, { kind: "file", relativePath: "fixtures/page.html", bytes }), true);
  assert.throws(() => assertTargetSnapshot(snapshot, { kind: "file", relativePath: "fixtures/page.html", bytes: Buffer.from("changed") }), /content drifted/u);
});

test("URL snapshots bind the final URL, status, and body hash", () => {
  const bodyBytes = Buffer.from("<main>Checkout</main>");
  const snapshot = createUrlTargetSnapshot({
    snapshotId: "TARGET-URL-1",
    requestedUrl: "https://example.invalid/start#fragment",
    finalUrl: "https://example.invalid/checkout",
    bodyBytes,
    status: 200,
    capturedAt
  });
  assert.equal(snapshot.identity.requested_url, "https://example.invalid/start");
  assert.equal(assertTargetSnapshot(snapshot, { kind: "url", finalUrl: "https://example.invalid/checkout", bodyBytes, status: 200 }), true);
  assert.throws(() => assertTargetSnapshot(snapshot, { kind: "url", finalUrl: "https://example.invalid/login", bodyBytes, status: 200 }), /final URL drifted/u);
});

test("Git snapshots require a full commit object ID and exact subpath", () => {
  const commitSha = "a".repeat(40);
  const snapshot = createGitTargetSnapshot({ snapshotId: "TARGET-GIT-1", repository: "Nagi-Inaba/example", commitSha, subpath: "src", capturedAt });
  assert.equal(assertTargetSnapshot(snapshot, { kind: "git", repository: "Nagi-Inaba/example", commitSha, subpath: "src" }), true);
  assert.throws(() => assertTargetSnapshot(snapshot, { kind: "git", repository: "Nagi-Inaba/example", commitSha: "b".repeat(40), subpath: "src" }), /Git identity drifted/u);
  assert.throws(() => createGitTargetSnapshot({ snapshotId: "X", repository: "repo", commitSha: "abc", capturedAt }), /full lowercase Git object ID/u);
});

test("target paths and URLs reject traversal and embedded credentials", () => {
  assert.throws(() => createFileTargetSnapshot({ snapshotId: "X", relativePath: "../secret", bytes: Buffer.from("x"), capturedAt }), /normalized relative path/u);
  assert.throws(() => createUrlTargetSnapshot({ snapshotId: "X", requestedUrl: "https://user:pass@example.invalid/", finalUrl: "https://example.invalid/", bodyBytes: Buffer.from("x"), status: 200, capturedAt }), /credential-free/u);
});
