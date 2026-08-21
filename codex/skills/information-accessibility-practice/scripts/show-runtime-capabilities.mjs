import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateJsonSchema } from "./lib/json-schema.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "references", name), "utf8"));

export function inspectCapabilities(provided = []) {
  const registry = read("runtime-capabilities.json");
  const schema = read("runtime-capabilities.schema.json");
  const errors = [];
  validateJsonSchema(registry, schema, "$", errors);
  if (errors.length) throw new Error(`Invalid runtime capability registry:\n- ${errors.join("\n- ")}`);
  const ids = new Set(registry.capabilities.map((item) => item.id));
  const unknown = provided.filter((id) => !ids.has(id));
  if (unknown.length) throw new Error(`Unknown provided capabilities: ${unknown.join(", ")}`);
  const available = new Set(["record_control_plane", ...provided]);
  const capabilities = registry.capabilities.map((item) => ({ ...item, available: available.has(item.id) }));
  const missing_required = registry.web_inspection_required.filter((id) => !available.has(id));
  const missing_recommended = registry.web_inspection_recommended.filter((id) => !available.has(id));
  return {
    schema_version: registry.schema_version,
    web_inspection_ready: missing_required.length === 0,
    missing_required,
    missing_recommended,
    capabilities
  };
}

function parseArgs(argv) {
  const options = { provided: [], format: "json", requireWeb: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provided") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --provided");
      options.provided.push(value);
      index += 1;
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --format");
      options.format = value;
      index += 1;
    } else if (arg === "--require-web") options.requireWeb = true;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  return options;
}

function markdown(result) {
  return [
    "# Web inspection capability preflight",
    "",
    `- Web inspection ready: ${result.web_inspection_ready ? "yes" : "no"}`,
    `- Missing required: ${result.missing_required.join(", ") || "none"}`,
    `- Missing recommended: ${result.missing_recommended.join(", ") || "none"}`,
    "",
    "| Capability | Available | Provider | Description |",
    "| --- | --- | --- | --- |",
    ...result.capabilities.map((item) => `| ${item.id} | ${item.available ? "yes" : "no"} | ${item.provider} | ${item.description} |`),
    "",
    "> The installed CLI is the audit record control plane. Browser and assistive-technology observations must come from a declared host capability or external human review."
  ].join("\n") + "\n";
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: accessibility-audit capabilities [--provided <capability-id>]... [--require-web] [--format json|markdown]\n");
    return 0;
  }
  const result = inspectCapabilities(options.provided);
  process.stdout.write(options.format === "markdown" ? markdown(result) : `${JSON.stringify(result, null, 2)}\n`);
  return options.requireWeb && !result.web_inspection_ready ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
