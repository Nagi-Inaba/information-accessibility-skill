import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function addSource(index, source) {
  if (!source?.url || !/^https:\/\//u.test(source.url)) return;
  const current = index.get(source.url);
  if (current) {
    current.references.push(source.id);
    return;
  }
  index.set(source.url, {
    id: source.id,
    kind: source.kind,
    url: source.url,
    reason: source.reason ?? null,
    references: [source.id],
    expected_sha256: source.expected_sha256 ?? null
  });
}

export function collectSourceDefinitions(registry, config = { additional_sources: [] }) {
  const index = new Map();
  for (const profile of registry.profiles ?? []) {
    for (const standard of profile.standards ?? []) {
      addSource(index, {
        id: `profile:${profile.id}:standard:${standard.id}`,
        kind: "primary-standard",
        url: standard.primary_url,
        reason: standard.normative_status
      });
    }
    for (const method of profile.evaluation_methods ?? []) {
      addSource(index, {
        id: `profile:${profile.id}:method:${method.id}`,
        kind: "evaluation-method",
        url: method.primary_url,
        reason: "Registered evaluation or reporting method."
      });
    }
  }
  for (const source of config.additional_sources ?? []) addSource(index, source);
  return [...index.values()].sort((left, right) => left.url.localeCompare(right.url, "en"));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function header(response, name) {
  return typeof response.headers?.get === "function" ? response.headers.get(name) : null;
}

export async function monitorSources(sources, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("A fetch implementation is required.");
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const results = [];

  for (const source of sources) {
    try {
      const response = await fetcher(source.url, {
        redirect: "follow",
        headers: {
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.1",
          "user-agent": "information-accessibility-skill-source-monitor/1.0"
        },
        signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentHash = sha256(bytes);
      const finalUrl = response.url || source.url;
      const httpOk = response.status >= 200 && response.status < 300;
      const tooLarge = bytes.length > maxBytes;
      const hashChanged = Boolean(source.expected_sha256 && source.expected_sha256 !== contentHash);
      const attention = !httpOk || tooLarge || hashChanged;
      results.push({
        id: source.id,
        kind: source.kind,
        references: source.references,
        requested_url: source.url,
        final_url: finalUrl,
        redirected: finalUrl !== source.url,
        status: response.status,
        ok: httpOk,
        content_type: header(response, "content-type"),
        etag: header(response, "etag"),
        last_modified: header(response, "last-modified"),
        bytes: bytes.length,
        sha256: contentHash,
        expected_sha256: source.expected_sha256,
        hash_changed: hashChanged,
        too_large: tooLarge,
        attention_required: attention,
        error: null
      });
    } catch (error) {
      results.push({
        id: source.id,
        kind: source.kind,
        references: source.references,
        requested_url: source.url,
        final_url: null,
        redirected: false,
        status: null,
        ok: false,
        content_type: null,
        etag: null,
        last_modified: null,
        bytes: null,
        sha256: null,
        expected_sha256: source.expected_sha256,
        hash_changed: false,
        too_large: false,
        attention_required: true,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    schema_version: "1.0.0",
    checked_at: checkedAt,
    source_count: results.length,
    attention_required: results.some((result) => result.attention_required),
    changed_or_failed_sources: results
      .filter((result) => result.attention_required)
      .map((result) => result.id),
    results
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (!["--output", "--timeout-ms", "--max-bytes"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: node scripts/monitor-standard-sources.mjs [--output <new-result.json>] [--timeout-ms <milliseconds>] [--max-bytes <bytes>]\n");
    return 0;
  }
  const registry = readJson(path.join(root, "codex/skills/information-accessibility-practice/references/standards-registry.json"));
  const config = readJson(path.join(root, "scripts/source-monitor-sources.json"));
  const sources = collectSourceDefinitions(registry, config);
  const result = await monitorSources(sources, {
    timeoutMs: options.timeoutMs ? Number(options.timeoutMs) : undefined,
    maxBytes: options.maxBytes ? Number(options.maxBytes) : undefined
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    const output = path.resolve(options.output);
    fs.writeFileSync(output, serialized, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify({ status: result.attention_required ? "ATTENTION" : "PASS", output, sources: result.source_count })}\n`);
  } else process.stdout.write(serialized);
  return result.attention_required ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
