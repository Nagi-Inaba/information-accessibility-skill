import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertNewOutputPath, assertStableFile, createAuditRun, readStableFile, writeNewJson } from "./lib/audit-run.mjs";
import { validateJsonSchema } from "./lib/json-schema.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigSchemaFile = path.join(
  path.dirname(scriptDirectory),
  "references",
  "audit-init-config.schema.json"
);
const undeclaredEnvironment = {
  os: ["not_declared"],
  browsers: [],
  assistive_technologies: [],
  input_modes: []
};

function parseArgs(argv) {
  const options = { targetRefs: [] };
  const repeatable = new Set(["--target-ref"]);
  const optional = new Set(["--supersedes-run", "--config"]);
  const map = new Map([
    ["--run-id", "runId"], ["--profile", "profile"], ["--target-name", "targetName"],
    ["--target-version", "targetVersion"], ["--target-ref", "targetRefs"],
    ["--artifact-root", "artifactRoot"], ["--network", "network"],
    ["--interaction", "interaction"], ["--source-write", "sourceWrite"], ["--supersedes-run", "supersedesRunFile"], ["--config", "configFile"], ["--output", "output"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!map.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (repeatable.has(arg)) options[map.get(arg)].push(value);
    else {
      if (options[map.get(arg)] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
      options[map.get(arg)] = value;
    }
    index += 1;
  }
  for (const [flag, key] of map) {
    if (!repeatable.has(flag) && !optional.has(flag) && options[key] === undefined) throw new Error(`${flag} is required`);
  }
  if (!options.targetRefs.length) throw new Error("--target-ref is required");
  return options;
}

function parseSnapshotJson(snapshot, label) {
  try {
    return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

export function loadAuditInitConfig(configFile, { schemaFile = defaultConfigSchemaFile } = {}) {
  const configSnapshot = readStableFile(configFile, { label: "audit initialization config" });
  const schemaSnapshot = readStableFile(schemaFile, { label: "audit initialization config schema" });
  const config = parseSnapshotJson(configSnapshot, "audit initialization config");
  const schema = parseSnapshotJson(schemaSnapshot, "audit initialization config schema");
  const errors = [];
  validateJsonSchema(config, schema, "$", errors);
  if (errors.length > 0) throw new Error(`Invalid audit initialization config:\n- ${errors.join("\n- ")}`);
  if (!config.scope && !config.environment) throw new Error("Audit initialization config must contain scope or environment.");
  return { config, configSnapshot, schemaSnapshot };
}

export function assertAuditInitConfigStable(loadedConfig) {
  assertStableFile(loadedConfig.configSnapshot, "audit initialization config");
  assertStableFile(loadedConfig.schemaSnapshot, "audit initialization config schema");
}

function isUndeclaredEnvironment(environment) {
  return Array.isArray(environment?.os)
    && environment.os.length === 1
    && environment.os[0] === "not_declared"
    && Array.isArray(environment.browsers)
    && environment.browsers.length === 0
    && Array.isArray(environment.assistive_technologies)
    && environment.assistive_technologies.length === 0
    && Array.isArray(environment.input_modes)
    && environment.input_modes.length === 0;
}

export function resolveAuditInitContext({ targetRefs, config = {}, predecessor } = {}) {
  const normalizedTargetRefs = [...new Set(targetRefs ?? [])].sort((left, right) => left.localeCompare(right, "en"));
  const scope = structuredClone(config.scope ?? predecessor?.scope ?? {
    included: normalizedTargetRefs,
    excluded: [],
    complete_processes: [],
    third_party_content: [],
    full_pages_reviewed: false
  });
  const environment = structuredClone(config.environment ?? predecessor?.environment ?? undeclaredEnvironment);
  const environmentDeclared = !isUndeclaredEnvironment(environment);
  return {
    scope,
    environment,
    environmentDeclared,
    limitations: environmentDeclared
      ? ["No profile outcome has been recorded."]
      : ["The environment was not declared; no profile outcome has been recorded."]
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const output = path.resolve(options.output);
  assertNewOutputPath(output);

  const loadedConfig = options.configFile ? loadAuditInitConfig(options.configFile) : undefined;
  let predecessor;
  if (options.supersedesRunFile) {
    const snapshot = readStableFile(options.supersedesRunFile, { label: "superseded audit run" });
    predecessor = {
      value: parseSnapshotJson(snapshot, "superseded audit run"),
      snapshot
    };
  }

  const context = resolveAuditInitContext({
    targetRefs: options.targetRefs,
    config: loadedConfig?.config,
    predecessor: predecessor?.value
  });
  const run = createAuditRun({
    ...options,
    runFile: output,
    supersedesRun: predecessor?.value,
    supersedesRunFile: predecessor?.snapshot.path,
    scope: context.scope,
    environment: context.environmentDeclared ? context.environment : undefined
  });

  if (predecessor) assertStableFile(predecessor.snapshot, "superseded audit run");
  if (loadedConfig) assertAuditInitConfigStable(loadedConfig);
  writeNewJson(output, run);
  process.stdout.write(`${JSON.stringify({ status: "PASS", run_id: run.run_id, output })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
