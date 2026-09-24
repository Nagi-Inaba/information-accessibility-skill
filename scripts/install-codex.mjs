#!/usr/bin/env node

import { runInstaller } from "./install-claude.mjs";

try {
  runInstaller(process.argv.slice(2), "codex");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
