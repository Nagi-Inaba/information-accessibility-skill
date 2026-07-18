# Accessibility Multi-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maintain one standards and evidence skill while adding a backward-compatible orchestrator, three read-only specialist agents, and one opt-in authorized fixer whose inputs, outputs, permissions, and handoffs are validated by deterministic contracts.

**Architecture:** Keep `information-accessibility-practice` as the only domain skill and preserve `information-accessibility-reviewer` as the public entry point.
Specialists write separate immutable artifacts, while scripts validate roles, hashes, permissions, and state transitions before the orchestrator creates a new assessment or report.
Codex and Claude distributions are generated or synchronized from one agent manifest and one body per agent so that adding a role does not require parallel hand-editing.

**Tech Stack:** Node.js built-in modules, JSON Schema draft 2020-12, Markdown, PowerShell, `node:test`, Codex agent TOML, Claude agent Markdown.

## Global Constraints

- Start from branch `codex/m4-agent-human-boundary` at commit `37d87de875450a4be06b2224f1fa49e248769747`.
- Preserve the public agent identifier `information-accessibility-reviewer` and the current request patterns.
- Keep `assessment-record.schema.json` at version `1.0.0`; orchestration metadata belongs in separate records.
- Start every new orchestration schema at `1.0.0`; a new required field, removed field, or semantic change requires a new schema version and explicit validator dispatch.
- Keep AI-produced assessment data at E0/E1, `mapping_status: "unverified"`, and profile `outcome: "not_tested"`.
- Only a declared external human review artifact may supply profile outcomes, and the package must state that it does not authenticate the reviewer's identity.
- No specialist may edit another specialist's artifact.
- Only the opt-in authorized fixer may edit the audited source, and only one fixer may run for a source worktree at a time.
- Default installation excludes the authorized fixer.
- Audit-run generators, artifact generators, report renderers, and catalog-refresh candidates must refuse to overwrite existing files.
- `sync-distributions.mjs --write` may replace only manifest-declared Codex/Claude distribution outputs after validating their source files; it must not write to undeclared paths.
- Resolve and verify artifact paths before reading or writing; reject paths outside the declared audit artifact root or authorized source root.
- Do not add runtime package dependencies unless the existing dependency-free implementation cannot satisfy a recorded test.
- Keep public reports independent of agent names, branch names, run history, and internal orchestration state.
- Keep target-specific evidence, authentication data, and private pages outside the reusable package.
- Run ordinary verification without network access.
- Perform live primary-source refresh only through an explicit refresh command that writes a review candidate instead of replacing the catalog.
- Use UTF-8 explicitly for PowerShell file reads and writes.
- Use conventional commit prefixes and do not bypass hooks.

## Baseline Evidence

- `node --test .\tests\*.test.mjs` passes 45 of 45 tests at `37d87de`.
- `node .\scripts\verify-package.mjs` passes with 24 shared skill files, 22 parsed JSON files, and equal Codex/Claude reviewer bodies.
- `node .\scripts\build-criteria-catalog.mjs --verified-at 2026-07-14 --check` performs live fetches and reports `Generated catalog is stale` on 2026-07-16.
- The stale result is not a failed accessibility contract; it proves that routine verification and primary-source refresh currently share one non-reproducible command.

## Planned File Structure

```text
shared/
  agents/
    agent-manifest.json
    agent-manifest.schema.json
    information-accessibility-reviewer.md
    information-accessibility-e1-inspector.md
    information-accessibility-human-queue-planner.md
    information-accessibility-remediation-planner.md
    information-accessibility-authorized-fixer.md
scripts/
  compare-criteria-catalog.mjs
  sync-distributions.mjs
codex/skills/information-accessibility-practice/
  references/
    standards-registry.schema.json
    orchestration-registry.json
    orchestration-registry.schema.json
    audit-run.schema.json
    audit-artifact-envelope.schema.json
    screening-observations.schema.json
    human-review-queue.schema.json
    declared-human-review.schema.json
    remediation-plan.schema.json
    fix-authorization.schema.json
    change-record.schema.json
    agent-orchestration.md
  scripts/
    lib/json-schema.mjs
    lib/profile-registry.mjs
    lib/audit-run.mjs
    lib/fix-lease.mjs
    create-audit-run.mjs
    validate-audit-run.mjs
    register-audit-artifact.mjs
    merge-audit-artifacts.mjs
    validate-fix-authorization.mjs
    acquire-fix-lease.mjs
    release-fix-lease.mjs
tests/
  catalog-maintenance.test.mjs
  distribution-sync.test.mjs
  profile-registry.test.mjs
  audit-orchestration-contract.test.mjs
  audit-orchestration-cli.test.mjs
  agent-role-contracts.test.mjs
  authorized-fixer.test.mjs
  multi-agent-forward.test.mjs
```

The Codex skill tree remains the editable source for shared skill files during this plan.
`sync-distributions.mjs --write` mirrors those files to Claude and renders both platforms' agents from `shared/agents`.
Moving the whole skill tree to a new `src/` directory is excluded because it would add migration risk without improving the runtime contracts delivered here.

---

### Task 1: Separate Offline Verification From Live Catalog Refresh

**Files:**

- Modify: `scripts/build-criteria-catalog.mjs`
- Create: `scripts/compare-criteria-catalog.mjs`
- Create: `tests/catalog-maintenance.test.mjs`
- Create: `tests/fixtures/catalog/wcag-sample.html`
- Create: `tests/fixtures/catalog/jis-sample.html`
- Create: `tests/fixtures/catalog/japan-profile-sample.html`
- Modify: `README.md`

**Interfaces:**

- Produces: `verifyStoredCatalog(root): { status, counts, mirrors_equal }`.
- Produces: `buildCatalogFromSources({ wcagHtml, jisHtml, japanHtml, verifiedAt, registry }): Catalog`.
- Produces: `compareCatalogs(current, candidate): { source_hash_changes, requirement_changes, routing_changes }`.
- CLI: `node scripts/build-criteria-catalog.mjs --check` performs no network access.
- CLI: `node scripts/build-criteria-catalog.mjs --refresh --verified-at YYYY-MM-DD --output <candidate.json>` fetches sources and refuses overwrite.
- CLI: `node scripts/compare-criteria-catalog.mjs --current <catalog.json> --candidate <candidate.json>` is read-only.

- [ ] **Step 1: Write failing offline and refresh-mode tests**

```js
test("catalog check is offline and validates the stored mirrors", () => {
  const result = runNode("scripts/build-criteria-catalog.mjs", ["--check"], {
    env: { ...process.env, A11Y_TEST_FAIL_ON_FETCH: "1" }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).counts, { wcag: 55, jis: 38, japan_additional: 18 });
});

test("live refresh requires an output and refuses overwrite", () => {
  const missing = runNode("scripts/build-criteria-catalog.mjs", ["--refresh", "--verified-at", "2026-07-16"]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--output is required with --refresh/);
});
```

- [ ] **Step 2: Run the new test and confirm the current live-fetch design fails it**

Run: `node --test .\tests\catalog-maintenance.test.mjs`

Expected: FAIL because `--check` still reaches `fetch()` and `--refresh` is not implemented.

- [ ] **Step 3: Extract source parsing from network acquisition**

Export the following functions from `build-criteria-catalog.mjs` without changing catalog field names.

```js
export function buildCatalogFromSources({ wcagHtml, jisHtml, japanHtml, verifiedAt, registry }) {
  const wcag = parseWcag(wcagHtml);
  const wcagIds = new Set(wcag.map((record) => record.id));
  const wcagBySc = new Map(wcag.map((record) => [record.success_criterion, record]));
  const jis = parseJisChecklist(jisHtml, wcagIds);
  const japanAdditional = parseJapanAdditional(japanHtml, wcagBySc);
  assertCatalogIntegrity({ wcag, jis, japanAdditional, registry });
  return createCatalog({ wcag, jis, japanAdditional, verifiedAt, wcagHtml, jisHtml, japanHtml });
}
```

- [ ] **Step 4: Implement offline `--check` and explicit `--refresh`**

`--check` must parse the stored Codex and Claude catalogs, compare their bytes, validate counts and registry IDs, and print a PASS object.
`--refresh` must fetch all three sources, build a candidate, require `--output`, and refuse an existing output.
Set the test-only fetch guard immediately before the network call.

```js
async function fetchText(url) {
  if (process.env.A11Y_TEST_FAIL_ON_FETCH === "1") {
    throw new Error("Network access attempted during offline verification");
  }
  const response = await fetch(url, { headers: { "user-agent": "information-accessibility-skill-catalog-builder/1.0" } });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}
```

- [ ] **Step 5: Implement deterministic catalog comparison**

Compare requirement records by ID after removing only `verified_at` and `sources[*].source_sha256` from the structural comparison.
Report hash-only source changes separately from requirement additions, removals, title or level changes, and method-routing changes.

- [ ] **Step 6: Run maintenance tests and the full baseline**

Run: `node --test .\tests\catalog-maintenance.test.mjs .\tests\audit-workflow.test.mjs`

Expected: PASS.

Run: `node .\scripts\build-criteria-catalog.mjs --check`

Expected: PASS without network access.

Run: `node --test .\tests\*.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Document the two maintenance commands**

Document that routine checks use `--check`, while maintainers use `--refresh --output` followed by `compare-criteria-catalog.mjs` and human review before replacing catalogs.

- [ ] **Step 8: Commit the reproducible maintenance gate**

```powershell
git add scripts/build-criteria-catalog.mjs scripts/compare-criteria-catalog.mjs tests/catalog-maintenance.test.mjs tests/fixtures/catalog README.md
git commit -m "fix: separate catalog verification from source refresh"
```

### Task 2: Create One Distribution Source For All Agents

**Files:**

- Create: `shared/agents/agent-manifest.json`
- Create: `shared/agents/agent-manifest.schema.json`
- Create: `shared/agents/information-accessibility-reviewer.md`
- Create: `scripts/sync-distributions.mjs`
- Create: `tests/distribution-sync.test.mjs`
- Modify: `scripts/verify-package.mjs`
- Generate: `codex/agents/information-accessibility-reviewer.toml`
- Generate: `claude/agents/information-accessibility-reviewer.md`

**Interfaces:**

- Manifest entry: `{ id, description, install_by_default, body_file, codex, claude }`.
- Produces: `buildDistribution(root, { write }): { status, changed, agents, shared_skill_files }`.
- CLI: `node scripts/sync-distributions.mjs --check` exits nonzero for stale generated files.
- CLI: `node scripts/sync-distributions.mjs --write` updates only declared generated paths.

- [ ] **Step 1: Write a failing manifest-driven distribution test**

```js
test("distribution sync renders every manifest agent for Codex and Claude", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const check = runNode("scripts/sync-distributions.mjs", ["--check"]);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  for (const agent of manifest.agents) {
    assert.equal(fs.existsSync(path.join(root, "codex/agents", `${agent.id}.toml`)), true);
    assert.equal(fs.existsSync(path.join(root, "claude/agents", `${agent.id}.md`)), true);
  }
});
```

- [ ] **Step 2: Run the test and confirm the manifest does not exist**

Run: `node --test .\tests\distribution-sync.test.mjs`

Expected: FAIL with missing `shared/agents/agent-manifest.json`.

- [ ] **Step 3: Add the initial manifest and move the reviewer body without changing normalized content**

Use this manifest shape.

```json
{
  "schema_version": "1.0.0",
  "agents": [
    {
      "id": "information-accessibility-reviewer",
      "description": "Executes reusable, evidence-based accessibility audits across websites, applications, documents, media, events, and participation workflows, with guarded WCAG/JIS records where a formal profile applies.",
      "install_by_default": true,
      "body_file": "information-accessibility-reviewer.md",
      "codex": { "model_reasoning_effort": "medium" },
      "claude": { "tools": ["Read", "Grep", "Glob", "Bash", "Write", "Edit"], "model": "sonnet", "effort": "medium" }
    }
  ]
}
```

- [ ] **Step 4: Implement deterministic rendering and one-way skill mirroring**

Validate the manifest against `agent-manifest.schema.json` and reject duplicate IDs, duplicate body files, missing bodies, and unsafe output names before writing.
Reject undeclared files in `codex/agents` or `claude/agents` whose names begin with `information-accessibility-`.
Exclude `codex/skills/information-accessibility-practice/agents/openai.yaml` from the Claude mirror.
Normalize line endings only while comparing agent bodies; preserve UTF-8 output and a final newline.

- [ ] **Step 5: Make package verification iterate over the manifest**

Replace the hard-coded reviewer comparison with a loop over `manifest.agents`.
Return these fields without removing the existing result fields.

```js
const result = {
  shared_skill_files: commonFiles.length,
  json_files_parsed: jsonFiles.length,
  agent_bodies_equal: agentResults.every((item) => item.bodies_equal),
  agent_count: agentResults.length,
  default_agent_count: manifest.agents.filter((item) => item.install_by_default).length,
  agents: agentResults,
  status: errors.length ? "FAIL" : "PASS",
  errors
};
```

- [ ] **Step 6: Prove that regeneration is idempotent**

Run: `node .\scripts\sync-distributions.mjs --write`

Expected: PASS and generated reviewer instructions remain normalized-equal to the pre-task version.

Run: `node .\scripts\sync-distributions.mjs --check`

Expected: PASS with `changed: []`.

Run: `node .\scripts\verify-package.mjs`

Expected: PASS with `agent_count: 1`.

- [ ] **Step 7: Commit the distribution source**

```powershell
git add shared/agents scripts/sync-distributions.mjs scripts/verify-package.mjs tests/distribution-sync.test.mjs codex/agents claude/agents
git commit -m "refactor: generate accessibility agent distributions"
```

### Task 3: Make Active Profiles Registry-Driven

**Files:**

- Create: `codex/skills/information-accessibility-practice/references/standards-registry.schema.json`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/profile-registry.mjs`
- Create: `tests/profile-registry.test.mjs`
- Modify: `codex/skills/information-accessibility-practice/references/standards-registry.json`
- Modify: `codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/show-requirement.mjs`
- Generate: corresponding Claude skill files.

**Interfaces:**

- Registry profile field: `assessment_configuration`.
- Produces: `profileConfiguration(registry, profileId)`.
- Produces: `recordsForProfile({ profile, catalog })`.
- Produces: `groupForRequirement(profile, requirementId)`.
- Produces: `reportGroups(profile)`.

- [ ] **Step 1: Add failing tests that prohibit profile-ID branches in core scripts**

```js
test("active profiles declare their catalog and report configuration", () => {
  for (const id of ["web-modern", "jp-public-web"]) {
    const profile = registry.profiles.find((item) => item.id === id);
    assert.equal(profile.assessment_configuration.active, true);
    assert.ok(profile.assessment_configuration.catalog_keys.length > 0);
    assert.ok(profile.assessment_configuration.groups.length > 0);
  }
});

test("generation and reporting do not branch on active profile IDs", () => {
  for (const file of ["generate-assessment.mjs", "validate-assessment.mjs", "render-audit-report.mjs"]) {
    const source = read(`codex/skills/information-accessibility-practice/scripts/${file}`);
    assert.doesNotMatch(source, /profileId === "web-modern"|profileId === "jp-public-web"|profile\.id === "jp-public-web"/);
  }
});
```

- [ ] **Step 2: Run the tests and confirm current profile branches are detected**

Run: `node --test .\tests\profile-registry.test.mjs`

Expected: FAIL on the current conditions in generation, validation, and reporting.

- [ ] **Step 3: Add profile configuration without changing requirement IDs or claim rules**

Use this structure for `web-modern`.

```json
{
  "assessment_configuration": {
    "active": true,
    "catalog_keys": ["web_modern"],
    "groups": [
      {
        "id": "wcag_2_2",
        "label": "WCAG 2.2 A/AA",
        "requirement_id_prefixes": ["WCAG-2.2-SC-"]
      }
    ]
  }
}
```

Use `jis_x_8341_3_2016` and `jp_wcag_2_2_additional` as the two `jp-public-web` catalog keys and report groups.
Set `active: false` for profiles without generated catalogs.

- [ ] **Step 4: Add the registry schema and shared profile helpers**

The schema must require `catalog_keys` and `groups` when `active` is true.
`recordsForProfile` must concatenate configured catalog arrays in order and reject a missing key.
`groupForRequirement` must require exactly one matching prefix for every registered requirement.

- [ ] **Step 5: Replace hard-coded branches and preserve output**

Generate both active profiles before and after the refactor and compare all generated requirement IDs, method references, group counts, and claim ceilings.
Report labels may become registry-derived, but result counts must not change.

- [ ] **Step 6: Synchronize distributions and run regression tests**

Run: `node .\scripts\sync-distributions.mjs --write`

Run: `node --test .\tests\profile-registry.test.mjs .\tests\audit-workflow.test.mjs .\tests\audit-report.test.mjs`

Expected: PASS with 55 `web-modern` requirements and 56 `jp-public-web` requirements.

- [ ] **Step 7: Commit the profile registry refactor**

```powershell
git add codex/skills/information-accessibility-practice claude/skills/information-accessibility-practice tests/profile-registry.test.mjs
git commit -m "refactor: drive accessibility profiles from registry data"
```

### Task 4: Define Run, Role, Permission, And Artifact Contracts

**Files:**

- Create: `codex/skills/information-accessibility-practice/references/orchestration-registry.json`
- Create: `codex/skills/information-accessibility-practice/references/orchestration-registry.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/audit-run.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/audit-artifact-envelope.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/screening-observations.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/human-review-queue.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/declared-human-review.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/remediation-plan.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/fix-authorization.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/change-record.schema.json`
- Create: `codex/skills/information-accessibility-practice/references/agent-orchestration.md`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs`
- Create: `tests/audit-orchestration-contract.test.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs`
- Generate: corresponding Claude skill files.

**Interfaces:**

- Produces: `validateJsonSchema(value, schema, location = "$", errors = [])` in `scripts/lib/json-schema.mjs`.
- Run manifest: `{ schema_version, run_id, supersedes_run_id, status, target, profile, scope, environment, permissions, resource_versions, artifact_root, artifacts, history, limitations }`.
- Artifact envelope: `{ schema_version, artifact_id, artifact_type, run_id, producer: { role_id, producer_kind, origin }, created_at, inputs, payload }`.
- Registry role: `{ id, agent_id, producer_kind, input_types, output_type, max_ai_evidence_level, can_record_profile_outcome, can_write_target, install_by_default }`.

- [ ] **Step 1: Extract the existing JSON Schema validator with behavior-preserving tests**

Move `validateJsonSchema` and its helper functions from `validate-assessment.mjs` to `scripts/lib/json-schema.mjs`.
Keep the exported signature unchanged and confirm every existing schema rejection test still passes.

- [ ] **Step 2: Write failing contract tests for roles and run records**

```js
test("AI roles cannot record profile outcomes", () => {
  for (const role of registry.roles.filter((item) => item.producer_kind === "ai_agent")) {
    assert.equal(role.can_record_profile_outcome, false, role.id);
    assert.ok(["E0", "E1"].includes(role.max_ai_evidence_level), role.id);
  }
});

test("only the authorized fixer can write the audited target", () => {
  const writers = registry.roles.filter((item) => item.can_write_target);
  assert.deepEqual(writers.map((item) => item.id), ["authorized_fixer"]);
  assert.equal(writers[0].install_by_default, false);
});
```

- [ ] **Step 3: Define the orchestration registry**

Include these roles and artifact types.

| Role ID | Agent ID | Output | Target write | Profile outcome |
| --- | --- | --- | --- | --- |
| `orchestrator` | `information-accessibility-reviewer` | `audit-run` | no | no |
| `e1_inspector` | `information-accessibility-e1-inspector` | `screening-observations` | no | no |
| `human_queue_planner` | `information-accessibility-human-queue-planner` | `human-review-queue` | no | no |
| `declared_external_human` | none | `declared-human-review` | no | yes |
| `remediation_planner` | `information-accessibility-remediation-planner` | `remediation-plan` | no | no |
| `declared_authorizer` | none | `fix-authorization` | no | no |
| `authorized_fixer` | `information-accessibility-authorized-fixer` | `change-record` | yes | no |

Define allowed state transitions in the registry rather than in agent prompts.
Set `declared_authorizer.producer_kind` to `external_requester`, and do not permit any AI role to produce or register `fix-authorization`.

```json
{
  "transitions": [
    { "from": "initialized", "to": "screened", "required_artifact_types": ["screening-observations"] },
    { "from": "screened", "to": "human_queue_ready", "required_artifact_types": ["human-review-queue"] },
    { "from": "human_queue_ready", "to": "human_review_recorded", "required_artifact_types": ["declared-human-review"] },
    { "from": "human_queue_ready", "to": "remediation_ready", "required_artifact_types": ["remediation-plan"] },
    { "from": "human_review_recorded", "to": "remediation_ready", "required_artifact_types": ["remediation-plan"] },
    { "from": "remediation_ready", "to": "fix_authorized", "required_artifact_types": ["fix-authorization"] },
    { "from": "fix_authorized", "to": "retest_required", "required_artifact_types": ["change-record"] }
  ]
}
```

- [ ] **Step 4: Define an immutable audit run manifest**

`artifacts` entries must contain `artifact_id`, `artifact_type`, relative `path`, SHA-256, `producer_role`, `created_at`, and `validation_status`.
`history` entries must contain `from`, `to`, `at`, `actor_role`, and registered artifact IDs.
Permissions must contain separate `network`, `interaction`, `source_write`, `allowed_actions`, and `forbidden_actions` fields.
`resource_versions` must contain the standards registry version, orchestration registry version, and SHA-256 values for the criteria catalog, procedure catalog, and audit-method catalog used by the run.
`supersedes_run_id` must be null for an initial run and must name the `retest_required` predecessor when a source change starts a new run.

- [ ] **Step 5: Define type-specific payload schemas**

`screening-observations` must accept only `SCREEN-*` identifiers and E0/E1 observations.
`human-review-queue` must record each requirement ID, procedure availability, procedure reference, human actions, required evidence types, `cant_tell` conditions, and procedure coverage counts.
`declared-human-review` must carry the declaration text, reviewer name, review date, procedure availability, exact criterion-procedure reference when available, generic method reference and official sources when unavailable, target-specific evidence, and profile outcome while stating that identity is not authenticated.
`remediation-plan` must distinguish `verified_failure` from `unverified_screening_candidate`.
`fix-authorization` must use structured commands with `executable`, `args`, and relative `cwd` instead of shell command strings.
`change-record` must end with `next_status: "retest_required"` and must not contain a profile outcome.
Every artifact envelope `inputs` entry must contain a registered `artifact_id` and its exact SHA-256 from the same run.

- [ ] **Step 6: Document the internal/public boundary**

State that `audit-run` and role artifacts are internal traceability records.
State that `render-audit-report.mjs` consumes only the validated assessment.
State that the later `render-orchestrated-report.mjs` may consume validated run artifacts but never exposes agent identifiers, local paths, Git branches, run IDs, or transition history.

- [ ] **Step 7: Run schema and boundary tests**

Run: `node .\scripts\sync-distributions.mjs --write`

Run: `node --test .\tests\audit-orchestration-contract.test.mjs .\tests\claim-guard.test.mjs .\tests\agent-human-boundary.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit the orchestration contracts**

```powershell
git add codex/skills/information-accessibility-practice claude/skills/information-accessibility-practice tests/audit-orchestration-contract.test.mjs
git commit -m "feat: define accessibility audit orchestration contracts"
```

### Task 5: Implement Deterministic Run Initialization And Artifact Registration

**Files:**

- Create: `codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/create-audit-run.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/validate-audit-run.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/register-audit-artifact.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/merge-audit-artifacts.mjs`
- Create: `tests/audit-orchestration-cli.test.mjs`
- Generate: corresponding Claude skill files.

**Interfaces:**

- Produces: `createAuditRun(options): AuditRun`.
- Produces: `validateAuditRun(run, { skillRoot, runFile }): { valid, errors }`.
- Produces: `registerArtifact(run, artifact, options): AuditRun`.
- Produces: `mergeArtifacts({ run, assessment, artifacts, registries }): AssessmentRecord`.
- Every CLI accepts explicit input and output paths and refuses overwrite.

- [ ] **Step 1: Write failing CLI tests for initialization and immutability**

```js
test("run initialization creates a scoped immutable manifest", () => {
  const result = runNode(createRun, [
    "--run-id", "AUDIT-TEST-001",
    "--profile", "web-modern",
    "--target-name", "Local fixture",
    "--target-version", "fixture-v1",
    "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", artifactRoot,
    "--network", "local_read_only",
    "--interaction", "safe_read_only",
    "--source-write", "none",
    "--output", runV1
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(read(runV1)).status, "initialized");
  assert.equal(fs.existsSync(runV1), true);
});
```

- [ ] **Step 2: Add failing tests for path escape, hash mismatch, duplicate IDs, invalid roles, and invalid transitions**

Test both `../outside.json` and an absolute path outside `artifact_root`.
Test a changed artifact after its hash was recorded.
Test registration by `e1_inspector` of `declared-human-review` and require rejection.
Test registration by every AI role of `fix-authorization` and require rejection.
Test an input artifact ID that is missing, belongs to another run, or has a different SHA-256 and require rejection.
Test an `initialized` to `retest_required` transition and require rejection.

- [ ] **Step 3: Implement path and hash helpers**

```js
export function resolveInside(root, candidate) {
  const absoluteRoot = fs.realpathSync(root);
  const absoluteCandidate = fs.realpathSync(candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Artifact path is outside the declared root: ${candidate}`);
  }
  return absoluteCandidate;
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
```

Allow the run manifest itself to reside outside `artifact_root`, but require every registered artifact inside it.
During initialization, read the installed skill resources and record their registry versions and SHA-256 values in `resource_versions`; do not accept caller-supplied hashes.

- [ ] **Step 4: Implement versioned manifest updates**

`register-audit-artifact.mjs` must read `audit-run.v1.json` and write a caller-supplied `audit-run.v2.json`.
It must never update v1 in place.
Before hashing and registration, validate the common envelope, select the payload schema from the orchestration registry, validate `payload`, and confirm that `producer.role_id` is permitted to produce `artifact_type`.
Resolve every `inputs[*].artifact_id` against the current run and compare its recorded SHA-256 before registering the new artifact.
Sort artifact entries by `artifact_id` and history entries by creation order so registration is deterministic.

- [ ] **Step 5: Implement deterministic merging**

Sort artifacts by `artifact_type` and `artifact_id` before merging.
Screening artifacts may add only `screening_check` results and unverified findings.
Human-review queues do not change assessment outcomes.
Declared external human artifacts may update only their exact registered profile rows and must pass the existing assessment validator after merging.
Remediation plans and change records do not change assessment outcomes.

- [ ] **Step 6: Prove input order does not change merged output**

Register the same two screening artifacts in opposite input orders, merge them, and compare SHA-256 of the generated assessments.
Expected: identical bytes.

- [ ] **Step 7: Run CLI and baseline tests**

Run: `node .\scripts\sync-distributions.mjs --write`

Run: `node --test .\tests\audit-orchestration-cli.test.mjs .\tests\audit-workflow.test.mjs .\tests\claim-guard.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit deterministic orchestration**

```powershell
git add codex/skills/information-accessibility-practice claude/skills/information-accessibility-practice tests/audit-orchestration-cli.test.mjs
git commit -m "feat: add deterministic accessibility audit runs"
```

### Task 6: Add The Read-Only Specialist Agents

**Files:**

- Modify: `shared/agents/agent-manifest.json`
- Modify: `shared/agents/information-accessibility-reviewer.md`
- Create: `shared/agents/information-accessibility-e1-inspector.md`
- Create: `shared/agents/information-accessibility-human-queue-planner.md`
- Create: `shared/agents/information-accessibility-remediation-planner.md`
- Create: `tests/agent-role-contracts.test.mjs`
- Generate: four Codex agent files and four Claude agent files.

**Interfaces:**

- Public entry: `information-accessibility-reviewer`.
- Inspector output: candidate `screening-observations` envelope; the orchestrator materializes, validates, and registers it.
- Queue planner output: candidate `human-review-queue` envelope; the orchestrator materializes, validates, and registers it.
- Remediation planner output: candidate `remediation-plan` envelope; the orchestrator materializes, validates, and registers it.
- Orchestrator output: versioned `audit-run`, validated assessment, and public report.

- [x] **Step 1: Write failing prompt-contract tests before adding agents**

```js
test("read-only agents cannot claim profile results or source writes", () => {
  for (const id of [
    "information-accessibility-e1-inspector",
    "information-accessibility-human-queue-planner",
    "information-accessibility-remediation-planner"
  ]) {
    const body = read(`shared/agents/${id}.md`);
    assert.match(body, /must not record `pass`, `fail`, or `not_applicable` on profile rows/);
    assert.match(body, /must not modify the audited target/);
    assert.match(body, /validated artifact/);
  }
});
```

- [x] **Step 2: Run the test and confirm all three bodies are missing**

Run: `node --test .\tests\agent-role-contracts.test.mjs`

Expected: FAIL with missing specialist body files.

- [x] **Step 3: Convert the existing reviewer into a backward-compatible orchestrator**

Retain its public description and broad target routing.
Replace direct specialist work with these responsibilities: initialize the run, dispatch only applicable roles, validate returned artifacts, register them, merge deterministically, validate the assessment, and render the public report.
Allow a local fallback when subagent dispatch is unavailable, but require the same role artifact contracts and boundaries.

- [x] **Step 4: Add the E1 inspector contract**

Require exact target version, environment, location, observation time, limitation, and evidence reference.
Allow only E0/E1 and `SCREEN-*` observations.
Allow run permissions to add only non-state-changing reading actions such as navigation, expansion, focus movement, and inspection.
Prohibit authentication, form submission, state-changing interaction, source edits, and profile outcomes unconditionally for the E1 inspector.

- [x] **Step 5: Add the human queue planner contract**

Require one `show-requirement.mjs` lookup per queued requirement.
Record `criterion_procedure_status` as `available` or `not_available`.
For unavailable procedures, retain the generic method and official-source boundary and do not describe the criterion as executable or evaluated.
Calculate `available`, `not_available`, and total queue counts.

- [x] **Step 6: Add the remediation planner contract**

Accept only validated assessment findings and validated screening observations.
Label profile failures as `verified_failure` only when they came from a declared external human artifact and survived assessment validation.
Label AI screening findings as `unverified_screening_candidate`.
Produce location, affected users, proposed change, owner when supplied, verification method, and residual limitation without editing source.

- [x] **Step 7: Render and verify all distributions**

Run: `node .\scripts\sync-distributions.mjs --write`

Run: `node --test .\tests\agent-role-contracts.test.mjs .\tests\agent-human-boundary.test.mjs .\tests\distribution-sync.test.mjs`

Expected: PASS with `agent_count: 4` and equal normalized bodies on both platforms.

- [x] **Step 8: Commit the read-only agent set**

```powershell
git add shared/agents codex/agents claude/agents tests/agent-role-contracts.test.mjs
git commit -m "feat: split accessibility audit read-only roles"
```

**Implemented:** The initial role split was committed at `29c1b81`. Runtime contract hardening and the run-backed public report were completed through `99acd2c`. Specialists now return candidate envelope JSON and cannot write artifact files; only the orchestrator materializes and registers candidates. Current run 3.0.0 binds queue/remediation payload version 2 to exact registered evidence, while legacy versions remain read-only. The public report validates run, assessment, and registered artifact bytes and rejects internal orchestration identifiers. Final verification: 196 tests, 194 pass, 0 fail, and 2 Windows `EPERM` symlink tests skipped rather than counted as verified. Independent Task 6 spec and code-quality review approved with no findings.

### Task 7: Install And Roll Back Multiple Agents From The Manifest

**Files:**

- Modify: `scripts/install-codex.ps1`
- Modify: `tests/install-codex.test.mjs`
- Modify: `README.md`

**Interfaces:**

- Installer reads `shared/agents/agent-manifest.json`.
- Default installation selects `install_by_default: true` agents.
- `-IncludeAuthorizedFixer` opts into the fixer after Task 8.
- Backup folder contains `skill/` and `agents/<agent-id>.toml` for every replaced agent.
- Rollback restores only package-managed agent IDs and leaves unrelated agents untouched.

- [x] **Step 1: Expand the installer test to expect the manifest-selected agent set**

```js
const manifest = readJson("shared/agents/agent-manifest.json");
const defaultAgents = manifest.agents.filter((item) => item.install_by_default);
for (const agent of defaultAgents) {
  assert.equal(
    sha256(path.join(codexHome, "agents", `${agent.id}.toml`)),
    sha256(path.join(root, "codex", "agents", `${agent.id}.toml`))
  );
}
assert.equal(fs.readFileSync(unrelatedAgent, "utf8"), "user-owned\n");
```

- [x] **Step 2: Run the installer test and confirm the hard-coded single-agent behavior fails**

Run: `node --test .\tests\install-codex.test.mjs`

Expected: FAIL because only `information-accessibility-reviewer.toml` is staged and backed up.

- [x] **Step 3: Replace singular agent paths with a manifest-selected collection**

Resolve every source and destination path before staging.
Reject duplicate IDs and paths outside the package's `codex/agents` directory.
Print selected agent IDs in `-WhatIf` output.

- [x] **Step 4: Preserve atomic staging and rollback**

Back up existing managed agents before replacing any destination.
If copying any agent fails, restore every replaced managed agent and the skill.
Do not enumerate or delete unrelated files in the user's `agents` directory.

- [x] **Step 5: Test partial-old-version and rollback cases**

Prepare a fake Codex home containing an old reviewer, no inspector, an old remediation planner, and one unrelated agent.
After install, require current hashes for all default agents and unchanged bytes for the unrelated agent.
Force a staged copy failure and require every pre-existing managed agent to be restored.

- [x] **Step 6: Run installer and package tests**

Run: `node --test .\tests\install-codex.test.mjs .\tests\distribution-sync.test.mjs`

Expected: PASS.

Run: `node .\scripts\verify-package.mjs`

Expected: PASS with four agents.

- [x] **Step 7: Commit multi-agent installation**

```powershell
git add scripts/install-codex.ps1 tests/install-codex.test.mjs README.md
git commit -m "feat: install accessibility agent set atomically"
```

**Implemented:** Manifest-selected installation was completed through `96d731f`. Default installation deploys the four read-only agents, preserves unrelated agents, supports verified backup and rollback of only managed destinations, rejects path overlap and reparse redirection before `-WhatIf` or staging, and handles a fresh nonexistent `CodexHome`. Partial-copy failures restore original bytes and remove installer-owned transaction residue. Final verification: 207 tests, 205 pass, 0 fail, and 2 Windows `EPERM` symlink tests skipped rather than counted as verified. Independent code-quality and security reviews approved with no findings.

### Task 8: Add The Opt-In Authorized Fixer

**Implementation refinement:** Task 8 is executed as three reviewable commits. Task 8A freezes the current registry 2.0.0, audit-run 3.0.0, fix-authorization 1.0.0, and change-record 1.0.0 contracts as read-only, then introduces registry 3.0.0, audit-run 4.0.0, and payload 2.0.0 contracts without inferring new permissions for legacy artifacts. Task 8B adds the authorization, transaction, verification-command, lease, and retest-run runtime. Task 8C adds the non-default fixer agent and opt-in installation. This version boundary is required because existing run 3.0.0 manifests bind the exact registry 2.0.0 hash; changing that registry in place would invalidate previous runs.

The fixer does not freely edit and then draft its own evidence. A deterministic transaction CLI validates an externally declared authorization, acquires the source-root lease, applies only the authorized operation, runs only authorization-sourced structured verification commands with `shell: false`, writes a measured change-record artifact, records authorization consumption, and releases the lease. The orchestrator registers that completed artifact after the lease is released. Legacy authorization and change-record payloads remain readable but cannot authorize current writes.

**Files:**

- Modify: `shared/agents/agent-manifest.json`
- Create: `shared/agents/information-accessibility-authorized-fixer.md`
- Create: `codex/skills/information-accessibility-practice/scripts/validate-fix-authorization.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/fix-lease.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/acquire-fix-lease.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/release-fix-lease.mjs`
- Create: `tests/authorized-fixer.test.mjs`
- Modify: `scripts/install-codex.ps1`
- Modify: `tests/install-codex.test.mjs`
- Generate: fixer agent files and the mirrored validation script.

**Interfaces:**

- Fix authorization: `{ run_id, source_root, allowed_paths, allowed_operations, verification_commands, approved_by, approved_at }`.
- Validation CLI: `node scripts/validate-fix-authorization.mjs --authorization <file> --target <path>`.
- Lease CLI: `node scripts/acquire-fix-lease.mjs --authorization <file> --run-id <id> --output <lease.json>` and `node scripts/release-fix-lease.mjs --lease <lease.json> --run-id <id>`.
- Fixer output: validated `change-record` artifact with changed files, diff hash, command results, and `next_status: "retest_required"`.
- Installer flag: `-IncludeAuthorizedFixer`.

- [ ] **Step 1: Write denial-first tests**

```js
for (const missing of ["source_root", "allowed_paths", "allowed_operations", "verification_commands", "approved_by", "approved_at"]) {
  test(`fix authorization rejects missing ${missing}`, () => {
    const value = validAuthorization();
    delete value[missing];
    assert.equal(validateAuthorization(value).valid, false);
  });
}

test("fix authorization rejects a target outside the source root", () => {
  const result = validateTarget(validAuthorization(), outsideFile);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /outside the authorized source root/);
});

test("AI roles cannot produce or register fix authorization", () => {
  for (const role of registry.roles.filter((item) => item.producer_kind === "ai_agent")) {
    assert.notEqual(role.output_type, "fix-authorization", role.id);
  }
});
```

- [ ] **Step 2: Run the fixer tests and confirm the validator and agent are missing**

Run: `node --test .\tests\authorized-fixer.test.mjs`

Expected: FAIL with missing validator and agent definition.

- [ ] **Step 3: Implement structured authorization validation**

Resolve the source root with `realpath` and verify every candidate file remains inside it.
For a permitted new file, resolve its existing parent with `realpath` before joining the new basename; do not call `realpath` on a nonexistent candidate.
Match normalized relative paths against `allowed_paths` without shell expansion.
Allow `create`, `modify`, and `delete` only when each operation is explicitly listed.
Keep verification commands as executable and argument arrays; do not accept compound shell strings.
Require the authorization envelope to use producer role `declared_authorizer` and origin `external_input`.
State in validation output that the package verifies structure and provenance fields but does not authenticate the named approver; the operator remains responsible for trusting the authorization.

- [ ] **Step 4: Add source-root lease acquisition and conflict tests**

Hash the canonical real path of `source_root` and use it as the lock name under a configurable lock directory whose default is the operating system temporary directory.
Normalize Windows drive-letter casing before hashing.
Acquire the lock with `fs.openSync(lockPath, "wx")` and record `run_id`, process ID, source-root hash, and acquisition time.
Reject a second acquisition for the same source root even when it uses a different artifact root.
Release only when the lease run ID matches.
Set `expires_at` to 120 minutes after acquisition.
Do not break an existing lease automatically; allow `--recover-expired --expected-run-id <id>` only after `expires_at`, and record that recovery in the change record.

Run two acquisition processes in parallel against the same temporary source root.
Expected: exactly one PASS and one conflict failure, with no target file changes.

- [ ] **Step 5: Add the fixer prompt contract**

Require a clean or explicitly inventoried worktree before edits.
Preserve unrelated changes.
Reject missing authorization before any file write.
Acquire the source-root lease before the first file write and release it after the change record is written.
Record the actual diff and command exit codes.
Prohibit `pass`, `fail`, `human_verified`, E2 elevation, and conformance wording.
End in `retest_required` even when every verification command succeeds.

- [ ] **Step 6: Start retesting as a new immutable run**

After a change record sets the old run to `retest_required`, create a new run ID with the new target version or commit and `supersedes_run_id` pointing to the old run.
Do not copy old screening, human-review, or remediation artifacts into the new run.
The new run starts at `initialized`, records fresh resource hashes, and follows the normal E1 and human-queue stages.
Test that merging an artifact from the superseded run into the new run is rejected.

- [ ] **Step 7: Keep the fixer out of default installation**

Set `install_by_default` to `false` in the manifest.
Require `-IncludeAuthorizedFixer` to stage or replace it.
Test that default installation leaves an existing user-owned fixer untouched, while opt-in installation backs it up and replaces it.

- [ ] **Step 8: Run security-focused and full tests**

Run: `node .\scripts\sync-distributions.mjs --write`

Run: `node --test .\tests\authorized-fixer.test.mjs .\tests\install-codex.test.mjs .\tests\agent-role-contracts.test.mjs`

Expected: PASS with five packaged agents and four default-installed agents.

- [ ] **Step 9: Request a security review before committing**

The reviewer must inspect path containment, structured command handling, symlink behavior, lease conflicts and recovery, external authorization provenance, worktree preservation, and rollback.
Resolve every P0/P1 finding before the commit.

- [ ] **Step 10: Commit the opt-in fixer**

```powershell
git add shared/agents codex/agents claude/agents codex/skills/information-accessibility-practice claude/skills/information-accessibility-practice scripts/install-codex.ps1 tests/authorized-fixer.test.mjs tests/install-codex.test.mjs
git commit -m "feat: add opt-in authorized accessibility fixer"
```

### Task 9A: Generalize Safe Read-Only Orchestration Extensions

**Rationale:** The distribution manifest could add agents, but registry 3.0.0, audit-run 4.0.0, and artifact-envelope 1.0.0 fixed all role, artifact, state, and producer identifiers in JSON Schema. That made the runtime contract itself non-extensible. This task adds a version boundary before the forward test so a safe read-only specialist can be added without editing core schema enumerations.

**Files:**

- Freeze: `orchestration-registry-3.0.0.json` and its schema.
- Freeze: `audit-run-4.0.0.schema.json`.
- Freeze: `audit-artifact-envelope-1.0.0.schema.json`.
- Modify: current registry to 4.0.0, audit-run to 5.0.0, and artifact envelope to 2.0.0.
- Modify: `scripts/lib/audit-run.mjs` for version dispatch and central semantic validation.
- Create: `tests/orchestration-extensibility.test.mjs`.

**Interfaces and invariants:**

- Current schemas validate safe identifier syntax and structural shape; the installed registry is the authority for role, producer, output, payload, and transition meaning.
- The seven canonical roles remain byte-equivalent to frozen registry 3.0.0.
- Additional roles must be read-only AI roles limited to E0 or E1, without profile outcomes, target writes, orchestration output, authorization output, or change output.
- `authorized_fixer` remains the only writer and is not installed by default. `declared_authorizer` remains the only producer of `fix-authorization`.
- Every artifact type has a payload schema, a producer, and a single-artifact transition. Duplicate identifiers, ambiguous routes, unreachable states, and cycles are rejected before a run is accepted.
- Runs 1 through 4 and envelope 1 remain readable through exact version dispatch. Only run 5 with registry 4 and envelope 2 is operational.

- [x] **Step 1: Add RED tests for frozen versions and safe extension**
- [x] **Step 2: Freeze registry 3, run 4, and envelope 1 without changing their bytes**
- [x] **Step 3: Add registry 4, run 5, envelope 2, and central semantic validation**
- [x] **Step 4: Prove an eighth safe role and a new schema-backed artifact type**
- [x] **Step 5: Prove privilege escalation, producer spoofing, ambiguous transitions, cycles, and unreachable states fail closed**
- [x] **Step 6: Run distribution synchronization, package verification, and the full regression suite**

### Task 9: Prove The Architecture With A Generic Forward Test

**Files:**

- Create: `tests/fixtures/multi-agent-site/index.html`
- Create: `tests/fixtures/multi-agent-site/app.js`
- Create: `tests/fixtures/multi-agent-run/screening-observations.json`
- Create: `tests/fixtures/multi-agent-run/human-review-queue.json`
- Create: `tests/fixtures/multi-agent-run/remediation-plan.json`
- Create: `tests/multi-agent-forward.test.mjs`
- Modify: `codex/skills/information-accessibility-practice/SKILL.md`
- Modify: `codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs`
- Modify: `README.md`
- Generate: corresponding Claude skill files.

**Interfaces:**

- Test request: local public-like URL, `web-modern`, read-only E1, no authentication, no source write.
- Expected outputs: initialized run, screening artifact, human queue, remediation plan, merged assessment, public report.
- Report CLI: use the installed `render-audit-report.mjs` run-backed mode with the exact registered artifact set.
- Denial test: fixer requested without authorization and no fixture bytes change.

- [ ] **Step 1: Create a minimal generic fixture with known screenable and human-only questions**

Include one informative image with no text alternative, one custom keyboard-sensitive control, and one visually grouped structure whose programmatic relationship requires human inspection.
Do not label the fixture as conformant or nonconformant in source comments.

- [ ] **Step 2: Write the end-to-end failing test**

```js
test("read-only orchestration preserves profile outcomes and produces three public categories", () => {
  const assessment = readJson(mergedAssessment);
  assert.equal(assessment.assessment.results.filter((item) => item.requirement_kind === "profile_requirement").every(
    (item) => item.outcome === "not_tested" && item.mapping_status === "unverified"
  ), true);
  const report = read(publicReport);
  assert.match(report, /Observed|観測/);
  assert.match(report, /Improvement|改善/);
  assert.match(report, /Human review|人が確認/);
  assert.doesNotMatch(report, /information-accessibility-e1-inspector|codex\/|claude\/|git branch/);
});
```

- [ ] **Step 3: Run the test before adding orchestration guidance**

Run: `node --test .\tests\multi-agent-forward.test.mjs`

Expected: FAIL because the skill does not yet route through role artifacts.

- [ ] **Step 4: Update the skill's core workflow without duplicating role details**

Keep the role selection and artifact sequence in `SKILL.md`.
Link to `references/agent-orchestration.md` for schemas, state transitions, CLI commands, and failure recovery.
Do not copy each agent prompt into the skill.

- [ ] **Step 5: Render the three public result categories from assessment data**

Add a backward-compatible orchestration report renderer instead of changing `render-audit-report.mjs`.
Validate the run, assessment, and remediation artifact before rendering and refuse an existing output.
Add report sections for observed screening evidence, improvement items, and human confirmation required.
Derive observations from `screening_check` results, improvements from validated remediation-plan items, and human confirmation from profile `not_tested` and `cant_tell` rows.
Keep profile outcomes, screening outcomes, catalog coverage, and evaluation coverage as separate counts.
Do not expose producer roles, run IDs, internal artifact paths, or state-transition history.

- [ ] **Step 6: Verify the denial and public-report boundaries**

Hash every fixture file before and after the unauthorized-fix test.
Require identical hashes.
Require the internal run to retain producer roles and artifact hashes while the public report omits them.

- [ ] **Step 7: Run every verification gate**

Run: `node .\scripts\build-criteria-catalog.mjs --check`

Expected: PASS without network access.

Run: `node .\scripts\sync-distributions.mjs --check`

Expected: PASS with no stale generated files.

Run: `node --test .\tests\*.test.mjs`

Expected: all tests pass, including the original 45 tests.

Run: `node .\scripts\verify-package.mjs`

Expected: PASS with five packaged agents, four default-installed agents, equal generated bodies, all JSON parsed, and mirrored shared skill files.

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 8: Perform independent outward-language and architecture reviews**

The outward-language review must reject branch names, development history, target-specific private evidence, and author-directed wording in reusable public artifacts.
The architecture review must confirm that a new read-only role can be added through one manifest body, one registry role, one payload schema, and tests without changing existing specialist prompts.

- [ ] **Step 9: Commit the integrated read-only workflow**

```powershell
git add tests/fixtures tests/multi-agent-forward.test.mjs codex/skills/information-accessibility-practice claude/skills/information-accessibility-practice README.md
git commit -m "test: add multi-agent accessibility forward workflow"
```

## Execution Order And Gates

```text
Task 1 reproducible maintenance gate
  -> Task 2 distribution source
  -> Task 3 profile registry
  -> Task 4 orchestration contracts
  -> Task 5 deterministic run tools
  -> Task 6 read-only agents
  -> Task 7 multi-agent installer
  -> M4-3 SC 2.1.1 and SC 4.1.2 procedure extension
  -> Task 8 opt-in authorized fixer
  -> Task 9 generic forward test
```

M4-3 runs after Task 7 and before Task 8.
SC 2.1.1 and SC 4.1.2 must appear in the human-review queue without changing any agent prompt; that is the first extension proof for the registry-driven design.
M5 E3 evidence work starts only after Task 9 because E3 requires the run manifest and human evidence handoff to be stable.

**M4-3 implemented:** Commits `5447363..863b4ab` added original human-review procedures for WCAG 2.2 SC 2.1.1 and SC 4.1.2 through the criterion procedure catalog and generated skill mirrors only. Existing exact lookup produced two available bindings, and a two-item queue registered with `2/2/0` coverage without runtime, queue-schema, or agent-prompt changes. SC 4.1.2 separately tests accessibility-interface programmatic setting and change notification. Final verification: 210 tests, 208 pass, 0 fail, and 2 Windows `EPERM` symlink tests skipped rather than counted as verified. Independent code and standards reviews approved with no findings.

## Maintenance Acceptance Criteria

- Adding a read-only agent requires one shared body, one manifest entry, one role-registry entry, one payload schema when its output is new, and focused tests.
- Adding an active profile requires registry and catalog data changes without profile-ID branches in generation, validation, or reporting.
- Routine tests and package verification run offline.
- Primary-source refresh creates a candidate and a machine-readable diff; it never silently updates canonical catalogs.
- Every generated Codex and Claude artifact is reproducible from declared sources.
- Existing local agents unrelated to this package survive installation and rollback unchanged.

## Safety Acceptance Criteria

- AI artifacts cannot record profile `pass`, `fail`, `not_applicable`, `human_verified`, or E2 and above.
- Human-review identity remains declared, not authenticated, until a separate attestation design is implemented.
- Artifact hash mismatch, duplicate ID, unregistered role, invalid state transition, and path escape are rejected.
- Source writes require a complete authorization record and a single fixer.
- A successful source patch returns to E1 screening and human review instead of creating a conformance claim.
- Public reports contain target evidence, limitations, remediation, and retest instructions without internal orchestration history.
