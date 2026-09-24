import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { assertNewOutputPath, assertStableFile, readStableFile, resolveInside, validateAuditRun, writeNewJson } from "./audit-run.mjs";
import { compareInstants, isCalendarDate } from "./date-time.mjs";
import { reviewEntries, resolveHumanReviews, consensusReviewRows, consensusRemediationItems } from "./human-review-consensus.mjs";
import { validateJsonSchema } from "./json-schema.mjs";
import { declaredFindings, findingRelations, remediationPlanItems } from "./run-findings.mjs";

const schema = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../references/finding-lifecycle.schema.json", import.meta.url)), "utf8"));
const allowed = {
  open: ["investigating", "planned", "in_progress"],
  investigating: ["open", "planned", "in_progress"],
  planned: ["open", "in_progress"],
  in_progress: ["planned", "fixed"],
  fixed: ["in_progress", "verified"],
  verified: ["in_progress", "closed"],
  closed: ["open"]
};
const exceptionTypes = new Set(["deferred", "accepted_risk", "exception_granted"]);
const stateKeys = new Set(["status", "assignee", "accountable_owner", "due_on", "target_release", "blocked_by", "external_issues", "decision", "closure"]);
const parse = (snapshot) => JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
const same = (a, b) => isDeepStrictEqual(a, b);

function privateFile(root, file, { existing = false } = {}) {
  const absolute = path.resolve(file), relative = path.relative(root, absolute);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Lifecycle files must stay inside the run private artifact root.");
  }
  return existing ? resolveInside(root, absolute) : assertNewOutputPath(absolute);
}

function sourceFinding(run, validation, id) {
  const records = [...validation.envelopesById.values()].map(({ envelope }) => envelope);
  const reviews = resolveHumanReviews(reviewEntries(records.filter((item) => item.artifact_type === "declared-human-review")
    .map((item) => ({ payload: item.payload, artifact_id: item.artifact_id }))));
  const plans = consensusRemediationItems(reviews, records.filter((item) => item.artifact_type === "remediation-plan")
    .flatMap((item) => remediationPlanItems(item.payload)));
  const relation = findingRelations(records, { reviews: reviews.findingReviews, plans }).find((item) => item.finding_id === id);
  if (!relation) throw new Error(`Unknown registered finding ID: ${id}.`);
  const declared = reviews.findingReviews.flatMap((review) => declaredFindings(review)).find((item) => item.id === id);
  const priority = declared?.priority ?? plans.find((item) => (item.finding_id ?? item.remediation_id) === id)?.priority;
  if (!["P0", "P1", "P2"].includes(priority)) throw new Error(`Finding priority is unavailable: ${id}.`);
  const remediationIds = records.filter((item) => item.artifact_type === "remediation-plan")
    .flatMap((item) => item.payload.items).filter((item) => (item.finding_id ?? item.remediation_id) === id)
    .map((item) => item.remediation_id).sort((a, b) => a.localeCompare(b, "en"));
  return { run_id: run.run_id, finding_id: id, priority,
    requirement_ids: [...relation.requirement_ids].sort((a, b) => a.localeCompare(b, "en")), remediation_ids: remediationIds };
}

function validateDecision(state) {
  const decision = state.decision;
  if (!decision) return;
  if (decision.type === "duplicate" && !decision.duplicate_of) throw new Error("Duplicate decision requires duplicate_of.");
  if (decision.type !== "duplicate" && decision.duplicate_of) throw new Error("duplicate_of is only valid for a duplicate decision.");
  if (exceptionTypes.has(decision.type)) {
    if (!isCalendarDate(decision.expires_on) || !isCalendarDate(decision.review_on)) {
      throw new Error("Deferred, accepted-risk and exception decisions require an expiry and review date.");
    }
    if (decision.review_on > decision.expires_on) throw new Error("Exception review date must be no later than expiry.");
  } else if (decision.expires_on !== null || decision.review_on !== null) {
    throw new Error("Only deferred, accepted-risk and exception decisions may have expiry/review dates.");
  }
  if (["verified", "closed"].includes(state.status)) {
    throw new Error("A decision does not verify or close a finding; clear it before verified/closed.");
  }
}

function validateClosure(record, run, validation, runFile) {
  const state = record.state;
  if (["verified", "closed"].includes(state.status) && !state.closure) throw new Error("Verified/closed requires change, retest and verification evidence.");
  if (!state.closure) return [];
  if (!["fixed", "verified", "closed"].includes(state.status)) throw new Error("Closure evidence requires fixed, verified or closed status.");
  const change = validation.envelopesById.get(state.closure.change_artifact_id)?.envelope;
  if (run.status !== "retest_required" || !["change-record", "declared-change-record"].includes(change?.artifact_type)) {
    throw new Error("Closure must link a registered completed change record.");
  }
  const retestFile = path.resolve(path.dirname(runFile), state.closure.retest_run_file);
  const retestSnapshot = readStableFile(retestFile, { label: "closure retest run" });
  if (retestSnapshot.sha256 !== state.closure.retest_run_sha256) throw new Error("Closure retest run hash mismatch.");
  const successor = parse(retestSnapshot), successorValidation = validateAuditRun(successor, { runFile: retestFile });
  if (!successorValidation.valid || successor.supersedes_run_id !== run.run_id || successor.target.version_or_commit === run.target.version_or_commit
    || successor.target.name !== run.target.name || !same(successor.target.urls_or_files, run.target.urls_or_files)
    || !same(successor.profile, run.profile) || !same(successor.scope, run.scope)
    || (change.artifact_type === "declared-change-record" && successor.target.version_or_commit !== change.payload.after_version)
    || !successor.target_inventory || successor.status === "retest_required") {
    throw new Error("Closure requires a valid measured retest of the source run.");
  }
  const successorRecords = [...successorValidation.envelopesById.values()].map(({ envelope }) => envelope);
  const reviews = resolveHumanReviews(reviewEntries(successorRecords.filter((item) => item.artifact_type === "declared-human-review")
    .map((item) => ({ payload: item.payload, artifact_id: item.artifact_id }))));
  const outcomes = new Map(consensusReviewRows(reviews).map((item) => [item.requirement_id, item.profile_outcome]));
  if (!record.requirement_ids.length || !record.requirement_ids.every((id) => outcomes.get(id) === "pass")) {
    throw new Error("Closure requires successor human pass declarations for every related requirement.");
  }
  const evidencePath = privateFile(successorValidation.artifactRoot,
    path.resolve(successorValidation.artifactRoot, state.closure.verification_file), { existing: true });
  const evidence = readStableFile(evidencePath, { label: "closure verification evidence" });
  if (evidence.sha256 !== state.closure.verification_sha256) throw new Error("Closure verification evidence hash mismatch.");
  return [retestSnapshot, evidence, ...[...successorValidation.envelopesById.values()].map((item) => item.snapshot),
    ...successorValidation.evidenceSnapshots.values()];
}

function validateRecord(record, previous, source, run, validation, runFile) {
  const errors = validateJsonSchema(record, schema);
  if (errors.length) throw new Error(`Invalid lifecycle record:\n- ${errors.join("\n- ")}`);
  for (const key of ["run_id", "finding_id", "priority", "requirement_ids", "remediation_ids"]) {
    if (!same(record[key], source[key])) throw new Error(`Lifecycle ${key} differs from registered finding evidence.`);
  }
  if (run.history.at(-1)?.at && compareInstants(record.updated_at, run.history.at(-1).at) < 0) {
    throw new Error("Lifecycle updated_at predates the registered finding state.");
  }
  const decision = record.state.decision;
  validateDecision(record.state);
  if (record.state.due_on !== null && !isCalendarDate(record.state.due_on)) throw new Error("Invalid due_on calendar date.");
  if (previous) {
    if (record.revision !== previous.revision + 1) throw new Error("Lifecycle revision must increase by one.");
    if (compareInstants(record.updated_at, previous.updated_at) <= 0) throw new Error("Lifecycle updated_at must increase.");
    if (record.state.status === previous.state.status) {
      if (same(record.state, previous.state)) throw new Error("Lifecycle update has no state change.");
    } else if (!allowed[previous.state.status].includes(record.state.status)) {
      throw new Error(`Invalid lifecycle transition: ${previous.state.status} -> ${record.state.status}.`);
    }
  } else if (record.revision !== 1 || record.previous !== null || record.state.status !== "open") {
    throw new Error("First lifecycle revision must start open without a predecessor.");
  }
  if (decision && ["accepted_risk", "deferred", "exception_granted"].includes(decision.type)
    && record.state.closure) throw new Error("An exception cannot be treated as closure evidence.");
  return validateClosure(record, run, validation, runFile);
}

export function initialLifecycle(run, validation, findingId, updatedAt = new Date().toISOString()) {
  return { schema_version: "1.0.0", publication: "private_by_default",
    ...sourceFinding(run, validation, findingId), revision: 1, previous: null, updated_at: updatedAt,
    state: { status: "open", assignee: null, accountable_owner: null, due_on: null, target_release: null,
      blocked_by: [], external_issues: [], decision: null, closure: null } };
}

export function advanceLifecycle(previous, patch, previousFile, previousHash, root, updatedAt = new Date().toISOString()) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)
    || Object.keys(patch).some((key) => key !== "updated_at" && !stateKeys.has(key))) {
    throw new Error("Lifecycle patch may only update state fields and updated_at.");
  }
  const { updated_at: suppliedAt, ...changes } = patch;
  const at = suppliedAt ?? (compareInstants(updatedAt, previous.updated_at) > 0
    ? updatedAt : new Date(Date.parse(previous.updated_at) + 1).toISOString());
  const predecessor = privateFile(root, previousFile, { existing: true });
  return { ...structuredClone(previous), revision: previous.revision + 1,
    previous: { file: path.relative(root, predecessor).split(path.sep).join("/"), sha256: previousHash },
    updated_at: at, state: { ...structuredClone(previous.state), ...structuredClone(changes) } };
}

export function loadLifecycle(file, { run, validation, runFile }) {
  if (!validation.valid) throw new Error("Lifecycle requires a valid audit run.");
  const root = validation.artifactRoot, seen = new Set(), snapshots = [];
  const visit = (candidate, depth) => {
    if (depth > 1000) throw new Error("Lifecycle chain exceeds 1000 revisions.");
    const safeFile = privateFile(root, candidate, { existing: true });
    if (seen.has(safeFile)) throw new Error("Lifecycle predecessor cycle.");
    seen.add(safeFile);
    const snapshot = readStableFile(safeFile, { label: "lifecycle revision", maxBytes: 1024 * 1024 });
    const record = parse(snapshot);
    const schemaErrors = validateJsonSchema(record, schema);
    if (schemaErrors.length) throw new Error(`Invalid lifecycle record:\n- ${schemaErrors.join("\n- ")}`);
    const source = sourceFinding(run, validation, record.finding_id);
    let parent = null, history = [];
    if (record.previous) {
      const previousFile = path.resolve(root, record.previous.file);
      const prior = visit(previousFile, depth + 1);
      if (prior.snapshot.sha256 !== record.previous.sha256) throw new Error("Lifecycle predecessor hash mismatch.");
      parent = prior.record; history = prior.history;
    }
    snapshots.push(snapshot);
    snapshots.push(...validateRecord(record, parent, source, run, validation, runFile));
    return { record, snapshot, history: [...history, { revision: record.revision, status: record.state.status,
      updated_at: record.updated_at, decision_type: record.state.decision?.type ?? null }] };
  };
  const result = visit(file, 1);
  for (const snapshot of snapshots) assertStableFile(snapshot, "lifecycle input");
  return { ...result, snapshots };
}

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function lifecycleSummary(record, asOf = localDate()) {
  if (!isCalendarDate(asOf)) throw new Error("asOf must be a valid YYYY-MM-DD date.");
  const state = record.state, active = state.status !== "closed";
  const decision = state.decision;
  return { finding_id: record.finding_id, priority: record.priority, status: state.status, as_of: asOf,
    assignee: state.assignee, accountable_owner: state.accountable_owner, due_on: state.due_on,
    target_release: state.target_release, blocked_by: state.blocked_by, external_issues: state.external_issues,
    decision_type: decision?.type ?? null, decision_review_on: decision?.review_on ?? null,
    overdue: active && state.due_on !== null && state.due_on < asOf,
    owner_missing: active && ["P0", "P1"].includes(record.priority) && !state.accountable_owner,
    exception_expired: Boolean(decision && exceptionTypes.has(decision.type) && decision.expires_on < asOf),
    exception_review_due: Boolean(decision && exceptionTypes.has(decision.type) && decision.review_on <= asOf),
    resolution_claim: state.status === "closed" && !decision ? "verified_closure" : "not_resolved" };
}

export function renderLifecycleReport(summaries, locale = "ja") {
  if (!summaries.length) return "";
  const safe = (value) => String(value ?? "—").replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;").replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
  const en = locale === "en";
  const rows = summaries.map((item) => `| ${[item.finding_id, item.status, item.due_on,
    item.owner_missing ? (en ? "missing" : "要設定") : "—", item.overdue ? (en ? "overdue" : "期限超過") : "—",
    item.decision_type ?? "—", item.exception_expired ? (en ? "expired" : "期限切れ") : "—"].map(safe).join(" | ")} |`);
  return ["", en ? "## Finding management" : "## 改善管理状況", "",
    en ? "Management decisions do not establish a conformance pass or finding resolution. Names and external issue IDs are private."
      : "管理上の判断は規格のpassや指摘の解消を意味しません。担当者名と外部Issue IDは非公開です。",
    `${en ? "As of" : "基準日"}: ${safe(summaries[0].as_of)}`, "",
    en ? "| Finding ID | Status | Due | Owner | Due alert | Decision | Exception alert |"
      : "| 指摘ID | 状態 | 期限 | 責任者 | 期限警告 | 判断 | 例外警告 |",
    "| --- | --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

export function renderLifecycleHtml(summaries, locale = "ja") {
  if (!summaries.length) return "";
  const safe = (value) => String(value ?? "—").replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
  const en = locale === "en";
  const headings = en ? ["Finding ID", "Status", "Due", "Owner", "Due alert", "Decision", "Exception alert"]
    : ["指摘ID", "状態", "期限", "責任者", "期限警告", "判断", "例外警告"];
  const rows = summaries.map((item) => [item.finding_id, item.status, item.due_on,
    item.owner_missing ? (en ? "missing" : "要設定") : "—", item.overdue ? (en ? "overdue" : "期限超過") : "—",
    item.decision_type ?? "—", item.exception_expired ? (en ? "expired" : "期限切れ") : "—"])
    .map((row) => `<tr><th scope="row">${safe(row[0])}</th>${row.slice(1).map((value) => `<td>${safe(value)}</td>`).join("")}</tr>`).join("");
  return `<section id="finding-lifecycle"><h2>${en ? "Finding management" : "改善管理状況"}</h2>
<p>${en ? "Management decisions do not establish a conformance pass or finding resolution. Names and external issue IDs are private."
    : "管理上の判断は規格のpassや指摘の解消を意味しません。担当者名と外部Issue IDは非公開です。"}</p>
<p>${en ? "As of" : "基準日"}: ${safe(summaries[0].as_of)}</p>
<div class="table-region" role="region" aria-labelledby="finding-lifecycle-caption" tabindex="0"><table>
<caption id="finding-lifecycle-caption">${en ? "Finding management status" : "指摘の管理状況"}</caption>
<thead><tr>${headings.map((value) => `<th scope="col">${safe(value)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export function writeLifecycle(output, record, { run, validation, runFile, inputSnapshots = [] }) {
  const target = privateFile(validation.artifactRoot, output);
  const source = sourceFinding(run, validation, record.finding_id);
  let previous = null;
  if (record.previous) {
    const priorFile = path.resolve(validation.artifactRoot, record.previous.file);
    const prior = loadLifecycle(priorFile, { run, validation, runFile });
    if (prior.snapshot.sha256 !== record.previous.sha256) throw new Error("Lifecycle predecessor hash mismatch.");
    previous = prior.record;
    inputSnapshots.push(...prior.snapshots);
  }
  inputSnapshots.push(...validateRecord(record, previous, source, run, validation, runFile));
  const stable = () => {
    for (const snapshot of inputSnapshots) assertStableFile(snapshot, "lifecycle input");
    for (const item of validation.envelopesById.values()) assertStableFile(item.snapshot, "registered artifact");
    for (const snapshot of validation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
  };
  return writeNewJson(target, record, { beforeWrite: stable });
}
