#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateStandardsRegistry } from "./lib/profile-registry.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);
const require = createRequire(import.meta.url);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function parseArgs(argv) {
  const options = { format: "text" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--format") throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --format");
    if (options.format !== "text") throw new Error("Duplicate argument: --format");
    options.format = value;
    index += 1;
  }
  if (!["text", "json"].includes(options.format)) throw new Error("--format must be text or json");
  return options;
}

function resolveOptional(packageName) {
  try {
    const resolved = require.resolve(packageName, { paths: [skillRoot] });
    let version = null;
    try {
      version = readJson(require.resolve(`${packageName}/package.json`, { paths: [skillRoot] })).version;
    } catch {
      // Some packages do not export package.json; availability is still useful.
    }
    return { available: true, version, resolved };
  } catch {
    return { available: false, version: null, resolved: null };
  }
}

export function diagnose(root = skillRoot) {
  const errors = [];
  const warnings = [];
  const manifestPath = path.join(root, "package.json");
  const registryPath = path.join(root, "references/standards-registry.json");
  const requiredPaths = [
    "SKILL.md",
    "package.json",
    "scripts/accessibility-audit.mjs",
    "references/standards-registry.json",
    "references/criteria-catalog.json",
    "references/audit-run.schema.json"
  ];
  for (const relative of requiredPaths) {
    if (!fs.existsSync(path.join(root, relative))) errors.push(`Missing installed file: ${relative}`);
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0], 10);
  const nodeSupported = Number.isInteger(nodeMajor) && nodeMajor >= 20;
  if (!nodeSupported) errors.push(`Node.js 20 or newer is required; found ${process.versions.node}.`);

  let manifest = { name: "unknown", version: "unknown", bin: {} };
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    errors.push(`Could not read package manifest: ${error.message}`);
  }

  let registry = null;
  let registryValidation = { valid: false, errors: ["Registry unavailable."] };
  try {
    registry = readJson(registryPath);
    registryValidation = validateStandardsRegistry(registry);
    errors.push(...registryValidation.errors.map((error) => `Standards registry: ${error}`));
  } catch (error) {
    errors.push(`Could not read standards registry: ${error.message}`);
  }

  const playwright = resolveOptional("playwright");
  const axeCore = resolveOptional("axe-core");
  if (!playwright.available) warnings.push("Optional browser capability is unavailable: playwright.");
  if (!axeCore.available) warnings.push("Optional browser capability is unavailable: axe-core.");

  const status = errors.length > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS";
  return {
    schema_version: "1.0.0",
    status,
    node: {
      version: process.versions.node,
      required: ">=20",
      supported: nodeSupported,
      platform: process.platform,
      architecture: process.arch
    },
    package: {
      name: manifest.name,
      version: manifest.version,
      root: path.resolve(root),
      bin: manifest.bin?.["accessibility-audit"] ?? null,
      required_files_present: requiredPaths.every((relative) => fs.existsSync(path.join(root, relative)))
    },
    registry: {
      valid: registryValidation.valid,
      errors: registryValidation.errors,
      version: registry?.schema_version ?? null,
      verified_at: registry?.last_verified_at ?? null,
      active_profiles: (registry?.profiles ?? [])
        .filter((profile) => profile.assessment_configuration?.active === true)
        .map((profile) => profile.id)
        .sort((left, right) => left.localeCompare(right, "en"))
    },
    capabilities: {
      browser: {
        playwright,
        axe_core: axeCore,
        screen_reader_runtime: {
          available: false,
          reason: "An actual screen-reader session is an external human or host capability and is not bundled."
        }
      }
    },
    mutation_available: false,
    errors,
    warnings
  };
}

function renderText(result) {
  const mark = (value) => value ? "yes" : "no";
  return [
    `Information Accessibility Audit Doctor: ${result.status}`,
    "",
    `Node: ${result.node.version} (supported: ${mark(result.node.supported)})`,
    `Package: ${result.package.name} ${result.package.version}`,
    `Package root: ${result.package.root}`,
    `Registry: ${result.registry.version ?? "unavailable"} (valid: ${mark(result.registry.valid)})`,
    `Active profiles: ${result.registry.active_profiles.join(", ") || "none"}`,
    `Playwright: ${mark(result.capabilities.browser.playwright.available)}${result.capabilities.browser.playwright.version ? ` (${result.capabilities.browser.playwright.version})` : ""}`,
    `axe-core: ${mark(result.capabilities.browser.axe_core.available)}${result.capabilities.browser.axe_core.version ? ` (${result.capabilities.browser.axe_core.version})` : ""}`,
    "Screen-reader runtime: external capability",
    "Target mutation from standard CLI: no",
    ...(result.errors.length ? ["", "Errors:", ...result.errors.map((item) => `- ${item}`)] : []),
    ...(result.warnings.length ? ["", "Warnings:", ...result.warnings.map((item) => `- ${item}`)] : [])
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = diagnose();
  if (options.format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${renderText(result)}\n`);
  return result.status === "FAIL" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
