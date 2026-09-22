import fs from "node:fs";
import path from "node:path";

function option(flag, value, description) {
  return { flag, value, description };
}

const definitions = [
  {
    name: "artifact", script: "create-audit-artifact.mjs",
    summary: "Wrap a completed payload in a run-bound candidate, or check it before registration.",
    usage: [
      "accessibility-audit artifact init --run <run.json> --type <type> --payload <payload.json> [--input <registered-ART-id>] [--artifact-id <ART-id>] --output <artifacts/new-candidate.json>",
      "accessibility-audit artifact validate --run <run.json> --artifact <artifacts/candidate.json>"
    ],
    notes: ["Types: screening-observations, human-review-queue, declared-human-review, remediation-plan. --input is repeatable.",
      "The CLI fills envelope metadata and omitted payload schema_version. Supply actual observations, review declarations or proposals in --payload; none are invented.",
      "Human review payloads must be the reviewer's actual declaration; AI agents must not write human outcomes or evidence on their behalf. Metadata does not authenticate identity.",
      "Creates a private candidate only; register performs live target checks. Prefer review-queue and human-review export/import for guided authoring. See references/agent-orchestration.md."]
  },
  {
    name: "review-queue", script: "create-human-review-queue.mjs",
    summary: "Create a target-bound human review candidate from registered observations and explicit requirements.",
    usage: ["accessibility-audit review-queue --run <run.json> --artifact-id <ART-id> --output <artifacts/new-queue.json> [--scope screening|profile_all] [--requirement <profile-requirement-id>]"],
    notes: ["--requirement is repeatable. Priorities start unprioritized; review reasons, target locations and required state before registration.",
      "Creates a private candidate only. It does not perform human review, register evidence, or change the audit run. See references/human-review-queue.md."]
  },
  {
    name: "audit-bundle", script: "audit-bundle.mjs",
    summary: "Prepare or verify offline commitments to audit files and a signed predecessor chain.",
    usage: [
      "accessibility-audit audit-bundle prepare --root <directory> --run <run.json> --assessment <assessment.json> --report <report.md|html> --output <new-private-record.json>",
      "accessibility-audit audit-bundle verify --root <directory> --record <private-record.json> [trust options]"
    ],
    options: [
      option("--report", "<file>", "Prepare: 1–16 explicit reports; repeat for multiple formats."),
      option("--attachment", "<file>", "Prepare: explicitly retained source/capture file; repeatable."),
      option("--predecessor", "<record.json>", "Repeat for earlier signed records; prepare takes the immediate predecessor first."),
      option("--require-complete-chain", "", "Reject any superseded run without a predecessor signature."),
      option("--trust-policy", "<policy.json>", "Recipient-selected external signer policy."),
      option("--trust-policy-sha256", "<SHA-256>", "Independently trusted canonical policy digest; required with policy."),
      option("--minimum-assurance", "<level>", "Verify: unsigned, self_signed, signed, organization_attested or independent; applies to every link."),
      option("--expected-subject-sha256", "<SHA-256>", "Verify: recipient-selected current bundle digest, to reject an older valid record.")
    ],
    notes: ["All committed files must be inside --root. Paths supplied on the CLI resolve from the working directory.",
      "No keys are created, no data is uploaded, and no conformance tier is elevated. Historical file bytes and trusted timestamps are not verified.",
      "See references/audit-bundle-attestation.md for the signed format, offline trust and archival limits."]
  },
  {
    name: "human-review", script: "human-review.mjs",
    summary: "Export/import human review worksheets; prepare, verify or apply portable review records.",
    usage: [
      "accessibility-audit human-review prepare --assessment <assessment.json> --review <declared-review.json> --reviewer-id <id> --output <new-record.json>",
      "accessibility-audit human-review export --run <run.json> --queue <registered-queue-id> --format xlsx|csv|markdown --output <new-sheet>",
      "accessibility-audit human-review import --run <run.json> --queue <registered-queue-id> --input <completed-sheet> --output <new-artifact.json> [--artifact-id <id>]",
      "accessibility-audit human-review prepare --run <run.json> --artifact-id <id> --reviewer-id <id> --output <new-record.json>",
      "accessibility-audit human-review verify --record <record.json> --assessment <assessment.json> [trust options]",
      "accessibility-audit human-review apply --record <record.json> --assessment <assessment.json> --output <new-assessment.json> [trust options]"
    ],
    notes: ["Trust options: --trust-policy <recipient-selected.json> --trust-policy-sha256 <independent canonical SHA-256> [--minimum-assurance signed].",
      "Verify also accepts --run and --artifact-id. Run-backed results are applied by merge --review-record.",
      "No signing keys are created. Stored flags, self-signed keys and declarations never authenticate a person. See references/reviewer-assurance.md."]
  },
  {
    name: "network-policy", script: "propose-network-policy.mjs",
    summary: "Propose concrete target and official-source network scopes without granting or using network access.",
    usage: ["accessibility-audit network-policy [--target <URL>] [--exact-target <URL>] [--include-official-sources true] [--profile <id>] [--method GET|HEAD] [--allow-localhost true] [--output <new-policy.json>]"],
    notes: ["Targets, exact targets and methods are repeatable. Review the proposal before passing its file to init --network-policy.",
      "Official sources are exact registered URLs in a separate purpose scope. A policy file never grants caller authority."]
  },
  {
    name: "import", script: "import-scanner-results.mjs",
    summary: "Import native axe-core results as private, run-bound screening candidates.",
    usage: ["accessibility-audit import axe --run <bound-run.json> --input <artifacts/axe.json> --output <artifacts/new-screening.json> [--target-ref <declared-URL>] [--configuration <artifacts/config.json>] [--record-output <artifacts/new-import.json>] [--artifact-id <ART-id>]"],
    notes: ["Preserves every result category, unknown rules and raw evidence. No profile pass/fail is inferred.",
      "Requires a bound saved web_state. Native JSON has caller-declared capture association; scan-web exports additionally bind the saved bundle hash.",
      "Creates candidates only. Register the artifact, then provide the required human-review queue before merge."]
  },
  {
    name: "bind-targets", script: "bind-run-targets.mjs",
    summary: "Remeasure and bind a target inventory once, before any artifact registration.",
    usage: ["accessibility-audit bind-targets --run <unbound-run.json> --targets <artifacts/targets.json> [--allow-origin <origin>] [--allow-url <exact-URL>] [--allow-localhost true] [--network-log-output <artifacts/network.json>] --output <new-bound-run.json>"],
    notes: ["The output stays beside the input run. Changing a bound inventory requires a fresh run. HTTP origins must be explicitly authorized again."]
  },
  {
    name: "compare-targets", script: "compare-run-targets.mjs",
    summary: "Compare the measured identities of two bound runs without contacting live targets.",
    usage: ["accessibility-audit compare-targets --before <run.json> --after <run.json> --output <after-artifacts/new-target-comparison.json>"],
    notes: ["Private output describes identity and environment changes, not accessibility outcomes. Both runs require measured target inventories."]
  },
  {
    name: "capture-targets",
    script: "capture-run-targets.mjs",
    summary: "Measure file, Git, HTTP or saved web-state identities into a private run companion.",
    usage: ["accessibility-audit capture-targets --run <run.json> --specs <target-specs.json> [--allow-origin <origin>] [--allow-url <exact-URL>] [--allow-localhost true] [--network-log-output <artifacts/network.json>] --output <artifacts/new-targets.json>"],
    notes: ["Target specifications must cover exactly the declared run references. Local relative paths resolve beside the run manifest.",
      "HTTP requires a concrete run policy, explicit caller origin/URL authorization and --network-log-output. Every redirect is checked. No credentials, cookies or JavaScript are used.",
      "This creates an unregistered private companion. Use bind-targets before registering observations. See references/measured-targets.md."]
  },
  {
    name: "bind-evidence",
    script: "bind-audit-evidence.mjs",
    summary: "Bind an existing private evidence file to one draft screening observation.",
    usage: ["accessibility-audit bind-evidence --run <run.json> --artifact <draft.json> --observation <SCREEN-id> --file <saved-file> --type <dom_snapshot|accessibility_tree|screenshot|interaction_log|network_log|other> --target-ref <declared-target> --captured-at <RFC3339> [--snapshot-id <id>] --output <new-artifact.json>"],
    notes: ["Drafts use screening-observations 4.0.0 and evidence_refs arrays. Bind every E1 observation before registration.", "Files and outputs stay within the artifact root. The command preserves observations and evidence levels; it does not inspect targets or authenticate the capture."]
  },
  {
    name: "compare-evidence",
    script: "compare-audit-evidence.mjs",
    summary: "Compare validated saved evidence before and after a change, for private review.",
    usage: ["accessibility-audit compare-evidence --before <run.json> --after <run.json> --output <new-private-comparison.json>"],
    notes: ["Both runs and their saved files are revalidated. Results describe byte changes, not accessibility outcomes."]
  },
  {
    name: "status",
    script: "show-audit-status.mjs",
    summary: "Read run state, evidence coverage, validation, successor warnings and next operations.",
    usage: ["accessibility-audit status --run <run.json> [--retest-of <predecessor-run.json>] [--format text|json] [--locale ja|en]"],
    options: [option("--run", "<run.json>", "Run manifest to inspect without modification."),
      option("--format", "<text|json>", "Text or versioned JSON output. Default: text."),
      option("--locale", "<ja|en>", "Human-readable locale. JSON field names stay stable.")],
    notes: ["Read-only: no transition, target interaction or artifact write is performed.",
      "Successor discovery is limited to sibling JSON files. Report availability means a matching assessment can be rendered, not that inspection is complete."]
  },
  {
    name: "init",
    script: "create-audit-run.mjs",
    summary: "Create a new immutable audit run.",
    usage: [
      "accessibility-audit init --run-id <id> --profile <id> --inspection-mode <quick|detailed> --inspection-purpose <purpose> --target-name <name> --target-version <version> --target-ref <url|file> --artifact-root <directory> --network <none|local_read_only> --interaction <safe_read_only|human_supervised> --source-write <none|authorized_only> [--config <scope-environment.json>] --output <new-run.json>"
    ],
    options: [
      option("--run-id", "<id>", "Unique run ID."),
      option("--profile", "<id>", "Active standards profile. Use `profiles list` to discover values."),
      option("--inspection-mode", "<quick|detailed>", "Choose a quick check or a detailed inspection for remediation before inspecting."),
      option("--inspection-purpose", "<purpose>", "Describe how the requester will use the report."),
      option("--target-name", "<name>", "Human-readable target name."),
      option("--target-version", "<version>", "Declared target version or commit."),
      option("--target-ref", "<url|file>", "Target URL or file. Repeat for additional target references."),
      option("--artifact-root", "<directory>", "Existing private directory for run artifacts."),
      option("--network", "<none|local_read_only>", "Network policy alias. `none` denies access; `local_read_only` maps to an allowlisted read policy."),
      option("--network-policy", "<policy.json>", "Required for allowlisted/local_read_only: explicit origins or exact URLs, GET/HEAD and redirect/resource policy. Propose with network-policy."),
      option("--interaction", "<safe_read_only|human_supervised>", "Interaction policy alias."),
      option("--interaction-policy", "<policy.json>", "Required for human_supervised: concrete operations, supervisor, scope, expiry and approval mode. A saved policy does not authorize runtime interaction."),
      option("--source-write", "<none|authorized_only>", "Source-write policy. Standard audits normally use `none`."),
      option("--config", "<file>", "Optional JSON file declaring scope and/or environment."),
      option("--supersedes-run", "<file>", "Validated predecessor required only for retest initialization."),
      option("--output", "<new-run.json>", "New output path; existing files are never overwritten.")
    ],
    notes: [
      "The artifact root must already exist and must not traverse a symbolic link or reparse point.",
      "Inspection mode and purpose are required for new inspections. Retests inherit an existing request; changing it requires a separate inspection.",
      "Initialization records scope and permissions but does not inspect the target or create a profile outcome."
    ]
  },
  {
    name: "assessment",
    script: "generate-assessment.mjs",
    summary: "Create a validator-valid assessment record or an explicit placeholder template.",
    usage: [
      "accessibility-audit assessment --profile <id> --target-name <name> --target-version <version> --target-ref <url|file> --evaluator <name> --evaluated-at <YYYY-MM-DD> --output <assessment.json>",
      "accessibility-audit assessment --template --profile <id> --output <assessment.template.json>"
    ],
    options: [
      option("--profile", "<id>", "Active standards profile."),
      option("--target-name", "<name>", "Required in record mode."),
      option("--target-version", "<version>", "Required in record mode."),
      option("--target-ref", "<url|file>", "Required in record mode; repeatable."),
      option("--evaluator", "<name>", "Required in record mode."),
      option("--evaluated-at", "<YYYY-MM-DD>", "Calendar date for the record."),
      option("--assessment-id", "<unique-id>", "Optional assessment identity. The default is a fresh UUID-based ID; never reuse an ID for another target or scope."),
      option("--template", "", "Create an editable placeholder, not a validated inspection record."),
      option("--output", "<file>", "New output path.")
    ],
    notes: ["All profile rows begin as `not_tested`; creation is not a completed inspection."]
  },
  {
    name: "scan-web",
    script: "scan-web.mjs",
    summary: "Run rule-based browser checks and create a compact AI review context.",
    usage: [
      "accessibility-audit scan-web --url <http-or-https-url> --profile <active-profile> --output <new-scan.json> [--context-output <new-context.json>] [--allow-origin <origin>] [--allow-localhost] [--focus-steps <0-50>] [--width <240-7680>] [--height <240-7680>] [--reflow-width <240-1280>]"
    ],
    options: [
      option("--url", "<URL>", "Public HTTP(S) target URL."),
      option("--profile", "<id>", "Active Web profile."),
      option("--output", "<file>", "Full internal scan artifact."),
      option("--context-output", "<file>", "Optional compact AI context."),
      option("--axe-output", "<file>", "Private native axe results with capture and per-frame execution metadata; requires --evidence-output."),
      option("--evidence-output", "<file>", "Private saved web bundle for capture-targets; requires --axe-output."),
      option("--browser-channel", "<chrome>", "Use installed system Chrome explicitly instead of the default browser runtime."),
      option("--allow-origin", "<origin>", "Additional explicit origin; repeatable."),
      option("--allow-url", "<exact-URL>", "Explicit exact URL including query; repeatable."),
      option("--run", "<run.json>", "Enforce a validated run policy as well as explicit caller grants. Requires --network-log-output."),
      option("--network-log-output", "<artifacts/network.json>", "Private per-request run/policy log. Saved on captured failures too. Cross-origin iframe capture is unverified and blocked."),
      option("--allow-localhost", "", "Permit loopback only for controlled fixtures."),
      option("--focus-steps", "<0-50>", "Keyboard focus steps; default 8."),
      option("--width", "<240-7680>", "Primary viewport width; default 1280."),
      option("--height", "<240-7680>", "Primary viewport height; default 800."),
      option("--reflow-width", "<240-1280>", "Reflow viewport width; default 320.")
    ],
    defaults: ["--focus-steps 8", "--width 1280", "--height 800", "--reflow-width 320"],
    notes: ["Automated findings remain screening evidence and never become profile pass/fail outcomes automatically."]
  },
  {
    name: "profiles",
    script: "show-profiles.mjs",
    summary: "List active standards profiles, counts, groups, sources, and claim ceilings.",
    usage: ["accessibility-audit profiles list [--format text|json|markdown]"],
    options: [option("--format", "<text|json|markdown>", "Output format; default text.")]
  },
  {
    name: "requirements",
    script: "browse-requirements.mjs",
    summary: "List, search, or show WCAG/JIS requirements without requiring internal IDs.",
    usage: [
      "accessibility-audit requirements list [--profile <id>] [--level A|AA] [--procedure available|unavailable] [--locale ja|en] [--format text|json|markdown]",
      "accessibility-audit requirements search <query> [filters]",
      "accessibility-audit requirements show <internal-id|success-criterion> [--profile <id>] [--locale ja|en] [--format text|json|markdown]"
    ],
    options: [
      option("--profile", "<id>", "Limit results to one active profile."),
      option("--level", "<A|AA>", "Limit results by conformance level."),
      option("--procedure", "<available|unavailable>", "Filter criterion-specific human procedure availability."),
      option("--locale", "<ja|en>", "Preferred display language; default en."),
      option("--format", "<text|json|markdown>", "Output format; default text.")
    ],
    notes: ["Search results are metadata and reproducibility aids, not conformance determinations."]
  },
  {
    name: "requirement",
    script: "show-requirement.mjs",
    summary: "Show one registered requirement by exact internal ID (legacy-compatible entry point).",
    usage: ["accessibility-audit requirement --profile <id> --id <requirement-id> [--format json|markdown]"],
    options: [
      option("--profile", "<id>", "Active profile."),
      option("--id", "<requirement-id>", "Exact registered internal ID."),
      option("--format", "<json|markdown>", "Output format; default json.")
    ],
    notes: ["For discovery by number or keyword, use `requirements show` or `requirements search`."]
  },
  {
    name: "preflight-web",
    script: "preflight-web.mjs",
    summary: "Measure Web inspection capabilities on an isolated fixture without inspecting a target.",
    usage: ["accessibility-audit preflight-web [--browser-channel chrome] [--require <comma-separated-capabilities>] [--format text|json]"],
    options: [
      option("--browser-channel", "<chrome>", "Use installed system Chrome; otherwise use the Playwright Chromium runtime."),
      option("--require", "<capabilities>", "Require a comma-separated subset of the six registered capabilities."),
      option("--format", "<text|json>", "Output format; default text.")
    ],
    notes: ["Missing required capabilities exit with code 4. Screen-reader runtime remains externally unconfirmed. Success is not completed target inspection."]
  },
  {
    name: "doctor",
    script: "doctor.mjs",
    summary: "Diagnose Node, package, registry, distribution, and optional browser capabilities.",
    usage: ["accessibility-audit doctor [--format text|json]"],
    options: [option("--format", "<text|json>", "Output format; default text.")],
    notes: ["The command is read-only. Missing optional browser capability produces WARN rather than a false package failure. Run preflight-web to test the actual browser runtime."]
  },
  {
    name: "screen-reader-checklist",
    script: "show-screen-reader-checklist.mjs",
    summary: "Show supporting checks for stateful UI and screen-reader behavior.",
    usage: ["accessibility-audit screen-reader-checklist [--pattern modal-dialog|disclosure|menu-button|fragmented-text|in-page-links|all] [--format json|markdown]"],
    options: [
      option("--pattern", "<id|all>", "Checklist pattern; default all."),
      option("--format", "<json|markdown>", "Output format; default json.")
    ]
  },
  {
    name: "validate-run",
    script: "validate-audit-run.mjs",
    summary: "Validate an immutable audit run and write a new validation record.",
    usage: ["accessibility-audit validate-run --input <run.json> --output <new-validation.json>"],
    options: [option("--input", "<run.json>", "Audit run."), option("--output", "<file>", "New validation record.")]
  },
  {
    name: "validate-assessment",
    script: "validate-assessment.mjs",
    summary: "Validate an assessment and print its coverage and claim guard result.",
    usage: ["accessibility-audit validate-assessment <assessment.json> [--run <run.json>] [--trust-policy <recipient-selected.json> --trust-policy-sha256 <independent canonical SHA-256>]"],
    notes: ["Current run-backed review records require --run and its original artifacts. Stored authenticated flags are never accepted."]
  },
  {
    name: "register",
    script: "register-audit-artifact.mjs",
    summary: "Register one validated artifact in a new audit-run version.",
    usage: ["accessibility-audit register --run <run.json> --artifact <artifact.json> [--allow-origin <origin>] [--allow-url <exact-URL>] [--allow-localhost true] [--network-log-output <artifacts/network.json>] --output <new-run.json>"],
    options: [
      option("--run", "<run.json>", "Current run version."),
      option("--artifact", "<artifact.json>", "Validated artifact within its artifact root."),
      option("--allow-origin", "<origin>", "Explicit HTTP remeasurement origin; repeatable."),
      option("--allow-url", "<exact-URL>", "Explicit HTTP remeasurement URL; repeatable."),
      option("--network-log-output", "<artifacts/network.json>", "Required for HTTP remeasurement; private run-bound request log."),
      option("--allow-localhost", "<true>", "Permit loopback only for controlled HTTP fixtures."),
      option("--output", "<new-run.json>", "New immutable run version.")
    ]
  },
  {
    name: "merge",
    script: "merge-audit-artifacts.mjs",
    summary: "Merge registered artifacts into a new assessment.",
    usage: ["accessibility-audit merge --run <run.json> --assessment <assessment.json> --artifact <artifact.json> [--claim-tier <reference_only|screened|evaluated_subset>] --output <new-assessment.json>"],
    options: [
      option("--run", "<run.json>", "Validated current run."),
      option("--assessment", "<assessment.json>", "Baseline assessment."),
      option("--artifact", "<artifact.json>", "Registered artifact; repeatable."),
      option("--review-record", "<record.json>", "Portable review record bound to a registered human artifact; repeatable."),
      option("--trust-policy", "<recipient-selected.json>", "External recipient policy; requires --trust-policy-sha256."),
      option("--trust-policy-sha256", "<canonical SHA-256>", "Policy pin obtained independently of the audit bundle."),
      option("--claim-tier", "<reference_only|screened|evaluated_subset>", "Explicit claim request checked against registered evidence. Default: reference_only. Wording comes from the registry."),
      option("--output", "<new-assessment.json>", "New merged assessment.")
    ]
  },
  {
    name: "report",
    script: "render-report.mjs",
    summary: "Render a profile-aware, provenance-explicit Markdown report from a validated standalone or run-backed assessment.",
    usage: [
      "accessibility-audit report --input <assessment.json> [--locale ja|en] [--output <report.md>]",
      "accessibility-audit report --run <audit-run.json> --assessment <assessment.json> --output <new-report.md> [--locale ja|en]"
    ],
    options: [
      option("--input", "<assessment.json>", "Standalone interface."),
      option("--run", "<audit-run.json>", "Run-backed interface; requires --assessment and --output."),
      option("--assessment", "<assessment.json>", "Merged run-backed assessment."),
      option("--trust-policy", "<recipient-selected.json>", "Reverify reviewer signatures under an external policy; requires its independent pin."),
      option("--trust-policy-sha256", "<canonical SHA-256>", "Independent policy pin. Omitting both trust flags leaves valid signatures self-signed."),
      option("--locale", "<ja|en>", "Human-readable report locale; default ja. IDs and enum values do not change."),
      option("--output", "<report.md>", "New report path. Standalone mode may write to stdout when omitted.")
    ],
    notes: [
      "Use either --input or --run/--assessment, never both.",
      "Screening projections are report-only judgements and are never promoted to human-verified profile outcomes.",
      "Existing files are never overwritten."
    ]
  },
  {
    name: "retest",
    script: "create-audit-run.mjs",
    summary: "Create a fresh audit run from a completed authorized-change predecessor.",
    usage: ["accessibility-audit retest --supersedes-run <old-run.json> [all init options for the new target version]"],
    requiredFlag: "--supersedes-run",
    notes: ["Prior evidence and outcomes are not silently inherited."]
  }
];

export const commandDefinitions = new Map(definitions.map((definition) => [definition.name, Object.freeze(definition)]));

function renderOption(item) {
  const left = `${item.flag}${item.value ? ` ${item.value}` : ""}`;
  return `  ${left.padEnd(40)} ${item.description}`;
}

export function rootHelpText() {
  const commandLines = [...commandDefinitions].map(([name, definition]) => `  ${name.padEnd(24)} ${definition.summary}`);
  return [
    "Information Accessibility Audit CLI",
    "",
    "Usage:",
    "  accessibility-audit <command> [options]",
    "  accessibility-audit --version",
    "",
    "Global options:",
    "  --help, -h                 Show this help.",
    "  --version                  Show package and installed contract versions.",
    "",
    "Commands:",
    ...commandLines,
    "",
    "This command is a thin, read-only control-plane wrapper around the installed skill runtime.",
    "It does not evaluate conformance by itself and does not expose target mutation.",
    "Run accessibility-audit <command> --help for command-specific usage."
  ].join("\n");
}

export function commandHelpText(name) {
  const definition = commandDefinitions.get(name);
  if (!definition) throw new Error(`Unknown command: ${name}`);
  const lines = [definition.summary, "", "Usage:", ...definition.usage.map((usage) => `  ${usage}`)];
  if (definition.options?.length) lines.push("", "Options:", ...definition.options.map(renderOption));
  if (definition.defaults?.length) lines.push("", "Defaults:", ...definition.defaults.map((value) => `  ${value}`));
  if (definition.notes?.length) lines.push("", "Notes:", ...definition.notes.map((value) => `  - ${value}`));
  return lines.join("\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

export function versionText(skillRoot) {
  const manifest = readJson(path.join(skillRoot, "package.json"));
  const registry = readJson(path.join(skillRoot, "references/standards-registry.json"));
  const auditRunSchema = readJson(path.join(skillRoot, "references/audit-run.schema.json"));
  return [
    `${manifest.name} ${manifest.version}`,
    `standards registry ${registry.schema_version}`,
    `audit-run schema ${auditRunSchema.properties.schema_version.const}`,
    `Node ${process.versions.node}`
  ].join("\n");
}
