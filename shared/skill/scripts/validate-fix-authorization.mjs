import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { readStableFile, assertStableFile } from "./lib/audit-run.mjs";
import { validateFixAuthorization } from "./lib/fix-authorization.mjs";

function parseArguments(argv) {
  const args = {
    authorizationPath: null,
    targetPath: null,
    runPath: null,
    sourceRoot: null,
    operation: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--authorization") {
      args.authorizationPath = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--target") {
      args.targetPath = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--run") {
      args.runPath = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--source-root") {
      args.sourceRoot = argv[index + 1] ?? null;
      index += 1;
    } else if (token === "--operation") {
      args.operation = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
}

function parseStableJson(filePath, label) {
  const snapshot = readStableFile(filePath, { label });
  const payload = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/, ""));
  return { payload, snapshot };
}

function usage() {
  console.error("Usage: node validate-fix-authorization.mjs --authorization <authorization-envelope.json> --target <file> --run <run.json> --source-root <source-root> --operation <create|modify|delete>");
  process.exit(2);
}

function printResult(result) {
  if (result.valid) {
    console.log("Authorization validation succeeded");
    if (result.warnings.length > 0) {
      console.log("Warnings:");
      for (const warning of result.warnings) {
        console.log(`- ${warning}`);
      }
    }
    process.exit(0);
  }
  console.error("Authorization validation failed");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

let { authorizationPath, targetPath, runPath, sourceRoot, operation } = parseArguments(process.argv.slice(2));
if (!authorizationPath || !targetPath || !runPath || !sourceRoot || !operation) usage();
if (!fs.existsSync(authorizationPath) || !fs.existsSync(runPath) || !fs.existsSync(sourceRoot) || !fs.lstatSync(sourceRoot).isDirectory()) usage();

try {
  const { payload: authorization, snapshot: authorizationSnapshot } = parseStableJson(authorizationPath, "authorization envelope");
  const { payload: run, snapshot: runSnapshot } = parseStableJson(runPath, "audit run");
  const result = validateFixAuthorization({
    authorization,
    run,
    runFile: runSnapshot.path,
    targetFile: targetPath,
    sourceRoot,
    operation
  });
  assertStableFile(authorizationSnapshot, "authorization envelope");
  assertStableFile(runSnapshot, "audit run");
  printResult(result);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
