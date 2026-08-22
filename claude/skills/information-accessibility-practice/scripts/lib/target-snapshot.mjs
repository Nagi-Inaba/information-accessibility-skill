import crypto from "node:crypto";
import path from "node:path";

const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function realUtcInstant(value) {
  return typeof value === "string" && utcInstant.test(value) && !Number.isNaN(Date.parse(value));
}

function digest(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error("snapshot bytes must be Buffer or Uint8Array");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function common(snapshotId, capturedAt, kind) {
  if (typeof snapshotId !== "string" || !snapshotId) throw new Error("snapshotId is required");
  if (!realUtcInstant(capturedAt)) throw new Error("capturedAt must be a real UTC RFC 3339 instant");
  return { schema_version: "1.0.0", snapshot_id: snapshotId, kind, captured_at: capturedAt };
}

function safeRelativePath(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== ".." && !normalized.startsWith("../");
}

function publicUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`${label} must be a credential-free HTTP(S) URL`);
  parsed.hash = "";
  return parsed.href;
}

export function createFileTargetSnapshot({ snapshotId, relativePath, bytes, version = null, capturedAt }) {
  if (!safeRelativePath(relativePath)) throw new Error("relativePath must be a normalized relative path");
  return {
    ...common(snapshotId, capturedAt, "file"),
    identity: { relative_path: relativePath, version },
    content_sha256: digest(bytes)
  };
}

export function createUrlTargetSnapshot({ snapshotId, requestedUrl, finalUrl, bodyBytes, status, capturedAt }) {
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("status must be an HTTP status code");
  return {
    ...common(snapshotId, capturedAt, "url"),
    identity: {
      requested_url: publicUrl(requestedUrl, "requestedUrl"),
      final_url: publicUrl(finalUrl, "finalUrl"),
      status
    },
    content_sha256: digest(bodyBytes)
  };
}

export function createGitTargetSnapshot({ snapshotId, repository, commitSha, subpath = ".", capturedAt }) {
  if (typeof repository !== "string" || !repository) throw new Error("repository is required");
  if (typeof commitSha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commitSha)) throw new Error("commitSha must be a full lowercase Git object ID");
  if (subpath !== "." && !safeRelativePath(subpath)) throw new Error("subpath must be a normalized relative path");
  return {
    ...common(snapshotId, capturedAt, "git"),
    identity: { repository, commit_sha: commitSha, subpath },
    content_sha256: null
  };
}

export function assertTargetSnapshot(snapshot, current) {
  if (snapshot?.kind !== current?.kind) throw new Error("Target kind changed");
  if (snapshot.kind === "file") {
    if (snapshot.identity.relative_path !== current.relativePath) throw new Error("Target file path changed");
    if (snapshot.content_sha256 !== digest(current.bytes)) throw new Error("Target file content drifted");
  } else if (snapshot.kind === "url") {
    const finalUrl = publicUrl(current.finalUrl, "finalUrl");
    if (snapshot.identity.final_url !== finalUrl) throw new Error("Target final URL drifted");
    if (snapshot.identity.status !== current.status) throw new Error("Target HTTP status drifted");
    if (snapshot.content_sha256 !== digest(current.bodyBytes)) throw new Error("Target URL content drifted");
  } else if (snapshot.kind === "git") {
    if (snapshot.identity.repository !== current.repository || snapshot.identity.commit_sha !== current.commitSha || snapshot.identity.subpath !== (current.subpath ?? ".")) {
      throw new Error("Target Git identity drifted");
    }
  } else {
    throw new Error(`Unsupported target snapshot kind: ${String(snapshot?.kind)}`);
  }
  return true;
}
