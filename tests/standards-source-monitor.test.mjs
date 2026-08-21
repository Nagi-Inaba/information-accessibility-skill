import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { collectSourceDefinitions, monitorSources } from "../scripts/monitor-standard-sources.mjs";

function response(url, status, body, headers = {}) {
  return {
    url,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      }
    },
    async arrayBuffer() {
      return Buffer.from(body);
    }
  };
}

test("source definitions are deduplicated while preserving registry references", () => {
  const registry = {
    profiles: [{
      id: "one",
      standards: [{ id: "standard-a", primary_url: "https://example.invalid/standard", normative_status: "Recommendation" }],
      evaluation_methods: [{ id: "method-a", primary_url: "https://example.invalid/method" }]
    }, {
      id: "two",
      standards: [{ id: "standard-b", primary_url: "https://example.invalid/standard", normative_status: "Reused" }],
      evaluation_methods: []
    }]
  };
  const definitions = collectSourceDefinitions(registry, {
    additional_sources: [{ id: "errata", kind: "errata", url: "https://example.invalid/errata" }]
  });
  assert.equal(definitions.length, 3);
  const shared = definitions.find((item) => item.url.endsWith("/standard"));
  assert.deepEqual(shared.references.sort(), ["profile:one:standard:standard-a", "profile:two:standard:standard-b"]);
});

test("monitor records final URL, headers, byte count, and content hash", async () => {
  const body = "current standard text";
  const expectedHash = crypto.createHash("sha256").update(body).digest("hex");
  const result = await monitorSources([{
    id: "standard",
    kind: "primary-standard",
    url: "https://example.invalid/old",
    references: ["standard"],
    expected_sha256: null
  }], {
    checkedAt: "2026-08-22T00:00:00Z",
    fetcher: async () => response("https://example.invalid/current", 200, body, {
      "content-type": "text/html",
      etag: "fixture-etag",
      "last-modified": "Sat, 22 Aug 2026 00:00:00 GMT"
    })
  });
  assert.equal(result.attention_required, false);
  assert.equal(result.results[0].redirected, true);
  assert.equal(result.results[0].sha256, expectedHash);
  assert.equal(result.results[0].etag, "fixture-etag");
  assert.equal(result.results[0].bytes, Buffer.byteLength(body));
});

test("monitor flags HTTP failures, retrieval errors, oversized pages, and baseline changes", async () => {
  const body = "changed";
  const sources = [
    { id: "http", kind: "standard", url: "https://example.invalid/http", references: ["http"], expected_sha256: null },
    { id: "throw", kind: "standard", url: "https://example.invalid/throw", references: ["throw"], expected_sha256: null },
    { id: "large", kind: "standard", url: "https://example.invalid/large", references: ["large"], expected_sha256: null },
    { id: "hash", kind: "standard", url: "https://example.invalid/hash", references: ["hash"], expected_sha256: "0".repeat(64) }
  ];
  const result = await monitorSources(sources, {
    maxBytes: 3,
    fetcher: async (url) => {
      if (url.endsWith("/throw")) throw new Error("network unavailable");
      if (url.endsWith("/http")) return response(url, 503, "down");
      return response(url, 200, body);
    }
  });
  assert.equal(result.attention_required, true);
  assert.deepEqual(new Set(result.changed_or_failed_sources), new Set(["http", "throw", "large", "hash"]));
  assert.equal(result.results.find((item) => item.id === "throw").error, "network unavailable");
  assert.equal(result.results.find((item) => item.id === "large").too_large, true);
  assert.equal(result.results.find((item) => item.id === "hash").hash_changed, true);
});

test("scheduled workflow uploads a candidate and never updates canonical sources automatically", () => {
  const workflow = fs.readFileSync(".github/workflows/standards-source-monitor.yml", "utf8");
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /monitor-standard-sources\.mjs --output source-monitor-result\.json/u);
  assert.match(workflow, /actions\/upload-artifact@v4/u);
  assert.match(workflow, /issues: write/u);
  assert.match(workflow, /Do not update the canonical catalog automatically/u);
  assert.doesNotMatch(workflow, /git\s+push/iu);
});
