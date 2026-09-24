import crypto from "node:crypto";
import { digestBytes, isNonemptyText, isRealInstant, isSafeRelativePath } from "./evidence-identity-validation.mjs";
import { dateTimeExample } from "./date-time.mjs";

function digest(bytes) {
  return crypto.createHash("sha256").update(digestBytes(bytes)).digest("hex");
}

function common(snapshotId, capturedAt, kind) {
  if (!isNonemptyText(snapshotId)) throw new Error("snapshotId is required");
  if (!isRealInstant(capturedAt)) throw new Error(`capturedAt must be a real ${dateTimeExample}`);
  return { schema_version: "1.0.0", snapshot_id: snapshotId, kind, captured_at: capturedAt };
}

function freezeSnapshot(snapshot) {
  Object.freeze(snapshot.identity);
  return Object.freeze(snapshot);
}

function publicUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTP(S) URL`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`${label} must be a credential-free HTTP(S) URL`);
  parsed.hash = "";
  return parsed.href;
}

export function createFileTargetSnapshot({ snapshotId, relativePath, bytes, version = null, capturedAt }) {
  if (!isSafeRelativePath(relativePath)) throw new Error("relativePath must be a normalized relative path");
  if (version !== null && !isNonemptyText(version)) throw new Error("version must be null or nonempty text");
  return freezeSnapshot({ ...common(snapshotId, capturedAt, "file"), identity: { relative_path: relativePath, version }, content_sha256: digest(bytes) });
}

export function createUrlTargetSnapshot({ snapshotId, requestedUrl, finalUrl, bodyBytes, status, capturedAt }) {
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("status must be an HTTP status code");
  return freezeSnapshot({
    ...common(snapshotId, capturedAt, "url"),
    identity: { requested_url: publicUrl(requestedUrl, "requestedUrl"), final_url: publicUrl(finalUrl, "finalUrl"), status },
    content_sha256: digest(bodyBytes)
  });
}

export function createGitTargetSnapshot({ snapshotId, repository, commitSha, subpath = ".", capturedAt }) {
  if (!isNonemptyText(repository)) throw new Error("repository is required");
  if (typeof commitSha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commitSha)) throw new Error("commitSha must be a full lowercase Git object ID");
  if (subpath !== "." && !isSafeRelativePath(subpath)) throw new Error("subpath must be a normalized relative path");
  return freezeSnapshot({ ...common(snapshotId, capturedAt, "git"), identity: { repository, commit_sha: commitSha, subpath }, content_sha256: null });
}

export function assertTargetSnapshot(snapshot, current) {
  if (!snapshot || !current || typeof snapshot !== "object" || typeof current !== "object") throw new Error("snapshot and current target must be objects");
  if (snapshot.schema_version !== "1.0.0") throw new Error("Unsupported target snapshot schema_version");
  common(snapshot.snapshot_id, snapshot.captured_at, snapshot.kind);
  if (!snapshot.identity || typeof snapshot.identity !== "object") throw new Error("Target identity is required");
  if (snapshot?.kind !== current?.kind) throw new Error("Target kind changed");
  if (snapshot.kind === "file") {
    createFileTargetSnapshot({ snapshotId: snapshot.snapshot_id, capturedAt: snapshot.captured_at, relativePath: snapshot.identity.relative_path, version: snapshot.identity.version, bytes: current.bytes });
    if (snapshot.identity.relative_path !== current.relativePath) throw new Error("Target file path changed");
    if (snapshot.identity.version !== (current.version ?? null)) throw new Error("Target file version changed");
    if (snapshot.content_sha256 !== digest(current.bytes)) throw new Error("Target file content drifted");
  } else if (snapshot.kind === "url") {
    createUrlTargetSnapshot({ snapshotId: snapshot.snapshot_id, capturedAt: snapshot.captured_at, requestedUrl: snapshot.identity.requested_url, finalUrl: snapshot.identity.final_url, status: snapshot.identity.status, bodyBytes: current.bodyBytes });
    if (snapshot.identity.requested_url !== publicUrl(current.requestedUrl, "requestedUrl")) throw new Error("Target requested URL drifted");
    const finalUrl = publicUrl(current.finalUrl, "finalUrl");
    if (snapshot.identity.final_url !== finalUrl) throw new Error("Target final URL drifted");
    if (snapshot.identity.status !== current.status) throw new Error("Target HTTP status drifted");
    if (snapshot.content_sha256 !== digest(current.bodyBytes)) throw new Error("Target URL content drifted");
  } else if (snapshot.kind === "git") {
    createGitTargetSnapshot({ snapshotId: snapshot.snapshot_id, capturedAt: snapshot.captured_at, repository: snapshot.identity.repository, commitSha: snapshot.identity.commit_sha, subpath: snapshot.identity.subpath });
    if (snapshot.content_sha256 !== null) throw new Error("Git snapshot content_sha256 must be null");
    if (snapshot.identity.repository !== current.repository || snapshot.identity.commit_sha !== current.commitSha || snapshot.identity.subpath !== (current.subpath ?? ".")) throw new Error("Target Git identity drifted");
  } else {
    throw new Error(`Unsupported target snapshot kind: ${String(snapshot?.kind)}`);
  }
  return true;
}
