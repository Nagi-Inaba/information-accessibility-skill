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
  assert.match(body, /validated artifact/i, `${id} must return a validated artifact`);
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
  assert.match(body, /versioned `audit-run`/i);
  assert.match(body, /validated assessment/i);
  assert.match(body, /must not modify the audited target/i);
});

test("all specialist bodies declare the shared read-only evidence boundary", () => {
  for (const id of specialistIds) assertReadOnlyBoundary(sharedBody(id), id);
});

test("E1 inspector emits only schema-valid E0 or E1 SCREEN observations", () => {
  const body = sharedBody("information-accessibility-e1-inspector");

  assert.match(body, /artifact type `screening-observations`/i);
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
  assert.match(body, /`criterion_procedure_status`[^]*`available`[^]*`not_available`/i);
  assert.match(body, /translate[^]*procedure_availability[^]*available[^]*unavailable/i);
  assert.match(body, /registered procedure/i);
  assert.match(body, /registered method/i);
  assert.match(body, /official source/i);
  assert.match(body, /`not_available`[^]*(?:must not|do not)[^]*(?:executable|evaluated)/i);
  for (const field of ["total_requirements", "available_procedures", "unavailable_procedures"]) {
    assert.equal(body.includes(`\`${field}\``), true, `queue planner must calculate ${field}`);
  }
  assert.match(body, /do not add fields[^]*human-review-queue\.schema\.json/i);
});

test("remediation planner preserves verified and unverified bases without editing source", () => {
  const body = sharedBody("information-accessibility-remediation-planner");

  assert.match(body, /artifact type `remediation-plan`/i);
  assert.match(body, /remediation-plan\.schema\.json/i);
  assert.match(body, /only[^]*validated assessment findings[^]*validated `screening-observations` artifacts/i);
  assert.match(body, /`verified_failure`[^]*declared external human[^]*survived assessment validation/i);
  assert.match(body, /`unverified_screening_candidate`[^]*AI screening/i);
  for (const item of ["location", "affected users", "proposed change", "owner", "verification method", "residual limitation"]) {
    assert.match(body, new RegExp(item, "iu"), `remediation planner must preserve ${item}`);
  }
  assert.match(body, /schema-supported[^]*`issue`[^]*`proposed_change`[^]*`verification`/i);
  assert.match(body, /validated assessment[^]*reference input[^]*not[^]*(?:envelope `inputs`|source_artifact_ids)/i);
  assert.match(body, /(?:envelope `inputs`|source_artifact_ids)[^]*only[^]*registered `screening-observations`[^]*`declared-human-review`/i);
  assert.match(body, /must not modify the audited target/i);
  assert.match(body, /do not add fields[^]*remediation-plan\.schema\.json/i);
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
