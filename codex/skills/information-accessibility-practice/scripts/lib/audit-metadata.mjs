const allowedProducerRoles = new Set(["metadata_reviewer", "declared_external_human"]);
const participationKeys = ["find", "receive", "understand", "participate", "continue"];
const outcomes = new Set(["pass", "fail", "not_applicable", "not_tested", "cant_tell"]);
const calendarDate = /^\d{4}-\d{2}-\d{2}$/u;

function isRealDate(value) {
  if (typeof value !== "string" || !calendarDate.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  return instant.getUTCFullYear() === year
    && instant.getUTCMonth() === month - 1
    && instant.getUTCDate() === day;
}

function uniqueText(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function validateParticipationCoverage(value, artifactId) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${artifactId} participation_coverage must be an object`);
  for (const [key, entry] of Object.entries(value)) {
    if (!participationKeys.includes(key)) throw new Error(`${artifactId} contains unknown participation key: ${key}`);
    if (!entry || typeof entry !== "object" || !outcomes.has(entry.outcome)) {
      throw new Error(`${artifactId} participation ${key} requires a registered outcome`);
    }
    if (typeof entry.rationale !== "string" || !entry.rationale.trim()) {
      throw new Error(`${artifactId} participation ${key} requires rationale`);
    }
  }
}

export function mergeAuditMetadata({ base = {}, artifacts = [] }) {
  if (!Array.isArray(artifacts)) throw new Error("artifacts must be an array");
  const result = {
    participation_coverage: structuredClone(base.participation_coverage ?? {}),
    limitations: uniqueText(base.limitations ?? []),
    next_review_at: base.next_review_at ?? null,
    review_conditions: uniqueText(base.review_conditions ?? []),
    metadata_sources: structuredClone(base.metadata_sources ?? [])
  };

  const ordered = [...artifacts].sort((left, right) => String(left?.created_at ?? "").localeCompare(String(right?.created_at ?? ""), "en")
    || String(left?.artifact_id ?? "").localeCompare(String(right?.artifact_id ?? ""), "en"));

  for (const artifact of ordered) {
    const artifactId = artifact?.artifact_id;
    const role = artifact?.producer?.role_id;
    if (typeof artifactId !== "string" || !artifactId) throw new Error("Each metadata artifact requires artifact_id");
    if (!allowedProducerRoles.has(role)) throw new Error(`${artifactId} producer is not authorized to record audit metadata`);
    const payload = artifact.payload ?? {};
    validateParticipationCoverage(payload.participation_coverage, artifactId);
    if (payload.next_review_at !== undefined && payload.next_review_at !== null && !isRealDate(payload.next_review_at)) {
      throw new Error(`${artifactId} next_review_at must be a real YYYY-MM-DD date or null`);
    }

    for (const [key, entry] of Object.entries(payload.participation_coverage ?? {})) {
      result.participation_coverage[key] = structuredClone(entry);
    }
    result.limitations = uniqueText([...result.limitations, ...(payload.limitations ?? [])]);
    result.review_conditions = uniqueText([...result.review_conditions, ...(payload.review_conditions ?? [])]);
    if (Object.hasOwn(payload, "next_review_at")) result.next_review_at = payload.next_review_at;
    result.metadata_sources.push({
      artifact_id: artifactId,
      producer_role: role,
      created_at: artifact.created_at ?? null,
      fields: Object.keys(payload).sort()
    });
  }

  return result;
}
