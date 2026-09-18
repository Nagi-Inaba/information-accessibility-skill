export function canonicalJson(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort((left, right) => left.localeCompare(right, "en")).map((key) => [key, normalize(item[key])]));
    }
    return item;
  }
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}
