import assert from "node:assert/strict";
import test from "node:test";
import { monitorSources } from "../scripts/monitor-official-sources.mjs";

test("source monitoring separates content, redirect, and network changes", async () => {
  const entries = [
    { id: "changed", url: "https://www.w3.org/changed" },
    { id: "missing", url: "https://waic.jp/missing" },
    { id: "redirect", url: "https://www.w3.org/redirect" }
  ];
  const baseline = {
    changed: { sha256: "old", final_url: entries[0].url },
    missing: { sha256: "old", final_url: entries[1].url },
    redirect: { sha256: "old", final_url: entries[2].url }
  };
  const fetchImpl = async (url) => {
    if (url.endsWith("missing")) throw new Error("offline");
    if (url.endsWith("redirect")) return new Response(null, { status: 302, headers: { location: "/new" } });
    return new Response("new content");
  };
  const results = await monitorSources(entries, baseline, fetchImpl);
  assert.deepEqual(results.map((item) => item.changes), [
    ["content_changed"], ["unavailable"], ["content_changed", "redirect_changed"]
  ]);
  assert.equal(results[1].baseline_sha256, "old");
  assert.equal(results[2].final_url, "https://www.w3.org/new");
});

test("redirects outside official hosts are rejected", async () => {
  const [result] = await monitorSources([{ id: "source", url: "https://www.w3.org/start" }], {},
    async () => new Response(null, { status: 302, headers: { location: "http://example.com/" } }));
  assert.deepEqual(result.changes, ["unavailable"]);
  assert.match(result.error, /Unexpected source URL/u);
});
