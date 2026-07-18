import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { applyAuthorizedFix } from "./lib/fix-transaction.mjs";

function parseArgs(argv) {
  const options = { commandIds: [] };
  const flags = new Map([
    ["--authorization", "authorizationFile"], ["--run", "runFile"], ["--source-root", "sourceRoot"],
    ["--operation", "operation"], ["--target", "target"], ["--description", "description"],
    ["--command-id", "commandIds"], ["--lock-dir", "lockDir"], ["--output", "output"],
    ["--content-file", "contentFile"], ["--expected-before-sha256", "expectedBeforeSha256"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (key === "commandIds") options.commandIds.push(value);
    else {
      if (options[key] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
      options[key] = value;
    }
    index += 1;
  }
  for (const [flag, key] of flags) {
    if (["commandIds", "contentFile", "expectedBeforeSha256"].includes(key)) continue;
    if (!options[key]) throw new Error(`${flag} is required`);
  }
  if (options.commandIds.length === 0) throw new Error("--command-id is required");
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const result = applyAuthorizedFix(parseArgs(argv));
  process.stdout.write(`${JSON.stringify({ status: "PASS", output: result.output, diff_output: result.diffOutput, consumption_marker: result.consumptionMarker, global_consumption_marker: result.globalConsumptionMarker })}\n`);
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
