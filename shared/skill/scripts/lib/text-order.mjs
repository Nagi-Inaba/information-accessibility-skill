// Deterministic string order shared by canonical output and registry checks.
export function compareText(left, right) {
  return left.localeCompare(right, "en");
}
