import { isDeepStrictEqual } from "node:util";
import { screeningMappings } from "./review-details.mjs";

export const declaredFindings = (review) => review?.findings ?? (review?.finding ? [review.finding] : []);

export function declaredFindingErrors(reviews) {
  const errors = [], seen = new Map();
  for (const review of reviews) {
    const ids = new Set(), contents = new Set();
    for (const finding of declaredFindings(review)) {
      if (review.profile_outcome !== "fail") errors.push(`Human review finding requires profile_outcome fail: ${review.requirement_id}.`);
      if (ids.has(finding.id)) errors.push(`Duplicate finding ID in human review: ${finding.id}.`);
      ids.add(finding.id);
      const content = JSON.stringify([finding.priority, finding.location.trim(), [...finding.affected_users].sort(), finding.observation.trim()]);
      if (contents.has(content)) errors.push(`Duplicate human finding content for ${review.requirement_id}: ${finding.id}.`);
      contents.add(content);
      if (seen.has(finding.id) && !isDeepStrictEqual(seen.get(finding.id), finding)) errors.push(`Conflicting human finding details: ${finding.id}.`);
      seen.set(finding.id, finding);
    }
  }
  return errors;
}

// The stored plan has one finding and separate remedies. Older singular items
// keep their original projection; callers never rewrite registered payloads.
export function remediationPlanItems(payload) {
  if (!Array.isArray(payload?.findings)) return payload?.items ?? [];
  return payload.findings.map((finding) => {
    const plans = payload.items.filter((item) => item.finding_id === finding.finding_id);
    const values = (key) => [...new Set(plans.map((item) => item[key]).filter(Boolean))].join("\n") || null;
    return { ...finding, remediation_id: finding.finding_id, remediation_ids: plans.map((item) => item.remediation_id),
      requirement_id: finding.requirement_ids[0] ?? finding.observation_refs[0]?.requirement_id,
      source_artifact_ids: [...new Set([...finding.observation_refs, ...finding.human_review_refs].map((ref) => ref.artifact_id))],
      location: finding.locations.join("\n"), proposed_change: values("proposed_change"), verification: values("verification"),
      owner: values("owner"), residual_limitation: values("residual_limitation") };
  });
}

export function findingRelationErrors(artifact, envelopes) {
  const payload = artifact.payload;
  if (!Array.isArray(payload?.findings)) return [];
  const errors = [], usedInputs = new Set(), inputs = new Set(artifact.inputs.map((input) => input.artifact_id));
  const findings = new Set(), remedies = new Set(), findingContents = new Set(), remedyContents = new Set();
  for (const finding of payload.findings) {
    const label = `Finding ${finding.finding_id}`;
    if (findings.has(finding.finding_id)) errors.push(`Duplicate finding ID: ${finding.finding_id}.`);
    findings.add(finding.finding_id);
    const references = (refs) => refs.map((ref) => JSON.stringify([ref.artifact_id, ref.requirement_id])).sort();
    const content = JSON.stringify([finding.basis, [...finding.requirement_ids].sort(), references(finding.observation_refs), references(finding.human_review_refs),
      finding.priority, [...finding.locations].sort(), [...finding.affected_users].sort(), finding.issue.trim()]);
    if (findingContents.has(content)) errors.push(`Duplicate finding content under a different ID: ${finding.finding_id}.`);
    findingContents.add(content);
    const mapped = new Set(), failures = new Set();
    for (const [field, type, records] of [["observation_refs", "screening-observations", "observations"], ["human_review_refs", "declared-human-review", "reviews"]]) {
      for (const ref of finding[field]) {
        const source = envelopes.get(ref.artifact_id);
        if (!inputs.has(ref.artifact_id) || !source || source.run_id !== artifact.run_id || source.artifact_type !== type) {
          errors.push(`${label} ${field} must reference a same-run registered ${type} input: ${ref.artifact_id}.`); continue;
        }
        usedInputs.add(ref.artifact_id);
        const record = source.payload[records].find((item) => item.requirement_id === ref.requirement_id);
        if (!record) { errors.push(`${label} has an unknown ${field} record: ${ref.requirement_id}.`); continue; }
        if (type === "screening-observations") screeningMappings(record).forEach((mapping) => mapped.add(mapping.requirement_id));
        else {
          if (record.profile_outcome !== "fail" || !finding.requirement_ids.includes(record.requirement_id)) errors.push(`${label} human review must be a linked declared failure: ${record.requirement_id}.`);
          else failures.add(record.requirement_id);
          const declared = declaredFindings(record), humanFinding = declared.find((item) => item.id === finding.finding_id);
          if (declared.length && (!humanFinding || humanFinding.priority !== finding.priority
            || humanFinding.observation !== finding.issue || humanFinding.location !== finding.locations.join("\n")
            || !isDeepStrictEqual(humanFinding.affected_users, finding.affected_users))) {
            errors.push(`${label} must preserve the human-declared finding identity and details.`);
          }
        }
      }
    }
    const supported = finding.basis === "verified_failure" ? failures : mapped;
    for (const id of finding.requirement_ids) if (!supported.has(id)) errors.push(`${label} requirement lacks matching ${finding.basis} evidence: ${id}.`);
    if (!payload.items.some((item) => item.finding_id === finding.finding_id)) errors.push(`${label} has no remediation item.`);
  }
  for (const item of payload.items) {
    if (!findings.has(item.finding_id)) errors.push(`Remediation ${item.remediation_id} references an unknown finding: ${item.finding_id}.`);
    if (remedies.has(item.remediation_id)) errors.push(`Duplicate remediation ID: ${item.remediation_id}.`);
    remedies.add(item.remediation_id);
    const content = JSON.stringify([item.finding_id, item.proposed_change.trim(), item.verification.trim(), item.owner?.trim() ?? null, item.residual_limitation.trim()]);
    if (remedyContents.has(content)) errors.push(`Duplicate remediation content for finding ${item.finding_id}.`);
    remedyContents.add(content);
  }
  for (const id of inputs) if (!usedInputs.has(id)) errors.push(`Remediation plan ${artifact.artifact_id} has an unused evidence input: ${id}.`);
  return errors;
}

export function findingRelations(envelopes, overrides = {}) {
  const observations = envelopes.filter((item) => item.artifact_type === "screening-observations").flatMap((item) => item.payload.observations);
  const reviews = overrides.reviews ?? envelopes.filter((item) => item.artifact_type === "declared-human-review").flatMap((item) => item.payload.reviews);
  const plans = overrides.plans ?? envelopes.filter((item) => item.artifact_type === "remediation-plan").flatMap((item) => remediationPlanItems(item.payload));
  const findings = new Map();
  for (const item of plans) {
    if (!item.finding_id && item.basis === "verified_failure" && reviews.some((review) => review.requirement_id === item.requirement_id && declaredFindings(review).length)) continue;
    const ids = item.requirement_ids ?? (item.basis === "verified_failure" ? [item.requirement_id]
      : observations.filter((observation) => observation.requirement_id === item.requirement_id).flatMap((observation) => screeningMappings(observation).map((mapping) => mapping.requirement_id)));
    const finding_id = item.finding_id ?? item.remediation_id;
    findings.set(finding_id, { finding_id, requirement_ids: [...new Set(ids)].sort() });
  }
  for (const review of reviews) for (const declared of declaredFindings(review)) if (review.profile_outcome === "fail") {
    const finding = findings.get(declared.id) ?? { finding_id: declared.id, requirement_ids: [] };
    finding.requirement_ids = [...new Set([...finding.requirement_ids, review.requirement_id])].sort(); findings.set(finding.finding_id, finding);
  }
  return [...findings.values()].sort((a, b) => a.finding_id.localeCompare(b.finding_id, "en"));
}

// These are declared criterion retest results aggregated for each prior finding.
// They do not assert that every original location was repaired or close a finding.
export function findingRetestSummary(findings, reviews, { comparison = false, required = false } = {}) {
  const byId = new Map(reviews.map((review) => [review.requirement_id, review]));
  const requirements = [...new Set(findings.flatMap((finding) => finding.requirement_ids))].sort().map((requirement_id) => {
    const outcome = comparison ? byId.get(requirement_id)?.profile_outcome : null;
    return { requirement_id, status: !comparison ? (required ? "retest_required" : "not_recorded")
      : ["pass", "fail", "not_applicable"].includes(outcome) ? outcome + "_declared" : "pending" };
  });
  const statuses = new Map(requirements.map((item) => [item.requirement_id, item.status]));
  return { basis: comparison ? "successor_declared_human_reviews" : "no_successor_comparison", requirements,
    findings: findings.map((finding) => {
      const values = finding.requirement_ids.map((id) => statuses.get(id));
      const status = !values.length ? "unmapped" : !comparison ? values[0] : values.includes("fail_declared") ? "related_requirement_failed"
        : values.includes("pending") ? "pending" : values.every((value) => value === "pass_declared") ? "all_related_requirements_pass_declared" : "related_requirements_pass_or_not_applicable_declared";
      return { ...finding, status };
    }) };
}

// Both merge and report validation use this projection of registered evidence.
// Reviewers own the finding; planners may add a remedy without rewriting it.
export function findingPlanMetadata(finding, remediationItems) {
  const plans = remediationItems.filter((item) => item.basis === "verified_failure" && (item.finding_id
    ? item.finding_id === finding.id : finding.requirement_ids.includes(item.requirement_id)))
    .sort((a, b) => a.remediation_id.localeCompare(b.remediation_id, "en"));
  const values = (key) => [...new Set(plans.map((item) => item[key]).filter(Boolean))].join("\n") || null;
  return { owner: values("owner"), residual_limitation: values("residual_limitation") };
}

export function buildRunFindings(humanReviews, remediationItems) {
  const errors = declaredFindingErrors(humanReviews);
  if (errors.length) throw new Error(errors.join("\n"));
  const verified = remediationItems.filter((item) => item.basis === "verified_failure")
    .sort((a, b) => a.remediation_id.localeCompare(b.remediation_id, "en"));
  const modern = verified.filter((item) => item.finding_id);
  const findings = modern.map((item) => ({ id: item.finding_id, priority: item.priority,
    requirement_ids: [...item.requirement_ids].sort(), location: item.location, affected_users: structuredClone(item.affected_users),
    observation: item.issue, remediation_status: "planned", remediation: item.proposed_change, verification: item.verification }));
  for (const review of humanReviews) {
    if (review.profile_outcome !== "fail") continue;
    const plans = verified.filter((item) => !item.finding_id && item.requirement_id === review.requirement_id);
    const declared = declaredFindings(review);
    if (declared.length) {
      if (plans.length && declared.length > 1) throw new Error(`Multiple human findings require explicit finding_id remediation links: ${review.requirement_id}.`);
      for (const humanFinding of declared) {
        const existing = findings.find((finding) => finding.id === humanFinding.id);
        if (existing) {
          if (Object.entries(humanFinding).some(([key, value]) => !isDeepStrictEqual(existing[key], value))) throw new Error(`Conflicting human finding details: ${humanFinding.id}.`);
          existing.requirement_ids = [...new Set([...existing.requirement_ids, review.requirement_id])].sort();
          if (plans.length) {
            existing.remediation_status = "planned";
            existing.remediation = [...new Set([existing.remediation, ...plans.map((item) => item.proposed_change)].filter(Boolean))].join("\n");
            existing.verification = [...new Set([existing.verification, ...plans.map((item) => item.verification)].filter(Boolean))].join("\n");
          }
          continue;
        }
        findings.push({
          ...structuredClone(humanFinding),
          requirement_ids: [review.requirement_id],
          remediation_status: plans.length ? "planned" : "unplanned",
          remediation: plans.length ? plans.map((item) => item.proposed_change).join("\n") : null,
          verification: plans.length ? plans.map((item) => item.verification).join("\n") : null
        });
      }
    } else {
      if (modern.some((item) => item.requirement_ids.includes(review.requirement_id))) continue;
      if (!plans.length) throw new Error(`Human fail requires finding details or a matching verified_failure remediation item: ${review.requirement_id}.`);
      // Preserve the older finding+remediation representation exactly.
      findings.push(...plans.map((item) => ({
        id: item.remediation_id,
        priority: item.priority,
        requirement_ids: [item.requirement_id],
        location: item.location,
        affected_users: structuredClone(item.affected_users),
        observation: item.issue,
        remediation: item.proposed_change,
        verification: item.verification
      })));
    }
  }
  if (new Set(findings.map((item) => item.id)).size !== findings.length) {
    throw new Error("Duplicate finding ID in declared human findings or verified remediation evidence.");
  }
  return findings.sort((a, b) => a.id.localeCompare(b.id, "en"));
}
