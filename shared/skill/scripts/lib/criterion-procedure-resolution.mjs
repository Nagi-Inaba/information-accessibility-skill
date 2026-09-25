// Reuse a WCAG procedure only through an explicit catalog equivalence.
export function resolveCriterionProcedure(record, catalog) {
  const procedures = catalog.procedures;
  const direct = procedures.find((item) => item.requirement_id === record.id);
  const equivalentId = record.web_modern_record_id ?? record.wcag_record_id;
  const equivalent = !direct && equivalentId
    ? procedures.find((item) => item.requirement_id === equivalentId)
    : null;
  const procedure = direct ?? equivalent ?? null;
  const officialSources = direct
    ? direct.primary_sources
    : equivalent
      ? [...new Set([...(record.official_method_sources ?? []), ...equivalent.primary_sources])]
      : record.official_method_sources ?? [];
  return { procedure, officialSources };
}
