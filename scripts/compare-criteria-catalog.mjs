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

function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function structuralCatalog(catalog) {
  const structural = {};
  for (const key of Object.keys(catalog)) {
    if (key === "verified_at") continue;
    if (key === "sources") {
      structural.sources = Object.fromEntries(
        [...sourcesById(catalog).entries()].sort(([left], [right]) => compareIds(left, right)).map(([id, source]) => {
          const stableSource = Object.fromEntries(
            Object.entries(source).filter(([field]) => field !== "source_sha256")
          );
          return [id, stableSource];
        })
      );
      continue;
    }
    if (key === "catalogs") {
      structural.catalogs = Object.fromEntries(
        Object.keys(catalog.catalogs).sort().map((catalogId) => [
          catalogId,
          Object.fromEntries(
            [...catalog.catalogs[catalogId]]
              .sort((left, right) => compareIds(left.id, right.id))
              .map((record) => [record.id, record])
          )
        ])
      );
      continue;
    }
    structural[key] = catalog[key];
  }
  return structural;
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function structuralState(present, value) {
  return present ? { present: true, value: canonicalize(value) } : { present: false };
}

function compareStructuralValues(current, candidate, pathPrefix = "", changes = []) {
  if (valuesEqual(current, candidate)) return changes;
  const currentIsObject = current !== null && typeof current === "object" && !Array.isArray(current);
  const candidateIsObject = candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  if (currentIsObject && candidateIsObject) {
    const fields = [...new Set([...Object.keys(current), ...Object.keys(candidate)])].sort();
    for (const field of fields) {
      const currentPresent = Object.hasOwn(current, field);
      const candidatePresent = Object.hasOwn(candidate, field);
      const path = `${pathPrefix}/${pointerSegment(field)}`;
      if (!currentPresent || !candidatePresent) {
        changes.push({
          path,
          current: structuralState(currentPresent, current[field]),
          candidate: structuralState(candidatePresent, candidate[field])
        });
      } else {
        compareStructuralValues(current[field], candidate[field], path, changes);
      }
    }
    return changes;
  }

  changes.push({
    path: pathPrefix || "/",
    current: structuralState(true, current),
    candidate: structuralState(true, candidate)
  });
  return changes;
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
    routing_changes: routingChanges,
    structural_changes: compareStructuralValues(structuralCatalog(current), structuralCatalog(candidate))
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
