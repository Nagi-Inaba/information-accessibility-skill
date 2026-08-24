import fs from "node:fs";
import path from "node:path";

function option(flag, value, description) {
  return { flag, value, description };
}

const definitions = [
  {
    name: "init",
    script: "create-audit-run.mjs",
    summary: "Create a new immutable audit run.",
    usage: [
      "accessibility-audit init --run-id <id> --profile <id> --target-name <name> --target-version <version> --target-ref <url|file> --artifact-root <directory> --network <none|local_read_only> --interaction <safe_read_only|human_supervised> --source-write <none|authorized_only> [--config <scope-environment.json>] --output <new-run.json>"
    ],
    options: [
      option("--run-id", "<id>", "Unique run ID."),
      option("--profile", "<id>", "Active standards profile. Use `profiles list` to discover values."),
      option("--target-name", "<name>", "Human-readable target name."),
      option("--target-version", "<version>", "Declared target version or commit."),
      option("--target-ref", "<url|file>", "Target URL or file. Repeat for additional target references."),
      option("--artifact-root", "<directory>", "Existing private directory for run artifacts."),
      option("--network", "<none|local_read_only>", "Network policy alias. `none` denies access; `local_read_only` maps to an allowlisted read policy."),
      option("--interaction", "<safe_read_only|human_supervised>", "Interaction policy alias."),
      option("--source-write", "<none|authorized_only>", "Source-write policy. Standard audits normally use `none`."),
      option("--config", "<file>", "Optional JSON file declaring scope and/or environment."),
      option("--supersedes-run", "<file>", "Validated predecessor required only for retest initialization."),
      option("--output", "<new-run.json>", "New output path; existing files are never overwritten.")
    ],
    notes: [
      "The artifact root must already exist and must not traverse a symbolic link or reparse point.",
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
      option("--allow-origin", "<origin>", "Additional explicit origin; repeatable."),
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
    name: "doctor",
    script: "doctor.mjs",
    summary: "Diagnose Node, package, registry, distribution, and optional browser capabilities.",
    usage: ["accessibility-audit doctor [--format text|json]"],
    options: [option("--format", "<text|json>", "Output format; default text.")],
    notes: ["The command is read-only. Missing optional browser capability produces WARN rather than a false package failure."]
  },
  {
    name: "screen-reader-checklist",
    script: "show-screen-reader-checklist.mjs",
    summary: "Show supporting checks for stateful UI and screen-reader behavior.",
    usage: ["accessibility-audit screen-reader-checklist [--pattern modal-dialog|disclosure|menu-button|fragmented-text|all] [--format json|markdown]"],
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
    usage: ["accessibility-audit validate-assessment <assessment.json>"]
  },
  {
    name: "register",
    script: "register-audit-artifact.mjs",
    summary: "Register one validated artifact in a new audit-run version.",
    usage: ["accessibility-audit register --run <run.json> --artifact <artifact.json> --output <new-run.json>"],
    options: [
      option("--run", "<run.json>", "Current run version."),
      option("--artifact", "<artifact.json>", "Validated artifact within its artifact root."),
      option("--output", "<new-run.json>", "New immutable run version.")
    ]
  },
  {
    name: "merge",
    script: "merge-audit-artifacts.mjs",
    summary: "Merge registered artifacts into a new assessment.",
    usage: ["accessibility-audit merge --run <run.json> --assessment <assessment.json> --artifact <artifact.json> --output <new-assessment.json>"],
    options: [
      option("--run", "<run.json>", "Validated current run."),
      option("--assessment", "<assessment.json>", "Baseline assessment."),
      option("--artifact", "<artifact.json>", "Registered artifact; repeatable."),
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
