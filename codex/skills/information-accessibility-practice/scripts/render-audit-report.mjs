#!/usr/bin/env node

export * from "./legacy-report-core.mjs";

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { main as renderReportMain } from "./render-report.mjs";

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = renderReportMain();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
