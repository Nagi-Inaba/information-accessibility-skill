import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "../../codex/skills/information-accessibility-practice/scripts/lib/canonical-json.mjs";
import { targetDigest } from "../../codex/skills/information-accessibility-practice/scripts/lib/target-identity.mjs";
import { observeLocalTarget } from "../../codex/skills/information-accessibility-practice/scripts/lib/target-observer.mjs";

export const fixtureBytes = Buffer.from("<!doctype html><html lang=\"en\"><title>Fixture</title><main><h1>Fixture</h1></main></html>\n");
const digest = (value) => targetDigest(canonicalJson(value));

// Real saved captures are fixture data, not fabricated checks. Production
// registration still reopens and hashes these files using its normal observer.
export function fixtureInventory(run, artifactRoot, bytes = fixtureBytes) {
  if (!path.isAbsolute(artifactRoot)) throw new Error("Fixture artifact root must be absolute.");
  const snapshots = run.target.urls_or_files.map((targetRef, index) => {
    if (!/^https?:/u.test(targetRef)) return observeLocalTarget({ kind: "file", target_ref: targetRef }, { baseDir: path.dirname(artifactRoot) }).snapshot;
    const bundlePath = path.join(artifactRoot, `target-state-${index}.json`);
    const bundle = { schema_version: "1.0.0", kind: "web-evidence-bundle", captured_at: "2026-01-01T00:00:00Z",
      target: { requested_url: targetRef, final_url: targetRef, http_status: 200, dom_sha256: targetDigest(bytes), ax_tree_sha256: targetDigest("[]") },
      environment: { adapter: "synthetic-test-fixture", browser_version: "fixture", viewport: { width: 1280, height: 720 }, rendering: { locale: "en-US" } },
      evidence: { dom: bytes.toString("utf8"), accessibility_tree: [] } };
    if (!fs.existsSync(bundlePath)) fs.writeFileSync(bundlePath, JSON.stringify(bundle), "utf8");
    return observeLocalTarget({ kind: "web_state", target_ref: targetRef, bundle_path: bundlePath,
      locale: "en-US", authentication_state_id: "synthetic-fixture", feature_flags: [] }).snapshot;
  }).sort((a, b) => a.snapshot_id.localeCompare(b.snapshot_id, "en"));
  const body = { schema_version: "1.0.0", run_id: run.run_id, target_context_sha256: digest(run.target),
    environment_sha256: digest(run.environment), publication: "private_by_default", snapshots };
  return { ...body, sha256: digest(body) };
}

export function fixtureEvidenceBytes(run) {
  const snapshot = run.target_inventory?.snapshots[0];
  return snapshot?.kind === "file" ? fs.readFileSync(snapshot.identity.canonical_path) : fixtureBytes;
}
