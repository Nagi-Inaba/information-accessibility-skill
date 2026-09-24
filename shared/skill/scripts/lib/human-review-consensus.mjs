import { isDeepStrictEqual } from "node:util";
import { declaredFindings } from "./run-findings.mjs";

// Inputs are immutable review subjects, not cached assessment decisions. An ID
// identifies a declared reviewer; identity assurance is verified separately.
export function reviewEntries(sources) {
  return sources.flatMap((source) => source.payload.reviews.map((review) => ({
    review, version: source.payload.schema_version,
    review_id: review.review_id ?? `${source.record_sha256 ?? source.artifact_id}:${review.requirement_id}`,
    reviewer_id: source.payload.reviewer_id ?? source.reviewer_id ?? source.artifact_id,
    reviewer_name: source.payload.reviewer_name, reviewer_role: source.payload.reviewer_role ?? null,
    review_date: source.payload.review_date, recorded_at: source.recorded_at ?? null,
    record_sha256: source.record_sha256 ?? null, artifact_id: source.artifact_id ?? null
  })));
}

export function resolveHumanReviews(entries) {
  const byId = new Map(), superseded = new Map(), grouped = new Map();
  const modern = entries.some((entry) => entry.version === "3.0.0");
  for (const entry of entries) {
    if (byId.has(entry.review_id)) throw new Error(`Duplicate human review ID: ${entry.review_id}.`);
    byId.set(entry.review_id, entry);
    const id = entry.review.requirement_id, group = grouped.get(id) ?? [];
    if (!modern && group.length) throw new Error(`Duplicate declared-human profile row conflict: ${id}.`);
    group.push(entry); grouped.set(id, group);
  }
  for (const entry of entries) {
    const priorId = entry.review.supersedes_review_id;
    if (!priorId) continue;
    const prior = byId.get(priorId);
    if (!prior || priorId === entry.review_id || prior.review.requirement_id !== entry.review.requirement_id
      || prior.reviewer_id !== entry.reviewer_id) throw new Error(`Supersede requires an existing review by the same declared reviewer for the same criterion: ${priorId}.`);
    if (superseded.has(priorId)) throw new Error(`A human review cannot have competing successors: ${priorId}.`);
    if (entry.review_date < prior.review_date) throw new Error(`Superseding review predates its predecessor: ${entry.review_id}.`);
    superseded.set(priorId, entry.review_id);
  }
  for (const entry of entries) {
    const seen = new Set(); let current = entry;
    while (current) {
      if (seen.has(current.review_id)) throw new Error("Human review supersession cycle.");
      seen.add(current.review_id); current = byId.get(current.review.supersedes_review_id);
    }
  }
  const groups = new Map();
  for (const [requirement_id, history] of grouped) {
    history.sort((a, b) => a.review_id.localeCompare(b.review_id, "en"));
    const active = history.filter((entry) => !superseded.has(entry.review_id));
    if (new Set(active.map((entry) => entry.reviewer_id)).size !== active.length) throw new Error(`Use supersedes_review_id to revise a review by the same declared reviewer: ${requirement_id}.`);
    const outcomes = new Set(active.map((entry) => entry.review.profile_outcome)), findingDetails = new Map();
    let findingConflict = false;
    for (const entry of active) for (const finding of declaredFindings(entry.review)) {
      if (findingDetails.has(finding.id) && !isDeepStrictEqual(findingDetails.get(finding.id), finding)) findingConflict = true;
      findingDetails.set(finding.id, finding);
    }
    const status = outcomes.size !== 1 || findingConflict ? "unresolved_disagreement" : active.length > 1 ? "agreement" : "single_review";
    const profile_outcome = status === "unresolved_disagreement" ? "cant_tell" : active[0].review.profile_outcome;
    const rationale = history.length === 1 ? active[0].review.rationale
      : `Human review consensus (unanimous active reviews): ${status}.\n`
        + active.map((entry) => `Review ${history.indexOf(entry) + 1}: ${entry.review.profile_outcome}. ${entry.review.rationale}`).join("\n")
        + (findingConflict ? "\nDeclared details for the same finding ID conflict." : "");
    const evidence = [...new Map(active.flatMap((entry) => entry.review.target_specific_evidence).map((item) => [JSON.stringify(item), item])).values()];
    const resolution = { policy: "unanimous_active_reviews", status,
      review_refs: history.map((entry) => ({ review_id: entry.review_id, record_sha256: entry.record_sha256,
        state: superseded.has(entry.review_id) ? "superseded" : "active" })) };
    // Procedure/source details remain on each source review. The projection only
    // supplies the fields shared by assessment and report result consumers.
    const review = { requirement_id, profile_outcome, rationale, target_specific_evidence: structuredClone(evidence),
      ...(modern ? { review_resolution: resolution } : {}),
      ...(history.length === 1 ? structuredClone(active[0].review) : {}) };
    groups.set(requirement_id, { requirement_id, status, active, history, review, resolution });
  }
  return { modern, groups, superseded, active: [...groups.values()].flatMap((group) => group.active),
    findingReviews: [...groups.values()].filter((group) => group.review.profile_outcome === "fail").flatMap((group) => group.active.map((entry) => entry.review)) };
}

export function consensusReviewRows(resolved) {
  return [...resolved.groups.values()].map((group) => group.review);
}

export function consensusRemediationItems(resolved, items) {
  if (!resolved.modern) return items;
  const failed = (id) => resolved.groups.get(id)?.review.profile_outcome === "fail";
  return items.flatMap((item) => {
    if (item.basis !== "verified_failure") return [item];
    if (!item.finding_id) return failed(item.requirement_id) ? [item] : [];
    const requirement_ids = item.requirement_ids.filter(failed);
    return requirement_ids.length ? [{ ...item, requirement_ids }] : [];
  });
}

export function reviewHistoryForReport(group) {
  if (!group || !group.review.review_resolution) return undefined;
  return group.history.map((entry, index) => ({
    number: index + 1, state: group.active.includes(entry) ? "active" : "superseded",
    supersedes: entry.review.supersedes_review_id ? group.history.findIndex((item) => item.review_id === entry.review.supersedes_review_id) + 1 : null,
    reviewer_name: entry.reviewer_name, reviewer_role: entry.reviewer_role, review_date: entry.review_date,
    outcome: entry.review.profile_outcome, rationale: entry.review.rationale,
    procedure: entry.review.criterion_procedure_ref ?? entry.review.generic_method_ref,
    official_sources: structuredClone(entry.review.official_sources), evidence: structuredClone(entry.review.target_specific_evidence),
    findings: declaredFindings(entry.review).map(({ id: _id, ...finding }) => structuredClone(finding))
  }));
}
