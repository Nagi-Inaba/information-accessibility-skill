// Explicit legacy fixtures preserve coverage of pre-provenance assessments.
// Never use this helper for new-format provenance or authentication tests.
export function legacyAssessment(record) {
  const legacy = structuredClone(record);
  legacy.schema_version = "1.0.0";
  delete legacy.assessment.assessment_id;
  delete legacy.assessment.human_review_records;
  for (const row of legacy.assessment.results ?? []) {
    if (row.mapping_status === "human_declared") row.mapping_status = "human_verified";
    delete row.review_record_sha256;
  }
  return legacy;
}
