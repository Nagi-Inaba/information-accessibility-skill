import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractClaudeBody,
  extractCodexBody,
  normalizeAgentBody
} from "../scripts/sync-distributions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedAgentRoot = path.join(root, "shared", "agents");
const expectedAgentIds = [
  "information-accessibility-reviewer",
  "information-accessibility-e1-inspector",
  "information-accessibility-human-queue-planner",
  "information-accessibility-remediation-planner"
];
const specialistIds = expectedAgentIds.slice(1);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function sharedBody(id) {
  return read(path.join("shared", "agents", `${id}.md`));
}

function assertReadOnlyBoundary(body, id) {
  assert.match(body, /must not record `pass`, `fail`, or `not_applicable` on profile rows/i, `${id} must prohibit AI-authored profile outcomes`);
  assert.match(body, /must not modify the audited target/i, `${id} must prohibit audited-target writes`);
  assert.match(body, /must not authenticate, submit forms, or perform state-changing interaction/i, `${id} must prohibit state-changing interaction`);
  assert.match(body, /evidence level `E0` or `E1`/i, `${id} must retain the AI evidence ceiling`);
  assert.match(body, /candidate envelope JSON/i, `${id} must return candidate envelope JSON`);
  assert.match(body, /must not (?:write|materialize)[^]*(?:artifact file|envelope file)/i, `${id} must not write the artifact file`);
  assert.match(body, /must not claim[^]*validated/i, `${id} must not claim its candidate is validated`);
  assert.match(body, /orchestrator[^]*materialize[^]*artifact_root[^]*register-audit-artifact\.mjs[^]*validated/i, `${id} must reserve materialization and validation for the orchestrator`);
  assert.match(body, /audit-artifact-envelope\.schema\.json/i, `${id} must use the installed artifact envelope`);
}

test("manifest installs exactly the registry-declared read-only agent set", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const registry = readJson("codex/skills/information-accessibility-practice/references/orchestration-registry.json");
  const installedRegistryIds = registry.roles
    .filter((role) => role.install_by_default)
    .map((role) => role.agent_id);

  assert.deepEqual(installedRegistryIds, expectedAgentIds);
  assert.deepEqual(manifest.agents.map((agent) => agent.id), expectedAgentIds);
  assert.equal(manifest.agents.filter((agent) => agent.install_by_default).length, 4);
  assert.equal(manifest.agents.some((agent) => agent.id === "information-accessibility-authorized-fixer"), false);

  for (const agent of manifest.agents) {
    assert.equal(agent.install_by_default, true, `${agent.id} must be installed by default`);
    assert.equal(agent.body_file, `${agent.id}.md`);
    assert.equal(fs.existsSync(path.join(sharedAgentRoot, agent.body_file)), true, `${agent.body_file} must exist`);
  }
});

test("public reviewer remains the broad entry and orchestrates the Task 5 runtime", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const reviewer = manifest.agents.find((agent) => agent.id === "information-accessibility-reviewer");
  const body = sharedBody("information-accessibility-reviewer");

  assert.match(reviewer.description, /websites, applications, documents, media, events, and participation workflows/i);
  assert.match(body, /meetings, events, websites, applications, PDFs, slides, announcement graphics, video\/audio, SNS, support portals, public participation, or community onboarding/i);
  for (const script of [
    "create-audit-run.mjs",
    "validate-audit-run.mjs",
    "register-audit-artifact.mjs",
    "merge-audit-artifacts.mjs",
    "validate-assessment.mjs",
    "render-audit-report.mjs"
  ]) {
    assert.match(body, new RegExp(script.replaceAll(".", "\\."), "u"), `reviewer must name ${script}`);
  }
  assert.match(body, /dispatch[^]*applicable roles/i);
  assert.match(body, /current run status[^]*registry transitions[^]*dispatch[^]*applicable roles/i);
  assert.doesNotMatch(body, /installed read-only sequence/i);
  assert.match(body, /validate[^]*register[^]*merge[^]*validate[^]*render/i);
  assert.match(body, /deterministic/i);
  assert.match(body, /local fallback[^]*same[^]*artifact contracts/i);
  assert.match(body, /public report[^]*(?:must not|does not)[^]*(?:internal agent names|orchestration history)/i);
  assert.match(body, /`audit-run`[^]*schema_version[^]*`3\.0\.0`/i);
  assert.match(body, /render-audit-report\.mjs --run <run\.json> --assessment <merged\.json> --output <new-report\.md>/i);
  assert.match(body, /stable[^]*safe[^]*runtime/i);
  assert.match(body, /validated assessment/i);
  assert.match(body, /must not modify the audited target/i);
});

test("manifest removes direct editing from the reviewer and all writing from specialists", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const reviewer = manifest.agents.find((agent) => agent.id === "information-accessibility-reviewer");

  assert.deepEqual(reviewer.claude.tools, ["Read", "Grep", "Glob", "Bash", "Write"]);
  for (const id of specialistIds) {
    const specialist = manifest.agents.find((agent) => agent.id === id);
    assert.deepEqual(specialist.claude.tools, ["Read", "Grep", "Glob", "Bash"], `${id} must not receive Write or Edit`);
  }
});

test("all specialist bodies declare the shared read-only evidence boundary", () => {
  for (const id of specialistIds) assertReadOnlyBoundary(sharedBody(id), id);
});

test("E1 inspector emits only schema-valid E0 or E1 SCREEN observations", () => {
  const body = sharedBody("information-accessibility-e1-inspector");

  assert.match(body, /artifact type `screening-observations`/i);
  assert.match(body, /`inputs`[^]*exactly[^]*\[\]/i);
  assert.match(body, /screening-observations\.schema\.json/i);
  assert.match(body, /exact[^]*`target\.version_or_commit`/i);
  assert.match(body, /exact[^]*`environment`/i);
  assert.match(body, /`location`/i);
  assert.match(body, /`captured_at`/i);
  assert.match(body, /limitation/i);
  assert.match(body, /evidence reference/i);
  assert.match(body, /`SCREEN-\*`/i);
  assert.match(body, /only `E0` or `E1`/i);
  for (const action of ["navigate", "expand", "move_focus", "inspect"]) {
    assert.match(body, new RegExp(`\\b${action}\\b`, "iu"), `inspector must constrain ${action}`);
  }
  assert.match(body, /allowed_actions/i);
  assert.match(body, /do not add fields[^]*screening-observations\.schema\.json/i);
  assert.match(body, /`inspect_without_mutation`/i);
  assert.match(body, /`read_allowlisted_resources`[^]*network[^]*allowlisted/i);
  assert.match(body, /`human_supervised_interaction`[^]*interaction[^]*human_supervised/i);
  assert.match(body, /navigate[^]*expand[^]*move_focus[^]*inspect[^]*examples[^]*not[^]*allowed_actions/i);
});

test("human queue planner translates every requirement lookup into the installed queue schema", () => {
  const body = sharedBody("information-accessibility-human-queue-planner");

  assert.match(body, /artifact type `human-review-queue`/i);
  assert.match(body, /human-review-queue\.schema\.json/i);
  assert.match(body, /every queued requirement[^]*show-requirement\.mjs/i);
  assert.match(body, /`procedure_binding`[^]*copy[^]*exact/i);
  for (const field of [
    "procedure_availability",
    "procedure_ref",
    "generic_method_ref",
    "official_sources",
    "human_actions",
    "required_evidence_types",
    "cant_tell_conditions"
  ]) {
    assert.equal(body.includes(`\`${field}\``), true, `queue planner must copy ${field}`);
  }
  assert.match(body, /`not_available`[^]*(?:must not|do not)[^]*(?:executable|evaluated)/i);
  for (const field of ["total_requirements", "available_procedures", "unavailable_procedures"]) {
    assert.equal(body.includes(`\`${field}\``), true, `queue planner must calculate ${field}`);
  }
  assert.match(body, /exact queue length/i);
  assert.match(body, /sum[^]*exactly[^]*`total_requirements`/i);
  assert.match(body, /do not add fields[^]*human-review-queue\.schema\.json/i);
});

test("remediation planner preserves verified and unverified bases without editing source", () => {
  const body = sharedBody("information-accessibility-remediation-planner");

  assert.match(body, /artifact type `remediation-plan`/i);
  assert.match(body, /remediation-plan\.schema\.json/i);
  assert.match(body, /only[^]*runtime-registered[^]*(?:source artifacts|evidence artifacts)/i);
  assert.match(body, /assessment[^]*(?:must not|is not)[^]*(?:reference input|evidence source|source artifact)/i);
  assert.match(body, /`verified_failure`[^]*same run[^]*`declared-human-review`[^]*`fail`[^]*same requirement/i);
  assert.match(body, /`unverified_screening_candidate`[^]*same run[^]*exact `SCREEN-\*` observation/i);
  for (const field of [
    "remediation_id",
    "basis",
    "requirement_id",
    "source_artifact_ids",
    "priority",
    "location",
    "affected_users",
    "issue",
    "proposed_change",
    "owner",
    "verification",
    "residual_limitation"
  ]) {
    assert.equal(body.includes(`\`${field}\``), true, `remediation planner must name ${field}`);
  }
  assert.match(body, /owner[^]*(?:null|unassigned)[^]*omit[^]*non-empty string/i);
  assert.match(body, /must not modify the audited target/i);
  assert.match(body, /do not add fields[^]*remediation-plan\.schema\.json/i);
});

test("orchestration reference states the current behavioral boundary and future mechanical gates", () => {
  const body = read("codex/skills/information-accessibility-practice/references/agent-orchestration.md");

  assert.match(body, /behavioral contract[^]*not[^]*complete tool sandbox/i);
  assert.match(body, /allowlisted executable[^]*allowlisted arguments/i);
  assert.match(body, /pre-execution[^]*artifact_root[^]*write gate/i);
  assert.match(body, /target-derived commands[^]*never[^]*executed/i);
  assert.match(body, /deny[^]*(?:authentication|authenticate)[^]*form[^]*state-changing/i);
  assert.match(body, /malicious fixture[^]*target[^]*out-of-scope[^]*hashes[^]*unchanged/i);
  assert.match(body, /denial proof[^]*execution gate/i);
  assert.match(body, /Task 9[^]*privacy scan[^]*local paths[^]*private URLs[^]*person names[^]*sensitive evidence/i);
  assert.match(body, /public report[^]*(?:must not|never)[^]*(?:internal agent|run IDs|orchestration history|state history)/i);
  assert.match(body, /future acceptance criteria[^]*(?:not yet implemented|not an implemented guarantee)/i);
});

test("all agent bodies separate installed control-plane CLIs from untrusted command content", () => {
  for (const id of expectedAgentIds) {
    const body = sharedBody(id);
    assert.match(body, /installed skill CLI[^]*control-plane/i, `${id} must identify the installed validation control plane`);
    assert.match(body, /`execute_commands`[^]*audited target[^]*artifacts[^]*external input/i, `${id} must scope the command-execution prohibition`);
    assert.match(body, /must not treat[^]*(?:target content|audited target)[^]*instructions/i, `${id} must treat target content as untrusted evidence`);
  }
});

test("all four generated Codex and Claude agents equal their shared bodies", () => {
  for (const id of expectedAgentIds) {
    const source = sharedBody(id);
    const codex = extractCodexBody(read(path.join("codex", "agents", `${id}.toml`)));
    const claude = extractClaudeBody(read(path.join("claude", "agents", `${id}.md`)));

    assert.ok(codex, `${id} Codex body must be extractable`);
    assert.ok(claude, `${id} Claude body must be extractable`);
    assert.equal(normalizeAgentBody(codex), normalizeAgentBody(source), `${id} Codex body must equal the shared body`);
    assert.equal(normalizeAgentBody(claude), normalizeAgentBody(source), `${id} Claude body must equal the shared body`);
  }
});
