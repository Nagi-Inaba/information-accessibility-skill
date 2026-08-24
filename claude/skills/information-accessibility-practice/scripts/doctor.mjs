#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateStandardsRegistry } from "./lib/profile-registry.mjs";
import { normalizeRuntimeLocale, runtimeLocaleFromEnvironment } from "./lib/runtime-locale.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);
const require = createRequire(import.meta.url);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function parseArgs(argv) {
  const options = { format: "text", locale: runtimeLocaleFromEnvironment("en") };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--format", "--locale"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--format") options.format = value;
    if (arg === "--locale") options.locale = value;
    index += 1;
  }
  if (!["text", "json"].includes(options.format)) throw new Error("--format must be text or json");
  options.locale = normalizeRuntimeLocale(options.locale, "en");
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

function textLabels(locale) {
  return locale === "ja" ? {
    title: "情報アクセシビリティ監査Doctor",
    supported: "対応",
    yes: "はい",
    no: "いいえ",
    package: "パッケージ",
    packageRoot: "パッケージroot",
    registry: "規格レジストリ",
    valid: "有効",
    activeProfiles: "利用可能なプロファイル",
    none: "なし",
    screenReader: "スクリーンリーダーruntime: 外部機能",
    mutation: "標準CLIからの対象変更: いいえ",
    errors: "エラー:",
    warnings: "警告:"
  } : {
    title: "Information Accessibility Audit Doctor",
    supported: "supported",
    yes: "yes",
    no: "no",
    package: "Package",
    packageRoot: "Package root",
    registry: "Registry",
    valid: "valid",
    activeProfiles: "Active profiles",
    none: "none",
    screenReader: "Screen-reader runtime: external capability",
    mutation: "Target mutation from standard CLI: no",
    errors: "Errors:",
    warnings: "Warnings:"
  };
}

function renderText(result, locale) {
  const text = textLabels(locale);
  const mark = (value) => value ? text.yes : text.no;
  return [
    `${text.title}: ${result.status}`,
    "",
    `Node: ${result.node.version} (${text.supported}: ${mark(result.node.supported)})`,
    `${text.package}: ${result.package.name} ${result.package.version}`,
    `${text.packageRoot}: ${result.package.root}`,
    `${text.registry}: ${result.registry.version ?? "unavailable"} (${text.valid}: ${mark(result.registry.valid)})`,
    `${text.activeProfiles}: ${result.registry.active_profiles.join(", ") || text.none}`,
    `Playwright: ${mark(result.capabilities.browser.playwright.available)}${result.capabilities.browser.playwright.version ? ` (${result.capabilities.browser.playwright.version})` : ""}`,
    `axe-core: ${mark(result.capabilities.browser.axe_core.available)}${result.capabilities.browser.axe_core.version ? ` (${result.capabilities.browser.axe_core.version})` : ""}`,
    text.screenReader,
    text.mutation,
    ...(result.errors.length ? ["", text.errors, ...result.errors.map((item) => `- ${item}`)] : []),
    ...(result.warnings.length ? ["", text.warnings, ...result.warnings.map((item) => `- ${item}`)] : [])
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = { ...diagnose(), locale: options.locale };
  if (options.format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${renderText(result, options.locale)}\n`);
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
