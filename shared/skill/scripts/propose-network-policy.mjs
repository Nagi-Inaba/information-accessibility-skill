import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertStableFile, readStableFile, writeNewJson } from "./lib/audit-run.mjs";
import { createNetworkPolicy, networkUrl } from "./lib/network-policy.mjs";

const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function main(argv = process.argv.slice(2)) {
  const options = { targets: [], exactTargets: [], methods: [], profile: "web-modern" };
  const seen = new Set();
  const flags = { "--target": "targets", "--exact-target": "exactTargets", "--method": "methods", "--profile": "profile", "--output": "output", "--allow-localhost": "localhost", "--include-official-sources": "sources" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags[argv[i]];
    const value = argv[i + 1];
    if (!key || !value || value.startsWith("--")) throw new Error(`Invalid argument: ${argv[i]}`);
    if (Array.isArray(options[key])) options[key].push(value);
    else { if (seen.has(key)) throw new Error(`Duplicate argument: ${argv[i]}`); options[key] = value; seen.add(key); }
  }
  for (const flag of ["localhost", "sources"]) if (options[flag] !== undefined && options[flag] !== "true") throw new Error(`${flag} accepts only explicit true.`);
  let registrySnapshot;
  let sourceUrls = [];
  if (options.sources === "true") {
    registrySnapshot = readStableFile(path.join(skillRoot, "references/standards-registry.json"));
    const registry = JSON.parse(registrySnapshot.bytes.toString("utf8"));
    const profile = registry.profiles.find((item) => item.id === options.profile && item.assessment_configuration?.active);
    if (!profile) throw new Error("Unknown or inactive profile.");
    sourceUrls = [...(profile.standards ?? []), ...(profile.evaluation_methods ?? [])].map((item) => item.primary_url).filter(Boolean);
  }
  const policy = createNetworkPolicy({ targetOrigins: options.targets.map((value) => networkUrl(value).origin),
    targetUrls: options.exactTargets, sourceUrls, methods: options.methods.length ? options.methods : ["GET", "HEAD"], allowLocalhost: options.localhost === "true" });
  if (registrySnapshot) assertStableFile(registrySnapshot, "official-source registry");
  if (options.output) writeNewJson(path.resolve(options.output), policy);
  process.stdout.write(`${JSON.stringify({ status: "proposal", network_access_performed: false, authority_granted: false, policy }, null, 2)}\n`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
