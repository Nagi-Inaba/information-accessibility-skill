import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const agentPrefix = "information-accessibility-";
const excludedSkillFiles = new Set(["agents/openai.yaml"]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function walk(base, current = base) {
  if (!fs.existsSync(current)) return [];
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(current, entry.name);
    return entry.isDirectory() ? walk(base, full) : [toPosix(path.relative(base, full))];
  }).sort();
}

function jsonType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
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
  if (schema.type && jsonType(value) !== schema.type) {
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
    if (schema.items) {
      value.forEach((item, index) => validateAgainstSchema(item, schema.items, `${location}[${index}]`, errors));
    }
  }

  if (schema.type === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location} must contain at least ${schema.minLength} character(s).`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${location} does not match ${schema.pattern}.`);
    }
  }
}

function withoutFinalLineEnding(text) {
  return text.replace(/(?:\r\n|\r|\n)$/, "");
}

function normalizeBodyForComparison(text) {
  return withoutFinalLineEnding(text).replace(/\r\n?|\n/g, "\n");
}

function sourceLineEnding(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function renderCodexAgent(agent, body) {
  const content = withoutFinalLineEnding(body);
  return [
    `description = ${JSON.stringify(agent.description)}`,
    "developer_instructions = \"\"\"",
    content,
    "\"\"\"",
    `model_reasoning_effort = ${JSON.stringify(agent.codex.model_reasoning_effort)}`,
    `name = ${JSON.stringify(agent.id)}`,
    ""
  ].join(sourceLineEnding(body));
}

function yamlScalar(value) {
  if (value.length > 0 && value.trim() === value && !/[\r\n:#]/u.test(value) && !/^[\-?&*!|>'"%@`{}\[\],]/u.test(value)) return value;
  return JSON.stringify(value);
}

function yamlFlowScalar(value) {
  return /^[A-Za-z][A-Za-z0-9_-]*$/u.test(value) ? value : JSON.stringify(value);
}

function renderClaudeAgent(agent, body) {
  const content = withoutFinalLineEnding(body);
  return [
    "---",
    `name: ${yamlScalar(agent.id)}`,
    `description: ${yamlScalar(agent.description)}`,
    `tools: [${agent.claude.tools.map(yamlFlowScalar).join(", ")}]`,
    `model: ${yamlScalar(agent.claude.model)}`,
    `effort: ${yamlScalar(agent.claude.effort)}`,
    "---",
    "",
    content,
    ""
  ].join(sourceLineEnding(body));
}

function extractCodexBody(text) {
  return text.match(/developer_instructions = """\r?\n(?<body>[\s\S]*?)\r?\n"""/)?.groups?.body;
}

function extractClaudeBody(text) {
  return text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n(?<body>[\s\S]*)$/)?.groups?.body;
}

function declaredAgentFiles(root, agents, errors) {
  const declarations = [
    { directory: path.join(root, "codex", "agents"), extension: ".toml" },
    { directory: path.join(root, "claude", "agents"), extension: ".md" }
  ];
  for (const { directory, extension } of declarations) {
    const allowed = new Set(agents.map((agent) => `${agent.id}${extension}`));
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith(agentPrefix) && !allowed.has(entry.name)) {
        errors.push(`Undeclared generated agent file: ${toPosix(path.relative(root, path.join(directory, entry.name)))}`);
      }
    }
  }
}

function failure(errors, sharedSkillFiles = 0, agents = []) {
  return { status: "FAIL", changed: [], agents, shared_skill_files: sharedSkillFiles, errors };
}

export function buildDistribution(root, { write = false } = {}) {
  const errors = [];
  const sharedAgents = path.join(root, "shared", "agents");
  const manifestFile = path.join(sharedAgents, "agent-manifest.json");
  const schemaFile = path.join(sharedAgents, "agent-manifest.schema.json");
  let manifest;
  let schema;

  try {
    manifest = readJson(manifestFile);
    schema = readJson(schemaFile);
  } catch (error) {
    return failure([`Could not read distribution manifest or schema: ${error.message}`]);
  }

  validateAgainstSchema(manifest, schema, "$", errors);
  if (errors.length) return failure(errors);

  const ids = new Set();
  const bodyFiles = new Set();
  const bodies = new Map();
  for (const agent of manifest.agents) {
    if (ids.has(agent.id)) errors.push(`Duplicate agent id: ${agent.id}`);
    ids.add(agent.id);
    if (bodyFiles.has(agent.body_file)) errors.push(`Duplicate agent body file: ${agent.body_file}`);
    bodyFiles.add(agent.body_file);

    const bodyPath = path.resolve(sharedAgents, agent.body_file);
    if (path.dirname(bodyPath) !== path.resolve(sharedAgents) || path.basename(bodyPath) !== agent.body_file) {
      errors.push(`Unsafe agent body file: ${agent.body_file}`);
      continue;
    }
    if (!fs.existsSync(bodyPath) || !fs.statSync(bodyPath).isFile()) {
      errors.push(`Missing agent body: ${agent.body_file}`);
      continue;
    }
    const body = fs.readFileSync(bodyPath, "utf8");
    if (body.startsWith("\uFEFF")) errors.push(`Agent body must be UTF-8 without a BOM: ${agent.body_file}`);
    if (body.includes('"""')) errors.push(`Agent body cannot contain a TOML multiline-string delimiter: ${agent.body_file}`);
    bodies.set(agent.id, body);
  }
  declaredAgentFiles(root, manifest.agents, errors);

  const codexSkill = path.join(root, "codex", "skills", "information-accessibility-practice");
  const claudeSkill = path.join(root, "claude", "skills", "information-accessibility-practice");
  const sharedSkillFiles = walk(codexSkill).filter((file) => !excludedSkillFiles.has(file));
  if (!fs.existsSync(codexSkill) || !fs.statSync(codexSkill).isDirectory()) {
    errors.push("Missing Codex information-accessibility-practice skill source.");
  }
  const sharedSkillFileSet = new Set(sharedSkillFiles);
  for (const relative of walk(claudeSkill)) {
    if (!sharedSkillFileSet.has(relative)) errors.push(`Undeclared Claude skill mirror file: ${relative}`);
  }
  if (errors.length) return failure(errors, sharedSkillFiles.length);

  const generated = new Map();
  const agentResults = [];
  for (const agent of manifest.agents) {
    const body = bodies.get(agent.id);
    const codexRelative = `codex/agents/${agent.id}.toml`;
    const claudeRelative = `claude/agents/${agent.id}.md`;
    const codexText = renderCodexAgent(agent, body);
    const claudeText = renderClaudeAgent(agent, body);
    generated.set(codexRelative, Buffer.from(codexText, "utf8"));
    generated.set(claudeRelative, Buffer.from(claudeText, "utf8"));
    agentResults.push({
      id: agent.id,
      codex_path: codexRelative,
      claude_path: claudeRelative,
      bodies_equal: normalizeBodyForComparison(extractCodexBody(codexText)) === normalizeBodyForComparison(extractClaudeBody(claudeText))
    });
  }
  for (const relative of sharedSkillFiles) {
    generated.set(`claude/skills/information-accessibility-practice/${relative}`, fs.readFileSync(path.join(codexSkill, ...relative.split("/"))));
  }

  const changed = [];
  for (const [relative, expected] of generated) {
    const target = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(expected)) changed.push(relative);
  }

  if (write) {
    for (const relative of changed) {
      const target = path.join(root, ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, generated.get(relative));
    }
    for (const relative of changed) {
      const target = path.join(root, ...relative.split("/"));
      if (!fs.readFileSync(target).equals(generated.get(relative))) errors.push(`Generated write verification failed: ${relative}`);
    }
  } else {
    for (const relative of changed) errors.push(`Stale generated file: ${relative}`);
  }

  return {
    status: errors.length ? "FAIL" : "PASS",
    changed,
    agents: agentResults,
    shared_skill_files: sharedSkillFiles.length,
    errors
  };
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
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
