import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const agentPrefix = "information-accessibility-";
const excludedSkillFiles = new Set(["agents/openai.yaml"]);
const supportedSchemaKeywords = new Set([
  "$schema", "$id", "title", "description", "type", "additionalProperties", "required",
  "properties", "const", "enum", "minItems", "uniqueItems", "items", "minLength", "pattern"
]);
const supportedSchemaTypes = new Set(["object", "array", "string", "boolean", "number", "integer", "null"]);
const reservedWindowsBasename = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/iu;

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function pathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithin(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function inspectComponent(target, label) {
  const stats = fs.lstatSync(target);
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe ${label}: symbolic link or reparse point at ${target}`);
  }
  const real = fs.realpathSync.native(target);
  if (pathKey(real) !== pathKey(target)) {
    throw new Error(`Unsafe ${label}: reparse traversal from ${target} to ${real}`);
  }
  return stats;
}

function inspectConfinedPath(declaredRoot, target, { mustExist = false, expectedType, label = "path" } = {}) {
  const root = path.resolve(declaredRoot);
  const resolved = path.resolve(target);
  if (!isWithin(root, resolved)) throw new Error(`Unsafe ${label}: ${resolved} escapes declared root ${root}`);

  let current = root;
  let stats = lstatIfPresent(current);
  let missing = !stats;
  if (stats) stats = inspectComponent(current, label);
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (missing) continue;
    stats = lstatIfPresent(current);
    if (!stats) {
      missing = true;
      continue;
    }
    stats = inspectComponent(current, label);
  }

  if (mustExist && missing) throw new Error(`Missing ${label}: ${resolved}`);
  if (!missing && expectedType === "file" && !stats.isFile()) throw new Error(`Expected file for ${label}: ${resolved}`);
  if (!missing && expectedType === "directory" && !stats.isDirectory()) throw new Error(`Expected directory for ${label}: ${resolved}`);
  return { path: resolved, exists: !missing, stats };
}

function inspectDeclaredRoot(packageRoot, declaredRoot, label) {
  return inspectConfinedPath(packageRoot, declaredRoot, { mustExist: true, expectedType: "directory", label });
}

function readConfinedFile(declaredRoot, file, encoding, label) {
  inspectConfinedPath(declaredRoot, file, { mustExist: true, expectedType: "file", label });
  return fs.readFileSync(file, encoding);
}

function readConfinedDirectory(declaredRoot, directory, label) {
  inspectConfinedPath(declaredRoot, directory, { mustExist: true, expectedType: "directory", label });
  return fs.readdirSync(directory, { withFileTypes: true });
}

function walkConfined(declaredRoot, current = declaredRoot) {
  return readConfinedDirectory(declaredRoot, current, "distribution directory").flatMap((entry) => {
    const full = path.join(current, entry.name);
    const inspected = inspectConfinedPath(declaredRoot, full, { mustExist: true, label: "distribution entry" });
    return inspected.stats.isDirectory()
      ? walkConfined(declaredRoot, full)
      : [toPosix(path.relative(declaredRoot, full))];
  }).sort();
}

function readJsonConfined(declaredRoot, file, label) {
  return JSON.parse(readConfinedFile(declaredRoot, file, "utf8", label).replace(/^\uFEFF/u, ""));
}

function jsonType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasUnpairedUtf16Surrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function validateUnicodeScalars(value, location, errors) {
  if (typeof value === "string") {
    if (hasUnpairedUtf16Surrogate(value)) errors.push(`${location} contains an unpaired UTF-16 surrogate.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateUnicodeScalars(item, `${location}[${index}]`, errors));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) validateUnicodeScalars(item, `${location}.${key}`, errors);
  }
}

function validateSchemaDefinition(schema, location, errors) {
  if (!isPlainObject(schema)) {
    errors.push(`Invalid manifest schema at ${location}: schema must be an object.`);
    return;
  }
  for (const keyword of Object.keys(schema)) {
    if (!supportedSchemaKeywords.has(keyword)) errors.push(`Invalid manifest schema at ${location}: unsupported keyword ${keyword}.`);
  }
  if (schema.type !== undefined && (typeof schema.type !== "string" || !supportedSchemaTypes.has(schema.type))) {
    errors.push(`Invalid manifest schema at ${location}.type: unsupported schema type.`);
  }
  for (const keyword of ["$schema", "$id", "title", "description", "pattern"]) {
    if (schema[keyword] !== undefined && typeof schema[keyword] !== "string") {
      errors.push(`Invalid manifest schema at ${location}.${keyword}: expected a string.`);
    }
  }
  if (typeof schema.pattern === "string") {
    try {
      new RegExp(schema.pattern, "u");
    } catch (error) {
      errors.push(`Invalid manifest schema at ${location}.pattern: ${error.message}`);
    }
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    errors.push(`Invalid manifest schema at ${location}.additionalProperties: expected a boolean.`);
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string"))) {
    errors.push(`Invalid manifest schema at ${location}.required: expected an array of strings.`);
  }
  if (Array.isArray(schema.required) && new Set(schema.required).size !== schema.required.length) {
    errors.push(`Invalid manifest schema at ${location}.required: values must be unique.`);
  }
  if (schema.properties !== undefined && !isPlainObject(schema.properties)) {
    errors.push(`Invalid manifest schema at ${location}.properties: expected an object.`);
  } else {
    for (const [name, child] of Object.entries(schema.properties ?? {})) validateSchemaDefinition(child, `${location}.properties.${name}`, errors);
  }
  if (schema.items !== undefined) validateSchemaDefinition(schema.items, `${location}.items`, errors);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    errors.push(`Invalid manifest schema at ${location}.enum: expected a non-empty array.`);
  }
  for (const keyword of ["minItems", "minLength"]) {
    if (schema[keyword] !== undefined && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      errors.push(`Invalid manifest schema at ${location}.${keyword}: expected a non-negative integer.`);
    }
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== "boolean") {
    errors.push(`Invalid manifest schema at ${location}.uniqueItems: expected a boolean.`);
  }
}

function validateManifestSchemaContract(schema, errors) {
  const agents = schema?.properties?.agents;
  const agent = agents?.items;
  const codex = agent?.properties?.codex;
  const claude = agent?.properties?.claude;
  const requiredAgentFields = ["id", "description", "install_by_default", "body_file", "codex", "claude"];
  const contractChecks = [
    [schema?.type === "object", "root type must be object"],
    [schema?.additionalProperties === false, "root must reject additional properties"],
    [["schema_version", "agents"].every((field) => schema?.required?.includes(field)), "root must require schema_version and agents"],
    [schema?.properties?.schema_version?.const === "1.0.0", "schema_version must be fixed at 1.0.0"],
    [agents?.type === "array" && Number.isInteger(agents?.minItems) && agents.minItems >= 1, "agents must be a non-empty array"],
    [agent?.type === "object" && agent?.additionalProperties === false, "agent entries must be closed objects"],
    [requiredAgentFields.every((field) => agent?.required?.includes(field)), "agent entries must require every distribution field"],
    [agent?.properties?.id?.type === "string" && typeof agent?.properties?.id?.pattern === "string", "agent id must be a constrained string"],
    [agent?.properties?.description?.type === "string", "agent description must be a string"],
    [agent?.properties?.install_by_default?.type === "boolean", "install_by_default must be a boolean"],
    [agent?.properties?.body_file?.type === "string" && typeof agent?.properties?.body_file?.pattern === "string", "body_file must be a constrained string"],
    [codex?.type === "object" && codex?.additionalProperties === false && codex?.required?.includes("model_reasoning_effort") && codex?.properties?.model_reasoning_effort?.type === "string", "codex metadata must require model_reasoning_effort"],
    [codex?.properties?.sandbox_mode?.type === "string" && codex?.properties?.sandbox_mode?.enum?.includes("read-only"), "codex metadata must support an optional read-only sandbox_mode"],
    [claude?.type === "object" && claude?.additionalProperties === false && ["tools", "model", "effort"].every((field) => claude?.required?.includes(field)), "claude metadata must require tools, model, and effort"],
    [claude?.properties?.tools?.type === "array" && claude?.properties?.tools?.items?.type === "string", "claude tools must be an array of strings"],
    [claude?.properties?.model?.type === "string" && claude?.properties?.effort?.type === "string", "claude model and effort must be strings"]
  ];
  for (const [valid, message] of contractChecks) {
    if (!valid) errors.push(`Invalid manifest schema contract: ${message}.`);
  }
}

function validateAgainstSchema(value, schema, location, errors) {
  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    errors.push(`${location} must equal ${JSON.stringify(schema.const)}.`);
    return;
  }
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${location} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}.`);
    return;
  }
  const actualType = jsonType(value);
  const typeMatches = schema.type === "number" ? ["number", "integer"].includes(actualType) : !schema.type || actualType === schema.type;
  if (!typeMatches) {
    errors.push(`${location} must be a ${schema.type}.`);
    return;
  }

  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}.${key} is required.`);
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${location}.${key} is not allowed.`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateAgainstSchema(value[key], childSchema, `${location}.${key}`, errors);
    }
  }

  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location} must contain at least ${schema.minItems} item(s).`);
    }
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) errors.push(`${location} must contain unique items.`);
    }
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(item, schema.items, `${location}[${index}]`, errors));
  }

  if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location} must contain at least ${schema.minLength} character(s).`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${location} does not match ${schema.pattern}.`);
  }
}

function withoutFinalLineEnding(text) {
  return text.replace(/(?:\r\n|\r|\n)$/u, "");
}

export function normalizeAgentBody(text) {
  return withoutFinalLineEnding(text).replace(/\r\n?/gu, "\n");
}

function sourceLineEnding(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function escapedJsonString(value) {
  return JSON.stringify(value).replace(/[\u007F-\u009F]/gu, (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0").toUpperCase()}`);
}

function renderCodexAgent(agent, body) {
  const eol = sourceLineEnding(body);
  const lines = [
    `description = ${escapedJsonString(agent.description)}`,
    `developer_instructions = ${escapedJsonString(withoutFinalLineEnding(body))}`,
    `model_reasoning_effort = ${escapedJsonString(agent.codex.model_reasoning_effort)}`
  ];
  if (agent.codex.sandbox_mode !== undefined) {
    lines.push(`sandbox_mode = ${escapedJsonString(agent.codex.sandbox_mode)}`);
  }
  lines.push(`name = ${escapedJsonString(agent.id)}`, "");
  return lines.join(eol);
}

function renderClaudeAgent(agent, body) {
  const eol = sourceLineEnding(body);
  return [
    "---",
    `name: ${escapedJsonString(agent.id)}`,
    `description: ${escapedJsonString(agent.description)}`,
    `tools: [${agent.claude.tools.map(escapedJsonString).join(",")}]`,
    `model: ${escapedJsonString(agent.claude.model)}`,
    `effort: ${escapedJsonString(agent.claude.effort)}`,
    "---",
    "",
    withoutFinalLineEnding(body),
    ""
  ].join(eol);
}

export function extractCodexBody(text) {
  const match = text.match(/^developer_instructions = (?<body>"(?:\\.|[^"\\])*")\r?$/mu);
  if (!match?.groups?.body) return undefined;
  try {
    return JSON.parse(match.groups.body);
  } catch {
    return undefined;
  }
}

export function extractClaudeBody(text) {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n(?<body>[\s\S]*)$/u);
  return match?.groups?.body === undefined ? undefined : withoutFinalLineEnding(match.groups.body);
}

function generatedContentEquals(item, actual) {
  if (actual.equals(item.expected)) return true;
  if (item.platform !== "codex") return false;
  const actualText = actual.toString("utf8");
  const expectedText = item.expected.toString("utf8");
  const actualBody = extractCodexBody(actualText);
  const expectedBody = extractCodexBody(expectedText);
  if (actualBody === undefined || expectedBody === undefined || normalizeAgentBody(actualBody) !== normalizeAgentBody(expectedBody)) return false;
  const withoutBody = (text) => text.replace(/^developer_instructions = "(?:\\.|[^"\\])*"\r?$/mu, "developer_instructions = \"<normalized-body>\"");
  return withoutBody(actualText) === withoutBody(expectedText);
}

function isSafeOutputName(name) {
  return typeof name === "string" && path.basename(name) === name && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";
}

function isReservedWindowsName(name) {
  return reservedWindowsBasename.test(path.parse(name).name);
}

function validationFailure(errors, sharedSkillFiles = []) {
  return {
    status: "FAIL",
    errors,
    manifest: { agents: [] },
    bodies: new Map(),
    roots: {},
    sharedSkillFiles,
    shared_skill_files: sharedSkillFiles.length
  };
}

export function validateDistribution(root) {
  const errors = [];
  const packageRoot = path.resolve(root);
  const roots = {
    packageRoot,
    sharedAgents: path.join(packageRoot, "shared", "agents"),
    codexAgents: path.join(packageRoot, "codex", "agents"),
    claudeAgents: path.join(packageRoot, "claude", "agents"),
    codexSkill: path.join(packageRoot, "codex", "skills", "information-accessibility-practice"),
    claudeSkill: path.join(packageRoot, "claude", "skills", "information-accessibility-practice")
  };

  try {
    inspectConfinedPath(packageRoot, packageRoot, { mustExist: true, expectedType: "directory", label: "package root" });
    for (const [name, declaredRoot] of Object.entries(roots).filter(([name]) => name !== "packageRoot")) {
      inspectDeclaredRoot(packageRoot, declaredRoot, name);
    }
  } catch (error) {
    return validationFailure([error.message]);
  }

  let manifest;
  let schema;
  try {
    manifest = readJsonConfined(roots.sharedAgents, path.join(roots.sharedAgents, "agent-manifest.json"), "agent manifest");
    schema = readJsonConfined(roots.sharedAgents, path.join(roots.sharedAgents, "agent-manifest.schema.json"), "agent manifest schema");
  } catch (error) {
    return validationFailure([`Could not read distribution manifest or schema: ${error.message}`]);
  }

  const schemaErrors = [];
  validateSchemaDefinition(schema, "$schema", schemaErrors);
  validateManifestSchemaContract(schema, schemaErrors);
  errors.push(...schemaErrors);
  if (!schemaErrors.length) validateAgainstSchema(manifest, schema, "$", errors);
  validateUnicodeScalars(manifest, "$", errors);

  const agents = Array.isArray(manifest?.agents) ? manifest.agents : [];
  if (agents.length === 0) errors.push("Manifest must contain at least 1 agent.");
  const ids = new Set();
  const bodyFiles = new Set();
  const bodies = new Map();
  for (const agent of agents) {
    if (!isPlainObject(agent)) continue;
    if (typeof agent.id === "string") {
      if (ids.has(agent.id)) errors.push(`Duplicate agent id: ${agent.id}`);
      ids.add(agent.id);
      if (!isSafeOutputName(agent.id)) errors.push(`Unsafe agent output name: ${agent.id}`);
      if (isReservedWindowsName(agent.id)) errors.push(`Agent id uses a reserved Windows device name: ${agent.id}`);
    }
    if (typeof agent.body_file === "string") {
      if (bodyFiles.has(agent.body_file)) errors.push(`Duplicate agent body file: ${agent.body_file}`);
      bodyFiles.add(agent.body_file);
      if (!isSafeOutputName(agent.body_file)) errors.push(`Unsafe agent body file: ${agent.body_file}`);
      if (isReservedWindowsName(agent.body_file)) errors.push(`Agent body file uses a reserved Windows device name: ${agent.body_file}`);
    }

    if (typeof agent.id !== "string" || typeof agent.body_file !== "string" || !isSafeOutputName(agent.body_file) || isReservedWindowsName(agent.body_file)) continue;
    const bodyPath = path.join(roots.sharedAgents, agent.body_file);
    try {
      const body = readConfinedFile(roots.sharedAgents, bodyPath, "utf8", `agent body ${agent.body_file}`);
      if (body.startsWith("\uFEFF")) errors.push(`Agent body must be UTF-8 without a BOM: ${agent.body_file}`);
      if (hasUnpairedUtf16Surrogate(body)) errors.push(`Agent body ${agent.body_file} contains an unpaired UTF-16 surrogate.`);
      bodies.set(agent.id, body);
    } catch (error) {
      errors.push(error.message.startsWith("Missing ") ? `Missing agent body: ${agent.body_file}` : error.message);
    }

    if (isSafeOutputName(agent.id) && !isReservedWindowsName(agent.id)) {
      for (const [declaredRoot, extension] of [[roots.codexAgents, ".toml"], [roots.claudeAgents, ".md"]]) {
        try {
          inspectConfinedPath(declaredRoot, path.join(declaredRoot, `${agent.id}${extension}`), { label: "generated agent target" });
        } catch (error) {
          errors.push(error.message);
        }
      }
    }
  }

  for (const [declaredRoot, extension] of [[roots.codexAgents, ".toml"], [roots.claudeAgents, ".md"]]) {
    const allowed = new Set(agents.filter((agent) => typeof agent?.id === "string").map((agent) => `${agent.id}${extension}`));
    try {
      for (const entry of readConfinedDirectory(declaredRoot, declaredRoot, "agent distribution directory")) {
        const full = path.join(declaredRoot, entry.name);
        const inspected = inspectConfinedPath(declaredRoot, full, { mustExist: true, label: "agent distribution entry" });
        if (inspected.stats.isFile() && entry.name.startsWith(agentPrefix) && !allowed.has(entry.name)) {
          errors.push(`Undeclared generated agent file: ${toPosix(path.relative(packageRoot, full))}`);
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  let sharedSkillFiles = [];
  try {
    sharedSkillFiles = walkConfined(roots.codexSkill).filter((file) => !excludedSkillFiles.has(file));
    const sharedSkillFileSet = new Set(sharedSkillFiles);
    for (const relative of walkConfined(roots.claudeSkill)) {
      if (!sharedSkillFileSet.has(relative)) errors.push(`Undeclared Claude skill mirror file: ${relative}`);
    }
    for (const relative of sharedSkillFiles) {
      inspectConfinedPath(roots.claudeSkill, path.join(roots.claudeSkill, ...relative.split("/")), { label: "Claude skill mirror target" });
    }
  } catch (error) {
    errors.push(error.message);
  }

  return {
    status: errors.length ? "FAIL" : "PASS",
    errors,
    manifest,
    bodies,
    roots,
    sharedSkillFiles,
    shared_skill_files: sharedSkillFiles.length
  };
}

function buildFailure(validation, errors = validation.errors) {
  const agents = [];
  return {
    status: "FAIL",
    changed: [],
    agents,
    default_agent_count: Array.isArray(validation.manifest?.agents)
      ? validation.manifest.agents.filter((agent) => agent?.install_by_default).length
      : 0,
    shared_skill_files: validation.shared_skill_files ?? 0,
    errors
  };
}

function capturePathIdentity(target, label, expectedType) {
  const stats = fs.lstatSync(target, { bigint: true });
  if (stats.isSymbolicLink()) throw new Error(`Unsafe ${label}: symbolic link or reparse point at ${target}`);
  if (expectedType === "file" && !stats.isFile()) throw new Error(`Expected file for ${label}: ${target}`);
  if (expectedType === "directory" && !stats.isDirectory()) throw new Error(`Expected directory for ${label}: ${target}`);
  const real = fs.realpathSync.native(target);
  if (pathKey(real) !== pathKey(target)) throw new Error(`Unsafe ${label}: reparse traversal from ${target} to ${real}`);
  return {
    real: pathKey(real),
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other"
  };
}

function identitiesEqual(left, right) {
  return left.real === right.real
    && left.device === right.device
    && left.inode === right.inode
    && left.type === right.type;
}

function assertPathIdentity(target, expected, label, expectedType) {
  let actual;
  try {
    actual = capturePathIdentity(target, label, expectedType);
  } catch (error) {
    throw new Error(`${label} identity changed: ${error.message}`);
  }
  if (!identitiesEqual(actual, expected)) throw new Error(`${label} identity changed: ${target}`);
  return actual;
}

function ensureTransactionParent(item, createdDirectories, createdKeys) {
  const parent = path.dirname(item.target);
  const relative = path.relative(item.declaredRoot, parent);
  if (relative === "") return;
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Generated parent escapes declared root: ${parent}`);
  }

  let current = item.declaredRoot;
  inspectConfinedPath(item.declaredRoot, current, { mustExist: true, expectedType: "directory", label: "generated root" });
  for (const part of relative.split(path.sep).filter(Boolean)) {
    const currentIdentity = capturePathIdentity(current, "generated parent", "directory");
    const child = path.join(current, part);
    const inspected = inspectConfinedPath(item.declaredRoot, child, { label: "generated parent" });
    if (!inspected.exists) {
      assertPathIdentity(current, currentIdentity, "generated parent", "directory");
      fs.mkdirSync(child);
      assertPathIdentity(current, currentIdentity, "generated parent", "directory");
      inspectConfinedPath(item.declaredRoot, child, { mustExist: true, expectedType: "directory", label: "generated parent" });
      const key = pathKey(child);
      if (!createdKeys.has(key)) {
        createdKeys.add(key);
        createdDirectories.push({ path: child, identity: capturePathIdentity(child, "created generated parent", "directory") });
      }
    } else if (!inspected.stats.isDirectory()) {
      throw new Error(`Expected generated parent directory: ${child}`);
    }
    current = child;
  }
}

function captureTransactionEntry(relative, item) {
  const parent = path.dirname(item.target);
  inspectConfinedPath(item.declaredRoot, parent, { mustExist: true, expectedType: "directory", label: `generated parent ${relative}` });
  const parentIdentity = capturePathIdentity(parent, `generated parent ${relative}`, "directory");
  const inspected = inspectConfinedPath(item.declaredRoot, item.target, { label: `generated target ${relative}` });
  if (!inspected.exists) {
    return { relative, ...item, parent, parentIdentity, originalExists: false, original: undefined, targetIdentity: undefined };
  }
  const targetIdentity = capturePathIdentity(item.target, `generated target ${relative}`, "file");
  const original = readConfinedFile(item.declaredRoot, item.target, undefined, `generated target ${relative}`);
  assertPathIdentity(item.target, targetIdentity, `generated target ${relative}`, "file");
  return { relative, ...item, parent, parentIdentity, originalExists: true, original, targetIdentity };
}

function assertOriginalTransactionState(entry) {
  inspectConfinedPath(entry.declaredRoot, entry.parent, { mustExist: true, expectedType: "directory", label: `generated parent ${entry.relative}` });
  assertPathIdentity(entry.parent, entry.parentIdentity, `generated parent ${entry.relative}`, "directory");
  const inspected = inspectConfinedPath(entry.declaredRoot, entry.target, { label: `generated target ${entry.relative}` });
  if (!entry.originalExists) {
    if (inspected.exists) throw new Error(`Generated target identity changed from absent to present: ${entry.relative}`);
    return;
  }
  if (!inspected.exists) throw new Error(`Generated target identity changed from present to absent: ${entry.relative}`);
  assertPathIdentity(entry.target, entry.targetIdentity, `generated target ${entry.relative}`, "file");
  const content = readConfinedFile(entry.declaredRoot, entry.target, undefined, `generated target ${entry.relative}`);
  assertPathIdentity(entry.target, entry.targetIdentity, `generated target ${entry.relative}`, "file");
  if (!content.equals(entry.original)) throw new Error(`Generated target content changed before replacement: ${entry.relative}`);
}

function verifyExpectedTransactionState(entry, expectedIdentity) {
  inspectConfinedPath(entry.declaredRoot, entry.parent, { mustExist: true, expectedType: "directory", label: `generated parent ${entry.relative}` });
  assertPathIdentity(entry.parent, entry.parentIdentity, `generated parent ${entry.relative}`, "directory");
  inspectConfinedPath(entry.declaredRoot, entry.target, { mustExist: true, expectedType: "file", label: `generated target ${entry.relative}` });
  const before = expectedIdentity
    ? assertPathIdentity(entry.target, expectedIdentity, `generated target ${entry.relative}`, "file")
    : capturePathIdentity(entry.target, `generated target ${entry.relative}`, "file");
  const content = readConfinedFile(entry.declaredRoot, entry.target, undefined, `generated target ${entry.relative}`);
  assertPathIdentity(entry.target, before, `generated target ${entry.relative}`, "file");
  if (!content.equals(entry.expected)) throw new Error(`Generated write verification failed: ${entry.relative}`);
  return before;
}

function verifyRestoredTransactionState(entry) {
  inspectConfinedPath(entry.declaredRoot, entry.parent, { mustExist: true, expectedType: "directory", label: `rollback parent ${entry.relative}` });
  assertPathIdentity(entry.parent, entry.parentIdentity, `rollback parent ${entry.relative}`, "directory");
  const inspected = inspectConfinedPath(entry.declaredRoot, entry.target, { label: `rollback target ${entry.relative}` });
  if (!entry.originalExists) {
    if (inspected.exists) throw new Error(`Rollback left a generated target that was originally absent: ${entry.relative}`);
    return;
  }
  if (!inspected.exists) throw new Error(`Rollback removed an originally present target: ${entry.relative}`);
  const identity = capturePathIdentity(entry.target, `rollback target ${entry.relative}`, "file");
  const content = readConfinedFile(entry.declaredRoot, entry.target, undefined, `rollback target ${entry.relative}`);
  assertPathIdentity(entry.target, identity, `rollback target ${entry.relative}`, "file");
  if (!content.equals(entry.original)) throw new Error(`Rollback byte verification failed: ${entry.relative}`);
}

function createStageDirectory(packageRoot) {
  const stageParent = path.dirname(packageRoot);
  const stageParentIdentity = capturePathIdentity(stageParent, "distribution stage parent", "directory");
  const packageIdentity = capturePathIdentity(packageRoot, "package root", "directory");
  const stageRoot = path.join(stageParent, `.distribution-stage-${process.pid}-${randomUUID()}`);
  if (lstatIfPresent(stageRoot)) throw new Error(`Distribution stage already exists: ${stageRoot}`);
  assertPathIdentity(stageParent, stageParentIdentity, "distribution stage parent", "directory");
  assertPathIdentity(packageRoot, packageIdentity, "package root", "directory");
  fs.mkdirSync(stageRoot, { mode: 0o700 });
  assertPathIdentity(stageParent, stageParentIdentity, "distribution stage parent", "directory");
  assertPathIdentity(packageRoot, packageIdentity, "package root", "directory");
  return {
    path: stageRoot,
    identity: capturePathIdentity(stageRoot, "distribution stage", "directory"),
    parent: stageParent,
    parentIdentity: stageParentIdentity
  };
}

function writeExclusiveStageFile(stage, name, data) {
  assertPathIdentity(stage.parent, stage.parentIdentity, "distribution stage parent", "directory");
  assertPathIdentity(stage.path, stage.identity, "distribution stage", "directory");
  const target = path.join(stage.path, name);
  if (path.basename(target) !== name || pathKey(path.dirname(target)) !== pathKey(stage.path)) throw new Error(`Unsafe stage file name: ${name}`);
  if (lstatIfPresent(target)) throw new Error(`Stage file already exists: ${target}`);
  const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
  try {
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  assertPathIdentity(stage.path, stage.identity, "distribution stage", "directory");
  const identity = capturePathIdentity(target, "distribution stage file", "file");
  const written = fs.readFileSync(target);
  assertPathIdentity(target, identity, "distribution stage file", "file");
  if (!written.equals(data)) throw new Error(`Stage write verification failed: ${name}`);
  return { path: target, identity };
}

function verifyStageFile(stage, staged, expected) {
  assertPathIdentity(stage.parent, stage.parentIdentity, "distribution stage parent", "directory");
  assertPathIdentity(stage.path, stage.identity, "distribution stage", "directory");
  assertPathIdentity(staged.path, staged.identity, "distribution stage file", "file");
  const content = fs.readFileSync(staged.path);
  assertPathIdentity(staged.path, staged.identity, "distribution stage file", "file");
  if (!content.equals(expected)) throw new Error(`Staged content changed before replacement: ${staged.path}`);
}

function cleanupStageDirectory(stage) {
  if (!stage) return;
  if (!lstatIfPresent(stage.path)) throw new Error(`Distribution stage identity changed or disappeared: ${stage.path}`);
  assertPathIdentity(stage.parent, stage.parentIdentity, "distribution stage parent", "directory");
  assertPathIdentity(stage.path, stage.identity, "distribution stage", "directory");
  for (const entry of fs.readdirSync(stage.path, { withFileTypes: true })) {
    const target = path.join(stage.path, entry.name);
    const identity = capturePathIdentity(target, "distribution stage cleanup", "file");
    if (entry.isDirectory()) throw new Error(`Unexpected directory in distribution stage: ${target}`);
    assertPathIdentity(stage.path, stage.identity, "distribution stage", "directory");
    assertPathIdentity(target, identity, "distribution stage cleanup", "file");
    fs.unlinkSync(target);
  }
  assertPathIdentity(stage.path, stage.identity, "distribution stage", "directory");
  fs.rmdirSync(stage.path);
}

function cleanupCreatedDirectories(createdDirectories, errors) {
  for (const created of [...createdDirectories].reverse()) {
    try {
      if (!lstatIfPresent(created.path)) continue;
      assertPathIdentity(created.path, created.identity, "created generated parent", "directory");
      if (fs.readdirSync(created.path).length !== 0) throw new Error(`Created generated parent is not empty after rollback: ${created.path}`);
      fs.rmdirSync(created.path);
    } catch (error) {
      errors.push(`Created directory cleanup failed: ${error.message}`);
    }
  }
}

function rollbackTransaction(entries, replaced, stage, errors) {
  for (const entry of [...replaced].reverse()) {
    try {
      verifyExpectedTransactionState(entry, entry.replacementIdentity);
      if (entry.originalExists) {
        const rollbackStage = writeExclusiveStageFile(stage, `rollback-${entry.transactionIndex}`, entry.original);
        verifyStageFile(stage, rollbackStage, entry.original);
        verifyExpectedTransactionState(entry, entry.replacementIdentity);
        fs.renameSync(rollbackStage.path, entry.target);
      } else {
        verifyExpectedTransactionState(entry, entry.replacementIdentity);
        fs.unlinkSync(entry.target);
      }
      verifyRestoredTransactionState(entry);
      entry.restored = true;
    } catch (error) {
      errors.push(`Rollback failed for ${entry.relative}: ${error.message}`);
    }
  }

  for (const entry of entries) {
    try {
      if (entry.wasReplaced) verifyRestoredTransactionState(entry);
      else assertOriginalTransactionState(entry);
    } catch (error) {
      errors.push(`Post-rollback verification failed for ${entry.relative}: ${error.message}`);
    }
  }
}

function writeTransaction(packageRoot, changed, generated, hooks = {}) {
  const errors = [];
  const createdDirectories = [];
  const createdKeys = new Set();
  const entries = changed.map((relative) => ({ relative, ...generated.get(relative) }));
  const replaced = [];
  let stage;
  let capturedEntries = [];

  try {
    for (const entry of entries) ensureTransactionParent(entry, createdDirectories, createdKeys);
    capturedEntries = entries.map((entry, transactionIndex) => ({
      ...captureTransactionEntry(entry.relative, entry),
      transactionIndex
    }));
    stage = createStageDirectory(packageRoot);
    for (const entry of capturedEntries) {
      entry.staged = writeExclusiveStageFile(stage, `output-${entry.transactionIndex}`, entry.expected);
    }

    hooks.afterStage?.({ entries: capturedEntries.map((entry) => ({ relative: entry.relative, target: entry.target })) });
    for (const entry of capturedEntries) assertOriginalTransactionState(entry);

    for (const [index, entry] of capturedEntries.entries()) {
      hooks.beforeReplace?.({ index, relative: entry.relative, target: entry.target });
      assertOriginalTransactionState(entry);
      verifyStageFile(stage, entry.staged, entry.expected);
      fs.renameSync(entry.staged.path, entry.target);
      entry.wasReplaced = true;
      replaced.push(entry);
      entry.replacementIdentity = verifyExpectedTransactionState(entry);
    }
    for (const entry of capturedEntries) verifyExpectedTransactionState(entry, entry.replacementIdentity);
    cleanupStageDirectory(stage);
    stage = undefined;
  } catch (error) {
    errors.push(error.message);
    if (stage) {
      rollbackTransaction(capturedEntries, replaced, stage, errors);
    }
    try {
      cleanupStageDirectory(stage);
      stage = undefined;
    } catch (cleanupError) {
      errors.push(`Stage cleanup failed: ${cleanupError.message}`);
    }
    cleanupCreatedDirectories(createdDirectories, errors);
  }

  return { errors, entries: capturedEntries };
}

export function buildDistribution(root, { write = false, hooks = {} } = {}) {
  const validation = validateDistribution(root);
  if (validation.status !== "PASS") return buildFailure(validation);

  const generated = new Map();
  for (const agent of validation.manifest.agents) {
    const body = validation.bodies.get(agent.id);
    const codexRelative = `codex/agents/${agent.id}.toml`;
    const claudeRelative = `claude/agents/${agent.id}.md`;
    generated.set(codexRelative, {
      declaredRoot: validation.roots.codexAgents,
      target: path.join(validation.roots.codexAgents, `${agent.id}.toml`),
      expected: Buffer.from(renderCodexAgent(agent, body), "utf8"),
      agentId: agent.id,
      platform: "codex"
    });
    generated.set(claudeRelative, {
      declaredRoot: validation.roots.claudeAgents,
      target: path.join(validation.roots.claudeAgents, `${agent.id}.md`),
      expected: Buffer.from(renderClaudeAgent(agent, body), "utf8"),
      agentId: agent.id,
      platform: "claude"
    });
  }
  for (const relative of validation.sharedSkillFiles) {
    const source = path.join(validation.roots.codexSkill, ...relative.split("/"));
    const destination = path.join(validation.roots.claudeSkill, ...relative.split("/"));
    generated.set(`claude/skills/information-accessibility-practice/${relative}`, {
      declaredRoot: validation.roots.claudeSkill,
      target: destination,
      expected: readConfinedFile(validation.roots.codexSkill, source, undefined, `Codex skill source ${relative}`)
    });
  }

  const errors = [];
  const changed = [];
  const actual = new Map();
  for (const [relative, item] of generated) {
    try {
      const inspected = inspectConfinedPath(item.declaredRoot, item.target, { label: "generated target" });
      if (!inspected.exists) {
        changed.push(relative);
        continue;
      }
      const content = readConfinedFile(item.declaredRoot, item.target, undefined, `generated target ${relative}`);
      actual.set(relative, content);
      if (!generatedContentEquals(item, content)) changed.push(relative);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) return buildFailure(validation, errors);

  if (write && changed.length) {
    const transaction = writeTransaction(validation.roots.packageRoot, changed, generated, hooks);
    errors.push(...transaction.errors);
    if (!transaction.errors.length) {
      for (const relative of changed) actual.set(relative, generated.get(relative).expected);
    } else {
      for (const entry of transaction.entries) {
        if (entry.originalExists) actual.set(entry.relative, entry.original);
        else actual.delete(entry.relative);
      }
    }
  } else {
    for (const relative of changed) errors.push(`Stale generated file: ${relative}`);
  }

  const agentResults = validation.manifest.agents.map((agent) => {
    const codexRelative = `codex/agents/${agent.id}.toml`;
    const claudeRelative = `claude/agents/${agent.id}.md`;
    const codex = actual.get(codexRelative)?.toString("utf8");
    const claude = actual.get(claudeRelative)?.toString("utf8");
    const expectedBody = validation.bodies.get(agent.id);
    const codexBody = codex === undefined ? undefined : extractCodexBody(codex);
    const claudeBody = claude === undefined ? undefined : extractClaudeBody(claude);
    return {
      id: agent.id,
      codex_path: codexRelative,
      claude_path: claudeRelative,
      bodies_equal: codexBody !== undefined && claudeBody !== undefined
        && normalizeAgentBody(codexBody) === normalizeAgentBody(expectedBody)
        && normalizeAgentBody(claudeBody) === normalizeAgentBody(expectedBody)
    };
  });
  return {
    status: errors.length ? "FAIL" : "PASS",
    changed,
    agents: agentResults,
    default_agent_count: validation.manifest.agents.filter((agent) => agent.install_by_default).length,
    shared_skill_files: validation.shared_skill_files,
    errors
  };
}

const invokedAsScript = process.argv[1] && pathKey(process.argv[1]) === pathKey(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--write"].includes(args[0])) {
    console.error("Usage: node scripts/sync-distributions.mjs --check|--write");
    process.exitCode = 2;
  } else {
    const result = buildDistribution(scriptRoot, { write: args[0] === "--write" });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "PASS") process.exitCode = 1;
  }
}
