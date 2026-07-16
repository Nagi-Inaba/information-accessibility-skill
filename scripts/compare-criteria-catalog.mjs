import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function valuesEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function recordsById(catalog) {
  const records = Object.values(catalog.catalogs ?? {}).flat();
  const byId = new Map();
  for (const record of records) {
    if (!record?.id) throw new Error("Catalog requirement record is missing an id");
    if (byId.has(record.id)) throw new Error(`Duplicate catalog requirement id: ${record.id}`);
    byId.set(record.id, record);
  }
  return byId;
}

function sourcesById(catalog) {
  const byId = new Map();
  for (const source of catalog.sources ?? []) {
    if (!source?.id) throw new Error("Catalog source is missing an id");
    if (byId.has(source.id)) throw new Error(`Duplicate catalog source id: ${source.id}`);
    byId.set(source.id, source);
  }
  return byId;
}

export function compareCatalogs(current, candidate) {
  const currentSources = sourcesById(current);
  const candidateSources = sourcesById(candidate);
  const sourceIds = [...new Set([...currentSources.keys(), ...candidateSources.keys()])].sort();
  const sourceHashChanges = [];
  for (const sourceId of sourceIds) {
    const currentSha256 = currentSources.get(sourceId)?.source_sha256 ?? null;
    const candidateSha256 = candidateSources.get(sourceId)?.source_sha256 ?? null;
    if (currentSha256 !== candidateSha256) {
      sourceHashChanges.push({
        source_id: sourceId,
        current_sha256: currentSha256,
        candidate_sha256: candidateSha256
      });
    }
  }

  const currentRecords = recordsById(current);
  const candidateRecords = recordsById(candidate);
  const currentIds = [...currentRecords.keys()].sort();
  const candidateIds = [...candidateRecords.keys()].sort();
  const added = candidateIds.filter((id) => !currentRecords.has(id));
  const removed = currentIds.filter((id) => !candidateRecords.has(id));
  const changed = [];
  const routingChanges = [];

  for (const id of currentIds.filter((recordId) => candidateRecords.has(recordId))) {
    const currentRecord = currentRecords.get(id);
    const candidateRecord = candidateRecords.get(id);
    if (!valuesEqual(currentRecord.method_key, candidateRecord.method_key)) {
      routingChanges.push({
        id,
        current_method_key: currentRecord.method_key,
        candidate_method_key: candidateRecord.method_key
      });
    }

    const fields = [...new Set([...Object.keys(currentRecord), ...Object.keys(candidateRecord)])]
      .filter((field) => !["id", "method_key"].includes(field))
      .sort();
    const changes = fields
      .filter((field) => !valuesEqual(currentRecord[field], candidateRecord[field]))
      .map((field) => ({ field, current: currentRecord[field], candidate: candidateRecord[field] }));
    if (changes.length > 0) changed.push({ id, changes });
  }

  return {
    source_hash_changes: sourceHashChanges,
    requirement_changes: { added, removed, changed },
    routing_changes: routingChanges
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readCatalog(argument, name) {
  if (!argument) throw new Error(`${name} is required`);
  const catalogPath = path.resolve(process.cwd(), argument);
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function main() {
  const current = readCatalog(argumentValue("--current"), "--current");
  const candidate = readCatalog(argumentValue("--candidate"), "--candidate");
  console.log(JSON.stringify(compareCatalogs(current, candidate), null, 2));
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) main();
