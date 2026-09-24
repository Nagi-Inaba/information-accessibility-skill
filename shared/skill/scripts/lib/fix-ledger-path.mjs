import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "./canonical-json.mjs";

const accountHome = os.userInfo().homedir;
if (typeof accountHome !== "string" || !path.isAbsolute(accountHome)) {
  throw new Error("The operating-system account home directory is unavailable for fix receipts.");
}
export const FIX_LEDGER_DIRECTORY = path.join(accountHome, ".information-accessibility-practice", "fix-authorization-ledger-v1");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const key = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);

export function fixLedgerPaths({ authorizationSha256, sourceRoot, runId }) {
  const absolute = path.resolve(sourceRoot);
  const stats = fs.lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink() || key(fs.realpathSync.native(absolute)) !== key(absolute)) {
    throw new Error("Trusted source root must be a real directory for the fix ledger.");
  }
  const sourceRootSha256 = hash(Buffer.from(key(absolute), "utf8"));
  const ledgerKey = hash(Buffer.from(canonicalJson({
    authorization_sha256: authorizationSha256, run_id: runId, source_root_sha256: sourceRootSha256
  }), "utf8"));
  return {
    sourceRootSha256,
    markerPath: path.join(FIX_LEDGER_DIRECTORY, `${ledgerKey}.json`),
    completionPath: path.join(FIX_LEDGER_DIRECTORY, `${ledgerKey}.completed.json`)
  };
}
