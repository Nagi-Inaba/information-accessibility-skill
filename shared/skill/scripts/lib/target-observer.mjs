import crypto from "node:crypto";
import { createNetworkSession } from "./network-transport.mjs";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertStableFile, inspectRealComponents, readStableFile, resolveInside } from "./audit-run.mjs";
import { canonicalJson } from "./canonical-json.mjs";
import { isRfc3339DateTime } from "./date-time.mjs";
import { isSafeRelativePath } from "./evidence-identity-validation.mjs";
import { createTargetIdentity, targetDigest, targetIdentityErrors, compareTargetIdentities } from "./target-identity.mjs";
import { parseTargetUrl, resolveInspectionEndpoint } from "../capture-web-evidence.mjs";

const MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_BYTES = 10 * 1024 * 1024;
const compare = (a, b) => a.localeCompare(b, "en");
const samePath = (a, b) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function limits(options) {
  const maxBytes = options.maxBytes ?? DEFAULT_BYTES;
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error(`maxBytes must be between 1 and ${MAX_BYTES}.`);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("timeoutMs must be between 1 and 60000.");
  return { maxBytes, timeoutMs };
}

function exactSpec(spec, keys) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("A typed target specification is required.");
  for (const key of Object.keys(spec)) if (!keys.includes(key)) throw new Error(`Unsupported target specification field: ${key}`);
  if (typeof spec.target_ref !== "string" || !spec.target_ref.trim()) throw new Error("target_ref is required.");
}

function localPath(value, baseDir) {
  if (typeof value !== "string" || !value.trim()) throw new Error("A local target path is required.");
  let candidate = value;
  if (/^file:/iu.test(value)) {
    const url = new URL(value);
    if (url.hostname || url.search || url.hash) throw new Error("File target URLs must be local and have no query or fragment.");
    candidate = fileURLToPath(url);
  } else if (/^[a-z][a-z0-9+.-]*:/iu.test(value) && !/^[a-z]:[\\/]/iu.test(value)) {
    throw new Error("The file target must be a filesystem path or local file URL.");
  }
  if (/^[\\/]{2}/u.test(candidate)) throw new Error("Network shares and device paths are not local audit targets.");
  return path.resolve(baseDir, candidate);
}

function fileObservation(spec, options) {
  exactSpec(spec, ["kind", "target_ref"]);
  const file = readStableFile(localPath(spec.target_ref, options.baseDir), { label: "target file", maxBytes: options.maxBytes });
  const snapshot = createTargetIdentity({ kind: "file", targetRef: spec.target_ref,
    identity: { canonical_path: file.path, size: file.bytes.length, sha256: file.sha256 },
    evidenceBindings: [{ evidence_type: "other", sha256: file.sha256 }] });
  return { snapshot, files: [file], bytes: file.bytes };
}

function permittedOrigins(policy) {
  if (policy?.network !== "allowlisted" || !Array.isArray(policy.allowedOrigins) || !policy.allowedOrigins.length) throw new Error("HTTP target observation requires an explicit network allowlist.");
  return new Set(policy.allowedOrigins.map((value) => {
    const url = parseTargetUrl(value, { allowLocalhost: policy.allowLocalhost === true });
    if (url.pathname !== "/" || url.search || url.hash) throw new Error("Allowed origins must not contain a path, query or fragment.");
    return url.origin;
  }));
}

function deadline(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function retrieve(url, endpoint, options, signal) {
  return await new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "GET", agent: false, autoSelectFamily: false, signal,
      lookup: (_hostname, lookupOptions, callback) => lookupOptions?.all
        ? callback(null, [{ address: endpoint.address, family: endpoint.family }])
        : callback(null, endpoint.address, endpoint.family),
      headers: { "accept-encoding": "identity", "user-agent": "information-accessibility-target-observer/1", "connection": "close" },
      maxHeaderSize: 16384
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          response.destroy(new Error(`HTTP response exceeds the ${options.maxBytes}-byte limit.`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks, size) }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function httpObservation(spec, options) {
  exactSpec(spec, ["kind", "target_ref"]);
  if (options.runNetworkPolicy || options.runId) {
    const session = createNetworkSession({ runId: options.runId, policy: options.runNetworkPolicy, caller: options.networkPolicy });
    const response = await session.fetch({ url: spec.target_ref, method: "GET", resource_type: "main_document" });
    const header = (name) => typeof response.headers[name] === "string" ? response.headers[name] : null;
    const sha256 = targetDigest(response.bytes);
    const snapshot = createTargetIdentity({ kind: "http", targetRef: spec.target_ref,
      identity: { requested_url: spec.target_ref, final_url: response.final_url, status: response.status,
        etag: header("etag"), last_modified: header("last-modified"), content_type: header("content-type"), content_encoding: header("content-encoding"),
        response_sha256: sha256, size: response.bytes.length, redirects: response.redirects, request_profile: "credential_free_get_identity_encoding_v1" },
      evidenceBindings: [{ evidence_type: "other", sha256 }],
      limitations: ["Captures one credential-free HTTP response under the saved run policy and explicit caller authorization.",
        "Dynamic responses can drift between requests; rendered or authenticated states require an explicitly captured web state."] });
    return { snapshot, files: [], bytes: response.bytes, network: session.log() };
  }
  const policy = options.networkPolicy;
  const origins = permittedOrigins(policy);
  const requested = parseTargetUrl(spec.target_ref, { allowLocalhost: policy.allowLocalhost === true });
  requested.hash = "";
  let current = requested;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("HTTP target observation timed out.")), options.timeoutMs);
  timer.unref();
  const redirects = [];
  const endpoints = [];
  const visited = new Set();
  try {
    while (true) {
      if (!origins.has(current.origin)) throw new Error("Target or redirect origin is outside the explicit network allowlist.");
      if (visited.has(current.href)) throw new Error("HTTP target redirect loop detected.");
      visited.add(current.href);
      const endpoint = await deadline(resolveInspectionEndpoint(current, { allowLocalhost: policy.allowLocalhost === true }), controller.signal);
      endpoints.push(endpoint);
      const response = await retrieve(current, endpoint, options, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects.length >= 5) throw new Error("HTTP target exceeded the redirect limit.");
        if (typeof response.headers.location !== "string") throw new Error("HTTP target redirect has no Location.");
        const next = parseTargetUrl(new URL(response.headers.location, current).href, { allowLocalhost: policy.allowLocalhost === true });
        next.hash = "";
        redirects.push({ from: current.href, to: next.href, status: response.status });
        current = next;
        continue;
      }
      const header = (name) => typeof response.headers[name] === "string" ? response.headers[name] : null;
      const sha256 = targetDigest(response.bytes);
      const snapshot = createTargetIdentity({ kind: "http", targetRef: spec.target_ref,
        identity: { requested_url: requested.href, final_url: current.href, status: response.status,
          etag: header("etag"), last_modified: header("last-modified"), content_type: header("content-type"), content_encoding: header("content-encoding"),
          response_sha256: sha256, size: response.bytes.length, redirects, request_profile: "credential_free_get_identity_encoding_v1" },
        evidenceBindings: [{ evidence_type: "other", sha256 }],
        limitations: ["Captures one credential-free HTTP response, without executing JavaScript or authenticating.", "Dynamic responses can drift between requests; rendered or authenticated states require an explicitly captured web state."] });
      return { snapshot, files: [], bytes: response.bytes, network: { dns_binding: "pinned_per_request", endpoints } };
    }
  } finally { clearTimeout(timer); }
}

function gitExecutable(root) {
  const name = process.platform === "win32" ? "git.exe" : "git";
  for (const directory of (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      const real = fs.realpathSync(candidate);
      const relative = path.relative(root, real);
      if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) continue;
      if (fs.statSync(real).isFile()) return real;
    } catch { /* Try the next host PATH entry. Never resolve an executable inside the audited repository. */ }
  }
  throw new Error("A host Git executable outside the audited repository is required.");
}

function gitReader(root, options) {
  const executable = gitExecutable(root);
  const deadlineAt = performance.now() + options.timeoutMs;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/iu.test(key)));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
  return (args) => {
    const remaining = Math.floor(deadlineAt - performance.now());
    if (remaining < 1) throw new Error("Git target observation timed out.");
    const result = spawnSync(executable, ["--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", root, ...args],
      { encoding: "utf8", shell: false, windowsHide: true, env, timeout: remaining, maxBuffer: options.maxBytes });
    if (result.error || result.status !== 0) throw new Error(`Read-only Git identity command failed: ${args[0]}.`);
    return result.stdout;
  };
}

function parseIndex(text) {
  return new Map(text.split("\0").filter(Boolean).map((line) => {
    const match = /^(\d{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t([\s\S]+)$/u.exec(line);
    if (!match || match[3] !== "0") throw new Error("Git identity requires an unconflicted index.");
    return [match[4], { mode: match[1], oid: match[2] }];
  }));
}

function parseTree(text) {
  return new Map(text.split("\0").filter(Boolean).map((line) => {
    const match = /^(\d{6}) (?:blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/u.exec(line);
    if (!match) throw new Error("Unsupported Git tree entry.");
    return [match[3], { mode: match[1], oid: match[2] }];
  }));
}

function gitObservation(spec, options) {
  const deadlineAt = performance.now() + options.timeoutMs;
  exactSpec(spec, ["kind", "target_ref", "paths", "expected_commit"]);
  if (!Array.isArray(spec.paths) || !spec.paths.length || spec.paths.some((value) => value !== "." && !isSafeRelativePath(value))) throw new Error("Git paths must explicitly select normalized relative paths.");
  if (spec.expected_commit !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(spec.expected_commit)) throw new Error("expected_commit must be a full Git object ID.");
  const root = inspectRealComponents(localPath(spec.target_ref, options.baseDir), { type: "directory", label: "Git target root" }).absolute;
  const read = gitReader(root, options);
  if (!samePath(read(["rev-parse", "--show-toplevel"]).trim(), root)) throw new Error("Git target_ref must identify the repository worktree root.");
  const commonDirectory = localPath(read(["rev-parse", "--git-common-dir"]).trim(), root);
  inspectRealComponents(commonDirectory, { type: "directory", label: "Git common directory" });
  const head = read(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (spec.expected_commit && spec.expected_commit !== head) throw new Error("Measured Git HEAD does not match expected_commit.");
  const objectFormat = read(["rev-parse", "--show-object-format"]).trim();
  if (!["sha1", "sha256"].includes(objectFormat)) throw new Error("Unsupported Git object format.");
  const selectedPaths = [...new Set(spec.paths)].sort(compare);
  const indexArgs = ["ls-files", "--stage", "-z", "--", ...selectedPaths];
  const otherArgs = ["ls-files", "--others", "-z", "--", ...selectedPaths];
  const indexText = read(indexArgs);
  const otherText = read(otherArgs);
  const index = parseIndex(indexText);
  const tree = parseTree(read(["ls-tree", "-r", "-z", "HEAD", "--", ...selectedPaths]));
  const names = [...new Set([...index.keys(), ...tree.keys(), ...otherText.split("\0").filter(Boolean)])].sort(compare);
  if (!names.length || names.length > 10000) throw new Error("Git target selection must contain between 1 and 10000 files.");
  const files = [];
  const records = [];
  let total = 0;
  for (const name of names) {
    if (!isSafeRelativePath(name)) throw new Error("Git target contains an unsupported file path.");
    const headEntry = tree.get(name);
    const indexEntry = index.get(name);
    for (const entry of [headEntry, indexEntry]) if (entry && !["100644", "100755"].includes(entry.mode)) throw new Error("Git symlinks and submodules require separate target snapshots.");
    const absolute = path.join(root, ...name.split("/"));
    let file = null;
    try {
      fs.lstatSync(absolute);
      file = readStableFile(resolveInside(root, absolute), { label: "Git target file", maxBytes: Math.max(1, options.maxBytes - total) });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    let blob = null;
    if (file) {
      total += file.bytes.length;
      if (total > options.maxBytes) throw new Error("Git target selection exceeds its byte limit.");
      files.push(file);
      blob = crypto.createHash(objectFormat).update(`blob ${file.bytes.length}\0`).update(file.bytes).digest("hex");
    }
    records.push({ path: name, head_mode: headEntry?.mode ?? null, head_oid: headEntry?.oid ?? null, index_mode: indexEntry?.mode ?? null, index_oid: indexEntry?.oid ?? null,
      working_mode: file && process.platform !== "win32" ? (fs.statSync(file.path).mode & 0o111 ? "100755" : "100644") : null,
      working_sha256: file?.sha256 ?? null, working_blob_oid: blob, size: file?.bytes.length ?? null });
  }
  if (read(["rev-parse", "--verify", "HEAD^{commit}"]).trim() !== head || read(indexArgs) !== indexText || read(otherArgs) !== otherText) throw new Error("Git target changed while its identity was captured.");
  for (const file of files) assertStableFile(file, "Git target file");
  if (performance.now() > deadlineAt) throw new Error("Git target observation timed out.");
  const dirty = records.some((record) => record.head_oid !== record.index_oid || record.head_mode !== record.index_mode || record.index_oid !== record.working_blob_oid
    || (record.working_mode !== null && record.working_mode !== record.index_mode));
  const snapshot = createTargetIdentity({ kind: "git", targetRef: spec.target_ref,
    identity: { repository_root: root, git_common_directory: commonDirectory, head_commit: head, object_format: objectFormat, selected_paths: selectedPaths,
      dirty, dirty_basis: "unfiltered_worktree_bytes_and_index", files: records },
    evidenceBindings: files.map((file) => ({ evidence_type: "other", sha256: file.sha256 })),
    limitations: ["Only the explicitly selected paths are measured; nested repositories, submodules and symbolic links require separate snapshots.",
      "Git clean/smudge filters and external diff tools are never executed. Byte-based dirty state can differ from git status for transformed checkouts.",
      "Working executable mode is recorded only on POSIX; Windows records null for that field."] });
  return { snapshot, files };
}

function webStateObservation(spec, options) {
  exactSpec(spec, ["kind", "target_ref", "bundle_path", "locale", "authentication_state_id", "feature_flags"]);
  if (typeof spec.locale !== "string" || !spec.locale.trim() || typeof spec.authentication_state_id !== "string" || !spec.authentication_state_id.trim()
      || !Array.isArray(spec.feature_flags) || spec.feature_flags.some((flag) => typeof flag !== "string" || !flag.trim())) throw new Error("Web state requires an explicit locale, authentication state identifier and feature flag list.");
  const file = readStableFile(localPath(spec.bundle_path, options.baseDir), { label: "web state bundle", maxBytes: options.maxBytes });
  const bundle = JSON.parse(file.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  if (bundle.schema_version !== "1.0.0" || bundle.kind !== "web-evidence-bundle" || !isRfc3339DateTime(bundle.captured_at)
      || typeof bundle.evidence?.dom !== "string" || !Array.isArray(bundle.evidence?.accessibility_tree)) throw new Error("A supported captured web-evidence-bundle with its original capture time is required.");
  const requested = parseTargetUrl(bundle.target?.requested_url, { allowLocalhost: true });
  const expected = parseTargetUrl(spec.target_ref, { allowLocalhost: true });
  if (requested.href !== expected.href) throw new Error("Web state requested URL does not match target_ref.");
  const final = parseTargetUrl(bundle.target?.final_url, { allowLocalhost: true });
  const domHash = targetDigest(Buffer.from(bundle.evidence.dom, "utf8"));
  const axHash = targetDigest(Buffer.from(JSON.stringify(bundle.evidence.accessibility_tree), "utf8"));
  if (bundle.target.dom_sha256 !== domHash || bundle.target.ax_tree_sha256 !== axHash) throw new Error("Web state DOM or accessibility-tree hash mismatch.");
  if (bundle.environment?.rendering?.locale && bundle.environment.rendering.locale !== spec.locale) throw new Error("Declared locale differs from the captured browser locale.");
  const snapshot = createTargetIdentity({ kind: "web_state", targetRef: spec.target_ref, capturedAt: bundle.captured_at,
    identity: { bundle_path: file.path, bundle_sha256: file.sha256, requested_url: requested.href, final_url: final.href, status: bundle.target.http_status,
      dom_sha256: domHash, ax_tree_sha256: axHash, environment_sha256: targetDigest(canonicalJson(bundle.environment)), viewport: bundle.environment?.viewport,
      locale: spec.locale, authentication_state_id: spec.authentication_state_id, feature_flags: [...new Set(spec.feature_flags)].sort(compare) },
    evidenceBindings: [{ evidence_type: "dom_snapshot", sha256: domHash }, { evidence_type: "accessibility_tree", sha256: axHash }, { evidence_type: "other", sha256: file.sha256 }],
    limitations: ["Measures the saved rendered state, not the current live page. New live states require a new explicit capture.",
      "Authentication state identifiers and feature flags are declared context; credentials are not stored and producer identity is not authenticated."] });
  return { snapshot, files: [file], bytes: file.bytes };
}

export function observeLocalTarget(spec, options = {}) {
  const bounded = { ...options, ...limits(options), baseDir: path.resolve(options.baseDir ?? process.cwd()) };
  let result;
  if (spec?.kind === "file") result = fileObservation(spec, bounded);
  else if (spec?.kind === "git") result = gitObservation(spec, bounded);
  else if (spec?.kind === "web_state") result = webStateObservation(spec, bounded);
  else throw new Error(`Unsupported local target kind: ${String(spec?.kind)}`);
  for (const file of result.files) assertStableFile(file, "observed target input");
  return result;
}

export async function observeTarget(spec, options = {}) {
  if (spec?.kind !== "http") return observeLocalTarget(spec, options);
  return httpObservation(spec, { ...options, ...limits(options) });
}

export async function assertTargetUnchanged(expected, spec, options = {}) {
  const errors = targetIdentityErrors(expected);
  if (errors.length) throw new Error(errors.join("\n"));
  if (expected.kind !== spec?.kind || expected.target_ref !== spec?.target_ref) throw new Error("Target specification does not match its saved identity.");
  const observed = await observeTarget(spec, options);
  const comparison = compareTargetIdentities(expected, observed.snapshot);
  if (comparison.changed) {
    const error = new Error(`Target drift detected; a new run or explicit state snapshot is required (${comparison.changed_identity_fields.join(", ")}).`);
    error.code = "TARGET_DRIFT";
    error.comparison = comparison;
    throw error;
  }
  return observed;
}
