import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateJsonSchema } from "./json-schema.mjs";
import { sha256Bytes, parseJsonBytes } from "./safe-file-io.mjs";
import { validateOrchestrationRegistrySemantics } from "./orchestration-contracts.mjs";

export const defaultSkillRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function sha256NormalizedTextBytes(bytes) {
  return sha256Bytes(Buffer.from(bytes.toString("utf8").replace(/\r\n/gu, "\n"), "utf8"));
}

function readJson(relative, skillRoot) {
  const file = path.join(skillRoot, ...relative.split("/"));
  const bytes = fs.readFileSync(file);
  return { file, bytes, value: parseJsonBytes(bytes, relative) };
}

export function loadAuditResources(skillRoot = defaultSkillRoot) {
  const names = {
    standardsRegistry: "references/standards-registry.json",
    orchestrationRegistry: "references/orchestration-registry.json",
    orchestrationSchema: "references/orchestration-registry.schema.json",
    orchestrationRegistryV1: "references/orchestration-registry-1.0.0.json",
    orchestrationSchemaV1: "references/orchestration-registry-1.0.0.schema.json",
    orchestrationRegistryV2: "references/orchestration-registry-2.0.0.json",
    orchestrationSchemaV2: "references/orchestration-registry-2.0.0.schema.json",
    orchestrationRegistryV3: "references/orchestration-registry-3.0.0.json",
    orchestrationSchemaV3: "references/orchestration-registry-3.0.0.schema.json",
    orchestrationRegistryV4: "references/orchestration-registry-4.0.0.json",
    orchestrationSchemaV4: "references/orchestration-registry-4.0.0.schema.json",
    orchestrationRegistryV5: "references/orchestration-registry-5.0.0.json",
    orchestrationSchemaV5: "references/orchestration-registry-5.0.0.schema.json",
    orchestrationRegistryV6: "references/orchestration-registry-6.0.0.json",
    orchestrationSchemaV6: "references/orchestration-registry-6.0.0.schema.json",
    orchestrationRegistryV7: "references/orchestration-registry-7.0.0.json",
    orchestrationSchemaV7: "references/orchestration-registry-7.0.0.schema.json",
    orchestrationRegistryV8: "references/orchestration-registry-8.0.0.json",
    orchestrationSchemaV8: "references/orchestration-registry-8.0.0.schema.json",
    orchestrationRegistryV9: "references/orchestration-registry-9.0.0.json",
    orchestrationSchemaV9: "references/orchestration-registry-9.0.0.schema.json",
    orchestrationRegistryV10: "references/orchestration-registry-10.0.0.json",
    orchestrationSchemaV10: "references/orchestration-registry-10.0.0.schema.json",
    orchestrationRegistryV11: "references/orchestration-registry-11.0.0.json",
    orchestrationSchemaV11: "references/orchestration-registry-11.0.0.schema.json",
    orchestrationRegistryV12: "references/orchestration-registry-12.0.0.json",
    orchestrationSchemaV12: "references/orchestration-registry-12.0.0.schema.json",
    orchestrationRegistryV13: "references/orchestration-registry-13.0.0.json",
    orchestrationSchemaV13: "references/orchestration-registry-13.0.0.schema.json",
    orchestrationRegistryV14: "references/orchestration-registry-14.0.0.json",
    orchestrationSchemaV14: "references/orchestration-registry-14.0.0.schema.json",
    orchestrationRegistryV15: "references/orchestration-registry-15.0.0.json",
    orchestrationSchemaV15: "references/orchestration-registry-15.0.0.schema.json",
    orchestrationRegistryV16: "references/orchestration-registry-16.0.0.json",
    orchestrationSchemaV16: "references/orchestration-registry-16.0.0.schema.json",
    envelopeSchema: "references/audit-artifact-envelope.schema.json",
    envelopeSchemaV1: "references/audit-artifact-envelope-1.0.0.schema.json",
    envelopeSchemaV2: "references/audit-artifact-envelope-2.0.0.schema.json",
    envelopeSchemaV3: "references/audit-artifact-envelope-3.0.0.schema.json",
    assessmentSchema: "references/assessment-record.schema.json",
    criteriaCatalog: "references/criteria-catalog.json",
    criterionProcedures: "references/criterion-procedures.json",
    auditMethods: "references/web-audit-methods.json"
  };
  const loaded = Object.fromEntries(Object.entries(names).map(([key, relative]) => [key, readJson(relative, skillRoot)]));
  for (const [label, registry, schema] of [
    ["installed", loaded.orchestrationRegistry, loaded.orchestrationSchema],
    ["frozen 1.0.0", loaded.orchestrationRegistryV1, loaded.orchestrationSchemaV1],
    ["frozen 2.0.0", loaded.orchestrationRegistryV2, loaded.orchestrationSchemaV2],
    ["frozen 3.0.0", loaded.orchestrationRegistryV3, loaded.orchestrationSchemaV3],
    ["frozen 4.0.0", loaded.orchestrationRegistryV4, loaded.orchestrationSchemaV4],
    ["frozen 5.0.0", loaded.orchestrationRegistryV5, loaded.orchestrationSchemaV5],
    ["frozen 6.0.0", loaded.orchestrationRegistryV6, loaded.orchestrationSchemaV6],
    ["frozen 7.0.0", loaded.orchestrationRegistryV7, loaded.orchestrationSchemaV7],
    ["frozen 8.0.0", loaded.orchestrationRegistryV8, loaded.orchestrationSchemaV8],
    ["frozen 9.0.0", loaded.orchestrationRegistryV9, loaded.orchestrationSchemaV9],
    ["frozen 10.0.0", loaded.orchestrationRegistryV10, loaded.orchestrationSchemaV10],
    ["frozen 11.0.0", loaded.orchestrationRegistryV11, loaded.orchestrationSchemaV11],
    ["frozen 12.0.0", loaded.orchestrationRegistryV12, loaded.orchestrationSchemaV12],
    ["frozen 13.0.0", loaded.orchestrationRegistryV13, loaded.orchestrationSchemaV13],
    ["frozen 14.0.0", loaded.orchestrationRegistryV14, loaded.orchestrationSchemaV14],
    ["frozen 15.0.0", loaded.orchestrationRegistryV15, loaded.orchestrationSchemaV15],
    ["frozen 16.0.0", loaded.orchestrationRegistryV16, loaded.orchestrationSchemaV16]
  ]) {
    const registryErrors = [];
    validateJsonSchema(registry.value, schema.value, "$", registryErrors);
    if (registryErrors.length) throw new Error(`Invalid ${label} orchestration registry:\n- ${registryErrors.join("\n- ")}`);
  }
  const semanticErrors = validateOrchestrationRegistrySemantics(
    loaded.orchestrationRegistry.value,
    loaded.orchestrationRegistryV4.value
  );
  if (semanticErrors.length) throw new Error(`Invalid installed orchestration registry semantics:\n- ${semanticErrors.join("\n- ")}`);
  const schemaManifests = new Map();
  const artifactTypeIds = new Set();
  const schemaFiles = new Set();
  const optionalFixerTypes = new Set(["fix-authorization", "fix-handoff", "change-record"]);
  const optionalFixerFiles = loaded.orchestrationRegistry.value.artifact_types
    .filter((manifest) => optionalFixerTypes.has(manifest.id))
    .flatMap((manifest) => manifest.schema_versions.map((entry) => entry.schema_file));
  const installedFixerFiles = optionalFixerFiles.filter((file) => fs.existsSync(path.join(skillRoot, "references", file)));
  if (installedFixerFiles.length !== 0 && installedFixerFiles.length !== optionalFixerFiles.length) {
    throw new Error("Incomplete authorized fixer schema installation.");
  }
  const hasAuthorizedFixer = installedFixerFiles.length === optionalFixerFiles.length;
  for (const manifest of loaded.orchestrationRegistry.value.artifact_types) {
    if (artifactTypeIds.has(manifest.id)) throw new Error(`Duplicate artifact type manifest: ${manifest.id}`);
    artifactTypeIds.add(manifest.id);
    if (!hasAuthorizedFixer && optionalFixerTypes.has(manifest.id)) continue;
    const schemas = new Map();
    const currentEntries = manifest.schema_versions.filter((entry) => entry.mode === "current");
    if (currentEntries.length !== 1 || currentEntries[0].version !== manifest.latest_schema_version) {
      throw new Error(`Artifact type ${manifest.id} must have exactly one current schema matching latest_schema_version.`);
    }
    for (const entry of manifest.schema_versions) {
      if (schemas.has(entry.version)) throw new Error(`Duplicate schema version ${entry.version} for artifact type ${manifest.id}.`);
      if (schemaFiles.has(entry.schema_file)) throw new Error(`Duplicate schema file reference in orchestration registry: ${entry.schema_file}.`);
      schemaFiles.add(entry.schema_file);
      const schemaRecord = readJson(`references/${entry.schema_file}`, skillRoot);
      const schema = schemaRecord.value;
      if (entry.mode === "current" && !entry.schema_sha256) {
        throw new Error(`Current schema manifest requires schema_sha256 for ${manifest.id} ${entry.version}: ${entry.schema_file}.`);
      }
      if (entry.schema_sha256 && sha256NormalizedTextBytes(schemaRecord.bytes) !== entry.schema_sha256) {
        throw new Error(`Schema SHA-256 mismatch for ${manifest.id} ${entry.version}: ${entry.schema_file}.`);
      }
      if (schema?.properties?.schema_version?.const !== entry.version) {
        throw new Error(`Schema manifest version mismatch for ${manifest.id} ${entry.version}: ${entry.schema_file}.`);
      }
      const expectedSchemaId = `urn:information-accessibility:${manifest.id}:${entry.version}`;
      if (schema?.$id !== expectedSchemaId) {
        throw new Error(`Schema $id must match artifact type and version ${expectedSchemaId}: ${entry.schema_file}.`);
      }
      schemas.set(entry.version, { ...entry, schema });
    }
    schemaManifests.set(manifest.id, { ...manifest, schemas });
  }
  const auditRunManifest = schemaManifests.get("audit-run");
  if (!auditRunManifest) throw new Error("The orchestration registry does not declare the audit-run schema manifest.");
  const auditRunSchemas = new Map([...auditRunManifest.schemas].map(([version, entry]) => [version, entry.schema]));
  const auditRunSchema = auditRunSchemas.get(auditRunManifest.latest_schema_version);
  const payloadSchemas = new Map([...schemaManifests]
    .filter(([artifactType]) => artifactType !== "audit-run")
    .map(([artifactType, manifest]) => [
      artifactType,
      new Map([...manifest.schemas].map(([version, entry]) => [version, entry.schema]))
    ]));
  function payloadVersionsForRegistry(registry) {
    return new Map(registry.value.artifact_types
      .filter((artifactType) => artifactType.id !== "audit-run" && (hasAuthorizedFixer || !optionalFixerTypes.has(artifactType.id)))
      .map((artifactType) => {
        // Registry 1 predates versioned manifests; every schema it published was 1.0.0.
        const version = artifactType.latest_schema_version ?? "1.0.0";
        if (!payloadSchemas.get(artifactType.id)?.has(version)) {
          throw new Error(`Orchestration registry ${registry.value.schema_version} requires missing ${artifactType.id} payload schema ${version}.`);
        }
        return [artifactType.id, version];
      }));
  }
  const registryFiles = [
    loaded.orchestrationRegistryV1,
    loaded.orchestrationRegistryV2,
    loaded.orchestrationRegistryV3,
    loaded.orchestrationRegistryV4,
    loaded.orchestrationRegistryV5,
    loaded.orchestrationRegistryV6,
    loaded.orchestrationRegistryV7,
    loaded.orchestrationRegistryV8,
    loaded.orchestrationRegistryV9,
    loaded.orchestrationRegistryV10,
    loaded.orchestrationRegistryV11,
    loaded.orchestrationRegistryV12,
    loaded.orchestrationRegistryV13,
    loaded.orchestrationRegistryV14,
    loaded.orchestrationRegistryV15,
    loaded.orchestrationRegistryV16,
    loaded.orchestrationRegistry
  ];
  const orchestrationRegistries = new Map(registryFiles.map((registry) => [
    registry.value.schema_version,
    {
      value: registry.value,
      sha256: sha256Bytes(registry.bytes),
      payloadVersions: payloadVersionsForRegistry(registry)
    }
  ]));
  const currentPayloadVersions = orchestrationRegistries.get(loaded.orchestrationRegistry.value.schema_version).payloadVersions;
  const envelopeSchemas = new Map([
    ["1.0.0", loaded.envelopeSchemaV1.value],
    ["2.0.0", loaded.envelopeSchemaV2.value],
    ["3.0.0", loaded.envelopeSchemaV3.value],
    ["4.0.0", loaded.envelopeSchema.value]
  ]);
  return {
    skillRoot,
    standardsRegistry: loaded.standardsRegistry.value,
    orchestrationRegistry: loaded.orchestrationRegistry.value,
    schemaManifests,
    auditRunSchema,
    auditRunSchemas,
    envelopeSchema: loaded.envelopeSchema.value,
    envelopeSchemas,
    assessmentSchema: loaded.assessmentSchema.value,
    criteriaCatalog: loaded.criteriaCatalog.value,
    criterionProcedures: loaded.criterionProcedures.value,
    auditMethods: loaded.auditMethods.value,
    payloadSchemas,
    currentPayloadVersions,
    orchestrationRegistries,
    resourceVersions: {
      standards_registry_version: loaded.standardsRegistry.value.schema_version,
      orchestration_registry_version: loaded.orchestrationRegistry.value.schema_version,
      orchestration_registry_sha256: sha256Bytes(loaded.orchestrationRegistry.bytes),
      criteria_catalog_sha256: sha256Bytes(loaded.criteriaCatalog.bytes),
      criterion_procedures_sha256: sha256Bytes(loaded.criterionProcedures.bytes),
      audit_methods_sha256: sha256Bytes(loaded.auditMethods.bytes)
    }
  };
}
