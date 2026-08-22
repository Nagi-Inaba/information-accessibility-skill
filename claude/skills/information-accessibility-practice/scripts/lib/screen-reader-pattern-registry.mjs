function unique(values) {
  return [...new Set(values)];
}

export function validateScreenReaderPatterns(registry) {
  const errors = [];
  if (!registry || !Array.isArray(registry.patterns)) return ["registry.patterns must be an array"];
  const ids = registry.patterns.map((pattern) => pattern?.id);
  if (ids.some((id) => typeof id !== "string" || !id)) errors.push("Every pattern requires a non-empty id");
  if (unique(ids).length !== ids.length) errors.push("Pattern ids must be unique");
  for (const pattern of registry.patterns) {
    if (typeof pattern?.title !== "string" || !pattern.title) errors.push(`${String(pattern?.id)} requires title`);
    if (!Array.isArray(pattern?.checks) || pattern.checks.length === 0) errors.push(`${String(pattern?.id)} requires checks`);
    if (!Array.isArray(pattern?.source_urls) || pattern.source_urls.length === 0) errors.push(`${String(pattern?.id)} requires source_urls`);
  }
  return errors;
}

export function discoverScreenReaderPatterns(registry) {
  const errors = validateScreenReaderPatterns(registry);
  if (errors.length) throw new Error(`Invalid screen-reader pattern registry:\n- ${errors.join("\n- ")}`);
  return {
    ids: registry.patterns.map((pattern) => pattern.id),
    categories: unique(registry.patterns.map((pattern) => pattern.category ?? "uncategorized")).sort(),
    sources: unique(registry.patterns.flatMap((pattern) => pattern.source_urls))
  };
}

export function selectScreenReaderPatterns(registry, selector = "all") {
  discoverScreenReaderPatterns(registry);
  if (selector === "all") return structuredClone(registry.patterns);
  if (selector.startsWith("category:")) {
    const category = selector.slice("category:".length);
    const selected = registry.patterns.filter((pattern) => (pattern.category ?? "uncategorized") === category);
    if (!selected.length) throw new Error(`Unknown screen-reader pattern category: ${category}`);
    return structuredClone(selected);
  }
  const selected = registry.patterns.filter((pattern) => pattern.id === selector);
  if (!selected.length) throw new Error(`Unknown screen-reader pattern: ${selector}`);
  return structuredClone(selected);
}
