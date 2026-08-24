import { isIP } from "node:net";

const redacted = "[redacted]";
const machineFields = new Set([
  "requirement_id", "profile_requirement_id", "source_kind", "evidence_level", "outcome",
  "applicability", "report_outcome", "priority", "evidence_status", "id", "level", "group_id"
]);

export function normalizeReportVisibility(value = "internal") {
  if (!["internal", "public"].includes(value)) throw new Error("--visibility must be internal or public");
  return value;
}

export function normalizeReviewerDisclosure(value) {
  if (!["include", "redact"].includes(value)) throw new Error("--reviewer-disclosure must be include or redact");
  return value;
}

function ipv4Private(value) {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6Private(value) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/gu, "").split("%", 1)[0];
  return normalized === "::" || normalized === "::1"
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/u.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:169.254.")
    || normalized.startsWith("::ffff:172.16.")
    || normalized.startsWith("::ffff:192.168.");
}

function privateHostname(hostname) {
  const normalized = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  const version = isIP(normalized);
  if (version === 4) return ipv4Private(normalized);
  if (version === 6) return ipv6Private(normalized);
  return normalized === "localhost"
    || !normalized.includes(".")
    || [".local", ".lan", ".internal", ".corp", ".home.arpa", ".test", ".invalid", ".example"]
      .some((suffix) => normalized.endsWith(suffix));
}

function addRedaction(entries, path, reason, action) {
  const key = `${path}\u0000${reason}\u0000${action}`;
  if (!entries.keys.has(key)) {
    entries.keys.add(key);
    entries.values.push({ path, reason, action });
  }
}

function pathLike(value) {
  return /\bfile:(?:\/{0,2})/iu.test(value)
    || /\b[A-Za-z]:[\\/](?![\\/])/u.test(value)
    || /\\\\[^\s\\]/u.test(value)
    || /(?:^|[\s(])~[\\/]/u.test(value)
    || /(?:^|[\s(])\.{1,2}[\\/]/u.test(value)
    || /\/(?:Users|home|private|var\/folders|tmp)\/[\w.~-]+/u.test(value);
}

function sanitizeUrl(value, location, entries) {
  const original = String(value ?? "");
  if (/^file:/iu.test(original) || pathLike(original)) {
    addRedaction(entries, location, "local_or_file_reference", "redacted");
    return redacted;
  }
  let parsed;
  try {
    parsed = new URL(original);
  } catch {
    return sanitizeText(original, location, entries);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    addRedaction(entries, location, "non_http_reference", "redacted");
    return redacted;
  }
  if (privateHostname(parsed.hostname)) {
    addRedaction(entries, location, "private_or_reserved_host", "redacted");
    return redacted;
  }
  if (parsed.username || parsed.password) {
    parsed.username = "";
    parsed.password = "";
    addRedaction(entries, location, "url_userinfo_removed", "canonicalized");
  }
  if (parsed.search) {
    parsed.search = "";
    addRedaction(entries, location, "url_query_removed", "canonicalized");
  }
  if (parsed.hash) {
    parsed.hash = "";
    addRedaction(entries, location, "url_fragment_removed", "canonicalized");
  }
  return parsed.toString();
}

function replacePattern(value, pattern, replacement, location, reason, entries) {
  let changed = false;
  const result = value.replace(pattern, () => {
    changed = true;
    return replacement;
  });
  if (changed) addRedaction(entries, location, reason, "redacted");
  return result;
}

function sanitizeText(value, location, entries) {
  let result = String(value ?? "");
  result = result.replace(/https?:\/\/[^\s<>()\[\]]+/giu, (url) => sanitizeUrl(url, location, entries));
  result = replacePattern(result, /\bfile:(?:\/{0,2})[^\s,;]+|\b[A-Za-z]:[\\/](?![\\/])[^\s,;]+|\\\\[^\s,;]+|\/(?:Users|home|private|var\/folders|tmp)\/[^\s,;]+/giu, redacted, location, "local_path_removed", entries);
  result = replacePattern(result, /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/giu, "Bearer [redacted]", location, "authorization_token_removed", entries);
  result = replacePattern(result, /\b(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|session)\s*[:=]\s*[^\s,;]+/giu, "[redacted credential]", location, "credential_removed", entries);
  result = replacePattern(result, /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,})\b/gu, redacted, location, "token_removed", entries);
  result = replacePattern(result, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, redacted, location, "email_removed", entries);
  result = replacePattern(result, /(?<![\w.])(?:\+\d{1,3}[ -]?)?(?:\d[ -]?){8,14}\d(?!\w)/gu, redacted, location, "phone_removed", entries);
  result = replacePattern(result, /\b(?:DESKTOP|LAPTOP|WIN|MAC|HOST)-[A-Z0-9-]+\b/giu, redacted, location, "machine_identifier_removed", entries);
  result = result.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, (candidate) => {
    if (!ipv4Private(candidate)) return candidate;
    addRedaction(entries, location, "private_ip_removed", "redacted");
    return redacted;
  });
  return result;
}

function sanitizeVersion(value, location, entries) {
  const normalized = String(value ?? "");
  if (/^(?:main|master|develop|dev|trunk|head)$/iu.test(normalized) || /^(?:feature|fix|hotfix|release)\//iu.test(normalized)) {
    addRedaction(entries, location, "branch_reference_removed", "redacted");
    return redacted;
  }
  return sanitizeText(normalized, location, entries);
}

function sanitizeNested(value, location, entries, key = "") {
  if (typeof value === "string") return machineFields.has(key) ? value : sanitizeText(value, location, entries);
  if (Array.isArray(value)) return value.map((item, index) => sanitizeNested(item, `${location}[${index}]`, entries, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [
      childKey,
      sanitizeNested(item, `${location}.${childKey}`, entries, childKey)
    ]));
  }
  return value;
}

function localizedPublication(locale, visibility) {
  if (locale === "ja") {
    return visibility === "public"
      ? "自動伏字ではすべての機微情報を検出できません。公開前に人によるpublication reviewが必要です。"
      : "内部用レポートです。伏字前の監査情報を含む可能性があり、公開用ではありません。";
  }
  return visibility === "public"
    ? "Automated redaction cannot detect every sensitive value; human publication review is required."
    : "Internal report: it may contain unsanitized audit data and is not publication-ready.";
}

export function buildInternalRunBackedModel({ run, assessment, publicModel, envelopesById }) {
  const model = structuredClone(publicModel);
  model.target = structuredClone(run.target);
  model.scope = structuredClone(run.scope);
  model.environment = structuredClone(run.environment);
  model.limitations = structuredClone(assessment.assessment.limitations ?? []);

  const screenings = [];
  const humanReviews = [];
  const remediations = [];
  for (const record of envelopesById.values()) {
    const envelope = record?.envelope ?? record;
    if (envelope?.artifact_type === "screening-observations") screenings.push(...(envelope.payload?.observations ?? []));
    if (envelope?.artifact_type === "declared-human-review") humanReviews.push(...(envelope.payload?.reviews ?? []));
    if (envelope?.artifact_type === "remediation-plan") remediations.push(...(envelope.payload?.items ?? []));
  }
  const humanByRequirement = new Map(humanReviews.map((review) => [review.requirement_id, review]));
  const rank = { fail: 4, cant_tell: 3, not_tested: 2, pass: 1 };
  const screeningByProfile = new Map();
  for (const observation of screenings) {
    if (!observation.profile_requirement_id) continue;
    const current = screeningByProfile.get(observation.profile_requirement_id);
    if (!current || (rank[observation.report_outcome] ?? 0) > (rank[current.report_outcome] ?? 0)) {
      screeningByProfile.set(observation.profile_requirement_id, observation);
    }
  }
  const rawRationale = (check) => humanByRequirement.get(check.requirement_id)?.rationale
    ?? screeningByProfile.get(check.requirement_id)?.report_rationale
    ?? assessment.assessment.results.find((row) => row.requirement_id === check.requirement_id)?.notes
    ?? check.rationale;
  model.reportChecks = (model.reportChecks ?? []).map((check) => ({ ...check, rationale: rawRationale(check) }));
  model.notApplicableChecks = (model.notApplicableChecks ?? []).map((check) => ({ ...check, rationale: rawRationale(check) }));
  model.recordedHumanChecks = humanReviews.map((review) => ({
    requirement_id: review.requirement_id,
    outcome: review.profile_outcome,
    rationale: review.rationale
  }));
  model.screeningCandidates = screenings.map((observation) => ({
    ...structuredClone(observation),
    remediation: remediations.find((item) => item.basis === "unverified_screening_candidate"
      && item.requirement_id === observation.requirement_id) ?? null
  }));
  model.remediation = remediations.map((item) => ({
    requirement_id: item.requirement_id,
    evidence_status: item.basis === "verified_failure" ? "Verified failure" : "Unverified screening candidate",
    priority: item.priority,
    location: item.location,
    affected_users: structuredClone(item.affected_users),
    issue: item.issue,
    proposed_change: item.proposed_change,
    owner: item.owner ?? null,
    verification: item.verification,
    residual_limitation: item.residual_limitation
  }));
  return model;
}

export function applyReportVisibility(presentation, { visibility = "internal", reviewerDisclosure = "include" } = {}) {
  const selectedVisibility = normalizeReportVisibility(visibility);
  const selectedDisclosure = normalizeReviewerDisclosure(reviewerDisclosure);
  const copy = structuredClone(presentation);
  const entries = { keys: new Set(), values: [] };
  copy.publication = {
    visibility: selectedVisibility,
    reviewer_disclosure: selectedDisclosure,
    publication_review_required: selectedVisibility === "public",
    notice: localizedPublication(copy.locale, selectedVisibility)
  };
  if (selectedVisibility === "internal") {
    return {
      presentation: copy,
      manifest: {
        schema_version: "1.0.0",
        visibility: "internal",
        reviewer_disclosure: selectedDisclosure,
        publication_review_required: false,
        redactions: []
      }
    };
  }

  copy.target.name = sanitizeText(copy.target.name, "target.name", entries);
  copy.target.version_or_commit = sanitizeVersion(copy.target.version_or_commit, "target.version_or_commit", entries);
  copy.target.urls_or_files = copy.target.urls_or_files.map((value, index) => sanitizeUrl(value, `target.urls_or_files[${index}]`, entries));
  if (selectedDisclosure === "redact" && copy.evaluator) {
    copy.evaluator = redacted;
    addRedaction(entries, "evaluator", "reviewer_identity_redacted", "redacted");
  } else if (copy.evaluator) {
    copy.evaluator = sanitizeText(copy.evaluator, "evaluator", entries);
  }
  for (const field of ["included", "excluded", "complete_processes", "third_party_content"]) {
    copy.scope[field] = (copy.scope[field] ?? []).map((value, index) => sanitizeText(value, `scope.${field}[${index}]`, entries));
  }
  for (const field of ["os", "browsers", "assistive_technologies", "input_modes"]) {
    copy.environment[field] = (copy.environment[field] ?? []).map((value, index) => sanitizeText(value, `environment.${field}[${index}]`, entries));
  }
  copy.rows = copy.rows.map((row, index) => ({
    ...row,
    primary_url: sanitizeUrl(row.primary_url, `rows[${index}].primary_url`, entries),
    rationale: sanitizeText(row.rationale, `rows[${index}].rationale`, entries)
  }));
  copy.findings = sanitizeNested(copy.findings, "findings", entries, "findings");
  copy.limitations = copy.limitations.map((value, index) => sanitizeText(value, `limitations[${index}]`, entries));
  copy.claim.wording = sanitizeText(copy.claim.wording, "claim.wording", entries);
  copy.claim.reasons = copy.claim.reasons.map((value, index) => sanitizeText(value, `claim.reasons[${index}]`, entries));

  const manifest = {
    schema_version: "1.0.0",
    visibility: "public",
    reviewer_disclosure: selectedDisclosure,
    publication_review_required: true,
    redactions: entries.values.sort((left, right) => left.path.localeCompare(right.path, "en")
      || left.reason.localeCompare(right.reason, "en")
      || left.action.localeCompare(right.action, "en"))
  };
  return { presentation: copy, manifest };
}

export function addPublicationNotice(markdown, presentation) {
  const lines = String(markdown).split("\n");
  const insertion = lines[1] === "" ? 2 : 1;
  lines.splice(insertion, 0, `> ${presentation.publication.notice}`, "");
  return lines.join("\n");
}
