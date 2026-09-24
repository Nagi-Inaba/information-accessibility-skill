import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateAuthorizedTarget } from "./fix-authorization.mjs";

const VERIFIER_EXECUTABLE = "a11y-file-verify";
const ALLOWED_MODES = new Set(["exists", "utf8", "json"]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const verifierScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "verify-authorized-file.mjs");

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function utcSeconds(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Verification clock returned an invalid date.");
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function outputBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value === null || value === undefined) return Buffer.alloc(0);
  return Buffer.from(String(value), "utf8");
}

function normalizedSpawnError(error) {
  const value = {
    code: typeof error?.code === "string" ? error.code : "SPAWN_ERROR",
    name: typeof error?.name === "string" ? error.name : "Error"
  };
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function safeEnvironment() {
  const environment = {};
  const allowed = new Set(["SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"]);
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key.toUpperCase()) && typeof value === "string") environment[key] = value;
  }
  return environment;
}

function parseCommand(command, authorization, sourceRoot) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("Authorized verification command must be an object.");
  }
  if (command.executable !== VERIFIER_EXECUTABLE) {
    throw new Error(`Authorized verification executable must be exactly ${VERIFIER_EXECUTABLE}.`);
  }
  if (command.cwd !== ".") {
    throw new Error("Authorized verification command cwd must be exactly '.'.");
  }
  if (!Array.isArray(command.args) || command.args.length !== 4 || command.args[0] !== "--mode" || command.args[2] !== "--path") {
    throw new Error("Authorized verification command arguments must be exactly --mode <exists|utf8|json> --path <authorized-path>.");
  }
  const mode = command.args[1];
  const relativePath = command.args[3];
  if (!ALLOWED_MODES.has(mode)) throw new Error(`Unsupported authorized verification mode: ${String(mode)}.`);
  if (!authorization.payload.allowed_paths.includes(relativePath)) {
    throw new Error(`Verification path is not present in authorization.payload.allowed_paths: ${String(relativePath)}.`);
  }
  let targetValidation = validateAuthorizedTarget({
    authorization,
    targetFile: relativePath,
    sourceRoot,
    operation: "modify"
  });
  if (mode === "exists" && targetValidation.errors.length > 0 && authorization.payload.allowed_operations?.includes("delete")) {
    targetValidation = validateAuthorizedTarget({ authorization, targetFile: relativePath, sourceRoot, operation: "create" });
  }
  if (targetValidation.errors.length > 0) {
    throw new Error(`Invalid authorized verification path:\n- ${targetValidation.errors.join("\n- ")}`);
  }
  return { command, mode, relativePath };
}

function resultFor(command, spawned, startedAt, completedAt) {
  let status;
  let exitCode = null;
  let signal = null;
  if (spawned?.error) {
    status = "spawn_error";
  } else if (typeof spawned?.signal === "string" && spawned.signal.length > 0) {
    status = "signaled";
    signal = spawned.signal;
  } else if (Number.isInteger(spawned?.status)) {
    status = "exited";
    exitCode = spawned.status;
  } else {
    status = "spawn_error";
  }

  const stdout = outputBytes(spawned?.stdout);
  const stderr = status === "spawn_error"
    ? Buffer.concat([outputBytes(spawned?.stderr), normalizedSpawnError(spawned?.error)])
    : outputBytes(spawned?.stderr);
  return {
    command_id: command.command_id,
    executable: command.executable,
    args: [...command.args],
    cwd: command.cwd,
    status,
    exit_code: exitCode,
    signal,
    stdout_sha256: sha256Bytes(stdout),
    stderr_sha256: sha256Bytes(stderr),
    started_at: startedAt,
    completed_at: completedAt
  };
}

export function inspectVerificationFile(sourceRoot, relativePath) {
  const authorization = {
    payload: {
      source_root: sourceRoot,
      allowed_paths: [relativePath]
    }
  };
  const validation = validateAuthorizedTarget({
    authorization,
    targetFile: relativePath,
    sourceRoot,
    operation: "modify"
  });
  if (validation.errors.length > 0) throw new Error(validation.errors.join("\n"));
  const root = fs.realpathSync.native(sourceRoot);
  return path.resolve(root, ...relativePath.split("/"));
}

export function executeAuthorizedVerificationCommands({
  authorization,
  commandIds,
  sourceRoot,
  spawnSyncImpl = defaultSpawnSync,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!authorization?.payload || typeof authorization.payload !== "object") {
    throw new Error("A validated fix-authorization envelope is required.");
  }
  if (!Array.isArray(authorization.payload.verification_commands) || authorization.payload.verification_commands.length === 0) {
    throw new Error("authorization.payload.verification_commands must be a non-empty array.");
  }
  if (!Array.isArray(commandIds) || commandIds.length === 0) {
    throw new Error("At least one authorized verification command_id is required.");
  }
  if (new Set(commandIds).size !== commandIds.length) throw new Error("Requested verification command_id values must not contain duplicates.");
  const commands = new Map();
  for (const command of authorization.payload.verification_commands) {
    if (commands.has(command?.command_id)) throw new Error(`Duplicate authorization verification command_id: ${String(command?.command_id)}.`);
    commands.set(command?.command_id, command);
  }

  const root = fs.realpathSync.native(sourceRoot);
  const plans = commandIds.map((commandId) => {
    const command = commands.get(commandId);
    if (!command) throw new Error(`Requested command_id is not present in the authorization: ${String(commandId)}.`);
    return parseCommand(command, authorization, root);
  });

  return plans.map(({ command, mode, relativePath }) => {
    const startedAt = utcSeconds(now());
    const spawned = spawnSyncImpl(process.execPath, [
      verifierScript,
      "--source-root", root,
      "--mode", mode,
      "--path", relativePath
    ], {
      cwd: root,
      shell: false,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: null,
      env: safeEnvironment()
    });
    const completedAt = utcSeconds(now());
    return resultFor(command, spawned, startedAt, completedAt);
  });
}

export function commandResultIsSuccess(result) {
  return result?.status === "exited" && result.exit_code === 0;
}
