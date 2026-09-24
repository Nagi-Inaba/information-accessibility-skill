import path from "node:path";
import fs from "node:fs";
import { validateJsonSchema } from "./json-schema.mjs";
import { canonicalAttestationJson, attestationDigest, parseAttestationJson } from "./attestation-canonical.mjs";
import { verifyDetachedAttestation, attestationVerificationResult } from "./attestation-verifier.mjs";
import { inspectRealComponents, readStableFile, assertStableFile, validateAuditRun } from "./audit-run.mjs";
import { validateRunBackedAssessment } from "../render-audit-report.mjs";

// Format limits are intentionally fixed for portable, bounded offline checks.
export const bundleLimits = Object.freeze({ files: 4096, reports: 16, chain: 32, fileBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });
export const bundleAssuranceOrder = Object.freeze(["unsigned", "self_signed", "signed", "organization_attested", "independent"]);
const coverage = "registered-artifacts-and-evidence-plus-explicit-attachments";
const hashPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const contextKeys = ["run_id", "run_schema_version", "target", "profile", "scope", "environment", "target_inventory", "resource_versions", "supersedes_run_id"];
const recordSchema = JSON.parse(fs.readFileSync(new URL("../../references/audit-bundle-record.schema.json", import.meta.url), "utf8"));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const same = (left, right) => canonicalAttestationJson(left) === canonicalAttestationJson(right);
function exact(value, keys, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"), `Invalid ${label} fields.`);
}
function sortedUnique(values, label) {
  requireValue(Array.isArray(values) && values.every((value, index) => typeof value === "string" && (!index || values[index - 1] < value)), `${label} must be unique and sorted in UTF-16 order.`);
}
export function validateBundlePath(value) {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= 1024
    && !/[\\\u0000-\u001f\u007f:<>"|?*]/u.test(value) && !value.startsWith("/")
    && value.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/u.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)), "Invalid portable bundle path.");
  return value;
}
function referencePaths(manifest) {
  return [manifest.run, manifest.assessment, ...manifest.reports, ...manifest.artifacts.map((entry) => entry.path), ...manifest.evidence, ...manifest.attachments];
}

export function validateAuditBundleRecord(record) {
  canonicalAttestationJson(record);
  const errors = validateJsonSchema(record, recordSchema);
  requireValue(errors.length === 0, `Invalid audit bundle record:\n- ${errors.join("\n- ")}`);
  exact(record, ["schema_version", "manifest", "attestation"], "audit bundle record");
  requireValue(record.schema_version === "1.0.0", "Unsupported audit bundle record version.");
  const m = record.manifest;
  exact(m, ["bundle_id", "coverage", "context", "run", "assessment", "reports", "artifacts", "evidence", "attachments", "files", "predecessor"], "bundle manifest");
  requireValue(idPattern.test(m.bundle_id) && m.coverage === coverage, "Invalid bundle identity or coverage.");
  exact(m.context, contextKeys, "bundle context");
  requireValue(idPattern.test(m.context.run_id) && /^\d+\.\d+\.\d+$/u.test(m.context.run_schema_version)
    && (m.context.supersedes_run_id === null || idPattern.test(m.context.supersedes_run_id)), "Invalid bundle run context.");
  for (const key of ["target", "profile", "scope", "environment", "resource_versions"]) {
    requireValue(m.context[key] && typeof m.context[key] === "object" && !Array.isArray(m.context[key]), `Invalid bundle context ${key}.`);
  }
  requireValue(m.context.target_inventory === null || typeof m.context.target_inventory === "object" && !Array.isArray(m.context.target_inventory), "Invalid target inventory.");
  for (const key of ["reports", "evidence", "attachments"]) sortedUnique(m[key], key);
  requireValue(m.reports.length > 0 && m.reports.length <= bundleLimits.reports, "A bundle requires 1–16 reports.");
  requireValue(Array.isArray(m.artifacts) && m.artifacts.length <= bundleLimits.files, "Invalid artifact set.");
  for (const entry of m.artifacts) {
    exact(entry, ["artifact_id", "path"], "bundle artifact");
    requireValue(idPattern.test(entry.artifact_id), "Invalid artifact ID.");
  }
  sortedUnique(m.artifacts.map((entry) => entry.artifact_id), "artifact IDs");
  const refs = referencePaths(m);
  refs.forEach(validateBundlePath);
  requireValue(m.run !== m.assessment && !m.reports.includes(m.run) && !m.reports.includes(m.assessment), "Reports, assessment and run must use distinct files.");
  requireValue(Array.isArray(m.files) && m.files.length > 0 && m.files.length <= bundleLimits.files, "Invalid bundle file count.");
  let total = 0;
  for (const file of m.files) {
    exact(file, ["path", "sha256", "size_bytes"], "bundle file"); validateBundlePath(file.path);
    requireValue(hashPattern.test(file.sha256) && Number.isSafeInteger(file.size_bytes) && file.size_bytes >= 0 && file.size_bytes <= bundleLimits.fileBytes, "Invalid file hash or byte size.");
    total += file.size_bytes;
  }
  requireValue(total <= bundleLimits.totalBytes, "Bundle exceeds the total byte limit.");
  const names = m.files.map((file) => file.path);
  sortedUnique(names, "file paths");
  requireValue(new Set(names.map((name) => name.toLowerCase())).size === names.length, "Case-insensitive bundle path collision.");
  requireValue(same(names, [...new Set(refs)].sort()), "Manifest files must exactly equal the referenced file set.");
  if (m.predecessor !== null) {
    exact(m.predecessor, ["bundle_id", "run_id", "run_sha256", "subject_sha256", "attestation_sha256"], "bundle predecessor");
    const p = m.predecessor;
    requireValue(idPattern.test(p.bundle_id) && idPattern.test(p.run_id) && [p.run_sha256, p.subject_sha256, p.attestation_sha256].every((hash) => hashPattern.test(hash)), "Invalid predecessor identity or hash.");
    requireValue(p.run_id === m.context.supersedes_run_id && p.run_id !== m.context.run_id && p.bundle_id !== m.bundle_id, "Predecessor must bind the distinct superseded run.");
  }
  return true;
}

export function auditBundleSigningSubject(record) {
  validateAuditBundleRecord(record);
  return { subject_type: "information-accessibility-audit-bundle", schema_version: record.schema_version, manifest: structuredClone(record.manifest) };
}
export function auditBundleTargetContextSha256(context) { return attestationDigest(context); }
export function auditBundlePredecessor(record) {
  validateAuditBundleRecord(record);
  requireValue(record.attestation !== null, "A predecessor must have an actual signature.");
  return { bundle_id: record.manifest.bundle_id, run_id: record.manifest.context.run_id,
    run_sha256: record.manifest.files.find((file) => file.path === record.manifest.run).sha256,
    subject_sha256: attestationDigest(auditBundleSigningSubject(record)), attestation_sha256: attestationDigest(record.attestation) };
}

// Only explicit predecessor records are examined. No record may instruct the
// verifier to fetch a URL or open another path. Old file bytes are not implied.
export function verifyAuditBundleChain(record, predecessors = [], { trust, minimumAssurance = "unsigned", requireCompleteChain = false, expectedSubjectSha256 } = {}) {
  requireValue(bundleAssuranceOrder.includes(minimumAssurance), "Invalid minimum bundle assurance.");
  requireValue(Array.isArray(predecessors) && predecessors.length < bundleLimits.chain, "At most 31 predecessor records are accepted.");
  const index = new Map();
  for (const previous of predecessors) {
    const ref = auditBundlePredecessor(previous);
    requireValue(!index.has(ref.attestation_sha256), "Duplicate predecessor attestation."); index.set(ref.attestation_sha256, previous);
  }
  const used = new Set(), runIds = new Set(), bundleIds = new Set(), verified = [];
  let current = record, complete = false;
  while (current) {
    validateAuditBundleRecord(current);
    const m = current.manifest;
    requireValue(!runIds.has(m.context.run_id) && !bundleIds.has(m.bundle_id), "Repeated run or bundle identity in predecessor chain.");
    runIds.add(m.context.run_id); bundleIds.add(m.bundle_id);
    const result = attestationVerificationResult(verifyDetachedAttestation({ attestation: current.attestation,
      subject: auditBundleSigningSubject(current), kind: "audit_bundle", targetContextSha256: auditBundleTargetContextSha256(m.context),
      expectedPredecessor: m.predecessor?.attestation_sha256 ?? null, trust }));
    requireValue(bundleAssuranceOrder.indexOf(result.assurance) >= bundleAssuranceOrder.indexOf(minimumAssurance), `Bundle assurance ${result.assurance} does not meet minimum ${minimumAssurance}.`);
    verified.push(result);
    if (!m.predecessor) { complete = m.context.supersedes_run_id === null; break; }
    const previous = index.get(m.predecessor.attestation_sha256);
    requireValue(previous && !used.has(m.predecessor.attestation_sha256), "Missing or cyclic predecessor record.");
    requireValue(same(m.predecessor, auditBundlePredecessor(previous)), "Predecessor metadata does not match the signed record.");
    used.add(m.predecessor.attestation_sha256); current = previous;
  }
  requireValue(used.size === predecessors.length, "Unrelated predecessor records are not accepted.");
  requireValue(!requireCompleteChain || complete, "The supersedes chain is incomplete; an earlier signature was not supplied or never existed.");
  const head = verified[0];
  if (expectedSubjectSha256 !== undefined) requireValue(hashPattern.test(expectedSubjectSha256) && expectedSubjectSha256 === head.subject_sha256, "Bundle does not match the independently expected subject SHA-256.");
  return { assurance: head.assurance, signature_valid: head.signature_valid, signer_policy_matched: head.signer?.trusted === true,
    subject_sha256: head.subject_sha256, target_context_sha256: auditBundleTargetContextSha256(record.manifest.context),
    chain_assurance: bundleAssuranceOrder[Math.min(...verified.map((value) => bundleAssuranceOrder.indexOf(value.assurance)))],
    chain_record_count: verified.length, chain_complete: complete,
    chain_signatures_valid: verified.every((value) => value.signature_valid), historical_file_bytes_verified: false,
    time_assurance: head.time_assurance, expected_subject_matched: expectedSubjectSha256 !== undefined, latest_version_verified: false,
    correctness_verified: false, conformance_elevated: false };
}

function createBundleReader(root) {
  const safeRoot = inspectRealComponents(root, { type: "directory", label: "bundle root" }).absolute;
  const snapshots = new Map(), folded = new Map();
  let total = 0;
  function relative(file) {
    const name = path.relative(safeRoot, path.resolve(file)).split(path.sep).join("/");
    validateBundlePath(name);
    return name;
  }
  function read(file, { json = false } = {}) {
    const name = relative(file), key = name.toLowerCase();
    requireValue(!folded.has(key) || folded.get(key) === name, "Case-insensitive bundle path collision.");
    if (snapshots.has(name)) {
      const cached = snapshots.get(name);
      if (json) parseAttestationJson(cached.bytes);
      return cached;
    }
    requireValue(snapshots.size < bundleLimits.files, "Bundle file count exceeds the format limit.");
    const snapshot = readStableFile(file, { label: "bundle file", maxBytes: Math.min(json ? 8 * 1024 * 1024 : bundleLimits.fileBytes, Math.max(1, bundleLimits.totalBytes - total)) });
    total += snapshot.bytes.length;
    requireValue(total <= bundleLimits.totalBytes, "Bundle exceeds the total byte limit.");
    if (json) parseAttestationJson(snapshot.bytes);
    folded.set(key, name); snapshots.set(name, snapshot); return snapshot;
  }
  function resolve(name) { validateBundlePath(name); return path.join(safeRoot, ...name.split("/")); }
  return { relative, read, resolve, snapshots, assertStable() { for (const snapshot of snapshots.values()) assertStableFile(snapshot, "audit bundle input"); } };
}
function runContext(run) {
  return { run_id: run.run_id, run_schema_version: run.schema_version,
    ...Object.fromEntries(["target", "profile", "scope", "environment", "target_inventory", "resource_versions", "supersedes_run_id"].map((key) => [key, structuredClone(run[key] ?? null)])) };
}

export function prepareAuditBundle({ root, runFile, assessmentFile, reports, attachments = [], bundleId, predecessor = null, reviewTrust }) {
  const reader = createBundleReader(root);
  requireValue(Array.isArray(reports) && reports.length > 0 && reports.length <= bundleLimits.reports, "A bundle requires 1–16 explicit reports.");
  requireValue(Array.isArray(attachments) && attachments.length <= bundleLimits.files, "Invalid explicit attachments.");
  const run = structuredClone(parseAttestationJson(reader.read(runFile, { json: true }).bytes));
  const validation = validateAuditRun(run, { runFile: path.resolve(runFile), readArtifactFile(file, options) {
    return reader.read(file, { json: options?.label?.startsWith("registered artifact") === true });
  } });
  requireValue(validation.valid, `Audit run validation failed:\n- ${validation.errors.join("\n- ")}`);
  requireValue(run.schema_version === validation.resources.auditRunSchema.properties.schema_version.const, "Bundle preparation requires the current run contract; legacy runs remain read-only.");
  const assessment = structuredClone(parseAttestationJson(reader.read(assessmentFile, { json: true }).bytes));
  requireValue(assessment.schema_version === "2.0.0" && assessment.assessment?.assessment_id === run.run_id, "Bundle assessment must use schema 2 and the exact run identity.");
  validateRunBackedAssessment({ run, assessment, envelopesById: validation.envelopesById, resources: validation.resources, trust: reviewTrust });
  for (const file of [...reports, ...attachments]) reader.read(file);
  const record = { schema_version: "1.0.0", manifest: { bundle_id: bundleId, coverage, context: runContext(run),
    run: reader.relative(runFile), assessment: reader.relative(assessmentFile), reports: reports.map(reader.relative).sort(),
    artifacts: [...validation.envelopesById].map(([artifact_id, { snapshot }]) => ({ artifact_id, path: reader.relative(snapshot.path) })).sort((a, b) => a.artifact_id < b.artifact_id ? -1 : 1),
    evidence: [...new Set([...validation.evidenceSnapshots.values()].map((snapshot) => reader.relative(snapshot.path)))].sort(),
    attachments: attachments.map(reader.relative).sort(),
    files: [...reader.snapshots].map(([name, snapshot]) => ({ path: name, sha256: snapshot.sha256, size_bytes: snapshot.bytes.length })).sort((a, b) => a.path < b.path ? -1 : 1),
    predecessor: predecessor === null ? null : auditBundlePredecessor(predecessor) }, attestation: null };
  validateAuditBundleRecord(record); reader.assertStable();
  return { record, assertStable: reader.assertStable };
}

export function verifyAuditBundle({ root, record, predecessors = [], trust, reviewTrust, ...options }) {
  // Authenticate manifest commitments before opening any path from the record.
  const verification = verifyAuditBundleChain(record, predecessors, { trust, ...options });
  const reader = createBundleReader(root);
  for (const file of record.manifest.files) {
    const snapshot = reader.read(reader.resolve(file.path));
    requireValue(snapshot.sha256 === file.sha256 && snapshot.bytes.length === file.size_bytes, "Bundle file bytes do not match the committed hash and size.");
  }
  const m = record.manifest;
  const reconstructed = prepareAuditBundle({ root, runFile: reader.resolve(m.run), assessmentFile: reader.resolve(m.assessment),
    reports: m.reports.map(reader.resolve), attachments: m.attachments.map(reader.resolve), bundleId: m.bundle_id, reviewTrust });
  reconstructed.record.manifest.predecessor = m.predecessor;
  requireValue(same(reconstructed.record.manifest, m), "Signed manifest does not exactly cover the actual run, assessment and registered evidence.");
  reader.assertStable(); reconstructed.assertStable();
  return { ...verification, current_file_bytes_verified: true, verified_file_count: m.files.length, coverage: m.coverage,
    entire_target_archive_verified: false, report_semantics_verified: false };
}
