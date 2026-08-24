import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSkillRoot = path.dirname(path.dirname(scriptDirectory));
const localeFile = path.join(defaultSkillRoot, "references/runtime-locales.json");
const checklistLocaleFile = path.join(defaultSkillRoot, "references/screen-reader-ui-checks.ja.json");
const methodLocaleFile = path.join(defaultSkillRoot, "references/web-audit-methods.ja.json");
const procedureLocaleFile = path.join(defaultSkillRoot, "references/criterion-procedures.ja.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

const catalog = readJson(localeFile);

const englishRequirements = Object.freeze({
  headings: {
    requirements: "Requirements",
    search: "Requirement search: {query}",
    results: "Results",
    internal_id: "Internal ID",
    profile: "Profile",
    level: "Level",
    procedure: "Criterion-specific procedure",
    related: "Related requirements",
    sources: "Primary and guidance sources",
    title: "Title",
    none: "none",
    boundary: "This metadata lookup is a reproducibility aid, not a conformance determination.",
    id: "ID",
    source_list: "Sources",
    applicability: "Applicability",
    procedure_heading: "Procedure",
    evidence: "Evidence",
    cant_tell: "Record cant_tell when",
    criterion_procedure: "Criterion-specific human procedure",
    expected_results: "Expected results",
    criterion_cant_tell: "Criterion-specific cannot tell",
    ai_boundary: "AI boundary",
    primary_sources: "Primary sources",
    procedure_unavailable: "No criterion-specific procedure is bundled for this requirement. Use the routed generic playbook and primary sources; do not infer that this partial procedure catalog covers the requirement.",
    usage_boundary: "Open the criterion's primary sources before evaluating it. This lookup is a reproducibility aid, not a conformance determination."
  },
  procedure_status: { available: "available", unavailable: "unavailable" }
});

const englishChecklistLabels = Object.freeze({
  title: "Screen-reader UI checklist",
  sourceStatus: "Source status",
  claimEffect: "Claim effect",
  invariant: "Invariant",
  applicability: "Applicability",
  codeInspection: "Code or structure inspection",
  runtimeVerification: "Runtime verification",
  evidenceTypes: "Evidence types",
  cantTell: "Record cant_tell when",
  humanRequired: "Human review required",
  evidenceBoundary: "Evidence boundary",
  yes: "yes",
  no: "no",
  usageBoundary: "This is a reproducible supporting-screening checklist. Do not infer a spoken runtime result or profile outcome from code inspection alone."
});

const japaneseChecklistLabels = Object.freeze({
  title: "スクリーンリーダーUIチェックリスト",
  sourceStatus: "資料の状態",
  claimEffect: "主張への影響",
  invariant: "不変条件",
  applicability: "適用条件",
  codeInspection: "コード・構造の確認",
  runtimeVerification: "実行時の確認",
  evidenceTypes: "証拠型",
  cantTell: "要確認とする条件",
  humanRequired: "人による確認が必要",
  evidenceBoundary: "証拠の境界",
  yes: "はい",
  no: "いいえ",
  usageBoundary: catalog.ja?.report_limitations ? readJson(checklistLocaleFile).usage_boundary : ""
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function formatTemplate(value, replacements = {}) {
  return String(value).replace(/\{([a-z_]+)\}/gu, (_match, key) => String(replacements[key] ?? `{${key}}`));
}

export function normalizeRuntimeLocale(value, fallback = "en") {
  const candidate = value ?? fallback;
  if (!catalog.supported_locales.includes(candidate)) throw new Error("--locale must be ja or en");
  return candidate;
}

export function runtimeLocaleFromEnvironment(fallback = "en") {
  return normalizeRuntimeLocale(process.env.ACCESSIBILITY_AUDIT_LOCALE, fallback);
}

export function runtimeLocaleCatalog() {
  return clone(catalog);
}

export function runtimeCliMessages(locale = "en") {
  const normalized = normalizeRuntimeLocale(locale, "en");
  if (normalized === "ja") return clone(catalog.ja.cli);
  return {
    root_title: "Information Accessibility Audit CLI",
    usage_heading: "Usage:",
    global_options_heading: "Global options:",
    commands_heading: "Commands:",
    options_heading: "Options:",
    defaults_heading: "Defaults:",
    notes_heading: "Notes:",
    help_description: "Show this help.",
    version_description: "Show package and installed contract versions.",
    locale_description: "Human-readable locale: ja or en.",
    root_notes: [
      "This command is a thin, read-only control-plane wrapper around the installed skill runtime.",
      "It does not evaluate conformance by itself and does not expose target mutation.",
      "Run accessibility-audit <command> --help for command-specific usage."
    ],
    errors: {
      unknown_command: "Unknown command: {command}",
      help_hint: "Run accessibility-audit --help to list supported commands.",
      mutation_blocked: "Target mutation is not available from the standard CLI. Use the separately authorized fixer runtime with an exact validated authorization.",
      required_flag: "{command} requires {flag}.",
      locale_invalid: "--locale must be ja or en",
      locale_missing: "Missing value for --locale.",
      locale_duplicate: "Duplicate argument: --locale",
      version_extra: "--version does not accept additional arguments."
    },
    commands: {}
  };
}

export function runtimeCliError(locale, key, replacements = {}) {
  const messages = runtimeCliMessages(locale);
  return formatTemplate(messages.errors[key] ?? key, replacements);
}

export function localizedCommandDefinition(definition, locale = "en") {
  const normalized = normalizeRuntimeLocale(locale, "en");
  if (normalized === "en") return clone(definition);
  const override = catalog.ja.cli.commands[definition.name] ?? {};
  return {
    ...clone(definition),
    summary: override.summary ?? definition.summary,
    options: (definition.options ?? []).map((item) => ({
      ...item,
      description: override.options?.[item.flag] ?? item.description
    })),
    notes: override.notes ?? clone(definition.notes ?? [])
  };
}

export function localizedProfile(profile, locale = "en") {
  const normalized = normalizeRuntimeLocale(locale, "en");
  if (normalized === "en") return clone(profile);
  const override = catalog.ja.profiles[profile.id];
  if (!override) return clone(profile);
  const localized = clone(profile);
  localized.display_name = override.display_name;
  localized.target_scope = override.target_scope;
  if (localized.assessment_configuration?.groups) {
    localized.assessment_configuration.groups = localized.assessment_configuration.groups.map((group) => ({
      ...group,
      label: override.groups?.[group.id] ?? group.label
    }));
  }
  return localized;
}

export function requirementsUi(locale = "en") {
  const normalized = normalizeRuntimeLocale(locale, "en");
  return normalized === "ja" ? clone(catalog.ja.requirements_ui) : clone(englishRequirements);
}

export function checklistLabels(locale = "en") {
  return normalizeRuntimeLocale(locale, "en") === "ja"
    ? { ...clone(japaneseChecklistLabels), usageBoundary: readJson(checklistLocaleFile).usage_boundary }
    : clone(englishChecklistLabels);
}

function assertString(value, location, errors) {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${location} must be a non-empty string.`);
}

function validateTranslatedArray(canonical, localized, location, errors) {
  if (!Array.isArray(localized) || localized.length !== canonical.length) {
    errors.push(`${location} length must match the canonical registry.`);
    return;
  }
  localized.forEach((value, index) => assertString(value, `${location}[${index}]`, errors));
}

function validateChecklistOverlay(canonical, overlay) {
  const errors = [];
  if (overlay?.schema_version !== "1.0.0") errors.push("screen-reader ja overlay schema_version must be 1.0.0.");
  if (overlay?.locale !== "ja") errors.push("screen-reader ja overlay locale must be ja.");
  assertString(overlay?.invariant, "screen-reader ja overlay invariant", errors);
  assertString(overlay?.usage_boundary, "screen-reader ja overlay usage_boundary", errors);
  const canonicalPatterns = Array.isArray(canonical?.patterns) ? canonical.patterns : [];
  const localizedPatterns = Array.isArray(overlay?.patterns) ? overlay.patterns : [];
  if (canonicalPatterns.length !== localizedPatterns.length) errors.push("screen-reader ja overlay pattern count must match the canonical registry.");
  canonicalPatterns.forEach((pattern, patternIndex) => {
    const localized = localizedPatterns[patternIndex];
    if (localized?.id !== pattern.id) errors.push(`screen-reader ja overlay pattern[${patternIndex}] id must equal ${pattern.id}.`);
    assertString(localized?.title, `screen-reader ja overlay pattern ${pattern.id} title`, errors);
    assertString(localized?.applicability, `screen-reader ja overlay pattern ${pattern.id} applicability`, errors);
    const checks = Array.isArray(pattern.checks) ? pattern.checks : [];
    const localizedChecks = Array.isArray(localized?.checks) ? localized.checks : [];
    if (checks.length !== localizedChecks.length) errors.push(`screen-reader ja overlay ${pattern.id} check count must match.`);
    checks.forEach((check, checkIndex) => {
      const translated = localizedChecks[checkIndex];
      if (translated?.id !== check.id) errors.push(`screen-reader ja overlay ${pattern.id}.checks[${checkIndex}] id must equal ${check.id}.`);
      for (const field of ["title", "expectation"]) assertString(translated?.[field], `${check.id}.${field}`, errors);
      for (const field of ["code_inspection", "runtime_verification", "cant_tell_when"]) {
        validateTranslatedArray(check[field], translated?.[field], `${check.id}.${field}`, errors);
      }
    });
  });
  return errors;
}

function validateMethodOverlay(canonical, overlay) {
  const errors = [];
  if (overlay?.schema_version !== "1.0.0") errors.push("web-audit-methods ja overlay schema_version must be 1.0.0.");
  if (overlay?.locale !== "ja") errors.push("web-audit-methods ja overlay locale must be ja.");
  if (overlay?.canonical_schema_version !== canonical?.schema_version) {
    errors.push("web-audit-methods ja overlay canonical_schema_version must match the canonical registry.");
  }
  const methods = Array.isArray(canonical?.methods) ? canonical.methods : [];
  const localizedMethods = Array.isArray(overlay?.methods) ? overlay.methods : [];
  if (localizedMethods.length !== methods.length) errors.push("web-audit-methods ja overlay method count must match the canonical registry.");
  methods.forEach((method, index) => {
    const localized = localizedMethods[index];
    if (localized?.id !== method.id) errors.push(`web-audit-methods ja overlay methods[${index}].id must equal ${method.id}.`);
    assertString(localized?.applicability_gate, `${method.id}.applicability_gate`, errors);
    validateTranslatedArray(method.procedure_steps, localized?.procedure_steps, `${method.id}.procedure_steps`, errors);
    assertString(localized?.cant_tell_when, `${method.id}.cant_tell_when`, errors);
  });
  return errors;
}

function validateProcedureOverlay(canonical, overlay) {
  const errors = [];
  if (overlay?.schema_version !== "1.0.0") errors.push("criterion-procedures ja overlay schema_version must be 1.0.0.");
  if (overlay?.locale !== "ja") errors.push("criterion-procedures ja overlay locale must be ja.");
  if (overlay?.canonical_schema_version !== canonical?.schema_version) {
    errors.push("criterion-procedures ja overlay canonical_schema_version must match the canonical registry.");
  }
  const procedures = Array.isArray(canonical?.procedures) ? canonical.procedures : [];
  const localizedProcedures = Array.isArray(overlay?.procedures) ? overlay.procedures : [];
  if (localizedProcedures.length !== procedures.length) errors.push("criterion-procedures ja overlay procedure count must match the canonical registry.");
  procedures.forEach((procedure, index) => {
    const localized = localizedProcedures[index];
    if (localized?.id !== procedure.id) errors.push(`criterion-procedures ja overlay procedures[${index}].id must equal ${procedure.id}.`);
    for (const field of ["applicability_steps", "procedure_steps", "expected_results", "cant_tell_when"]) {
      validateTranslatedArray(procedure[field], localized?.[field], `${procedure.id}.${field}`, errors);
    }
    for (const outcome of ["pass", "fail", "cant_tell"]) {
      validateTranslatedArray(
        procedure.counterexamples[outcome],
        localized?.counterexamples?.[outcome],
        `${procedure.id}.counterexamples.${outcome}`,
        errors
      );
    }
    assertString(localized?.ai_boundary, `${procedure.id}.ai_boundary`, errors);
  });
  return errors;
}

export function localizeScreenReaderRegistry(registry, locale = "en", root = defaultSkillRoot) {
  const normalized = normalizeRuntimeLocale(locale, "en");
  if (normalized === "en") return clone(registry);
  const overlay = readJson(path.join(root, "references/screen-reader-ui-checks.ja.json"));
  const errors = validateChecklistOverlay(registry, overlay);
  if (errors.length) throw new Error(`Invalid screen-reader locale overlay:\n- ${errors.join("\n- ")}`);
  const localized = clone(registry);
  localized.invariant = overlay.invariant;
  localized.patterns = localized.patterns.map((pattern, patternIndex) => {
    const translation = overlay.patterns[patternIndex];
    return {
      ...pattern,
      title: translation.title,
      applicability: translation.applicability,
      checks: pattern.checks.map((check, checkIndex) => ({
        ...check,
        ...translation.checks[checkIndex],
        id: check.id,
        evidence_types: clone(check.evidence_types),
        human_review_required: check.human_review_required
      }))
    };
  });
  return localized;
}

export function localizeAuditMethod(method, locale = "en", root = defaultSkillRoot) {
  const normalized = normalizeRuntimeLocale(locale, "en");
  if (normalized === "en") return clone(method);
  const canonical = readJson(path.join(root, "references/web-audit-methods.json"));
  const overlay = readJson(path.join(root, "references/web-audit-methods.ja.json"));
  const errors = validateMethodOverlay(canonical, overlay);
  if (errors.length) throw new Error(`Invalid Web audit method locale overlay:\n- ${errors.join("\n- ")}`);
  const translation = overlay.methods.find((item) => item.id === method.id);
  if (!translation) throw new Error(`Missing Japanese Web audit method translation: ${method.id}.`);
  return {
    ...clone(method),
    applicability_gate: translation.applicability_gate,
    procedure_steps: clone(translation.procedure_steps),
    cant_tell_when: translation.cant_tell_when
  };
}

export function localizeCriterionProcedure(procedure, locale = "en", root = defaultSkillRoot) {
  const normalized = normalizeRuntimeLocale(locale, "en");
  if (normalized === "en") return clone(procedure);
  const canonical = readJson(path.join(root, "references/criterion-procedures.json"));
  const overlay = readJson(path.join(root, "references/criterion-procedures.ja.json"));
  const errors = validateProcedureOverlay(canonical, overlay);
  if (errors.length) throw new Error(`Invalid criterion procedure locale overlay:\n- ${errors.join("\n- ")}`);
  const translation = overlay.procedures.find((item) => item.id === procedure.id);
  if (!translation) throw new Error(`Missing Japanese criterion procedure translation: ${procedure.id}.`);
  return {
    ...clone(procedure),
    applicability_steps: clone(translation.applicability_steps),
    procedure_steps: clone(translation.procedure_steps),
    expected_results: clone(translation.expected_results),
    cant_tell_when: clone(translation.cant_tell_when),
    counterexamples: clone(translation.counterexamples),
    ai_boundary: translation.ai_boundary
  };
}

export function localizeKnownReportText(value, locale = "en") {
  const normalized = normalizeRuntimeLocale(locale, "en");
  if (normalized === "en") return value;
  if (Array.isArray(value)) return value.map((item) => localizeKnownReportText(item, normalized));
  if (typeof value === "string") return catalog.ja.report_limitations[value] ?? value;
  return value;
}

export function validateRuntimeLocaleCatalog({ registry, checklist, root = defaultSkillRoot }) {
  const errors = [];
  if (catalog.schema_version !== "1.0.0") errors.push("runtime locale schema_version must be 1.0.0.");
  if (JSON.stringify(catalog.supported_locales) !== JSON.stringify(["ja", "en"])) errors.push("runtime locale supported_locales must be [ja, en].");
  const activeProfiles = (registry?.profiles ?? []).filter((profile) => profile.assessment_configuration?.active === true);
  for (const profile of activeProfiles) {
    const translation = catalog.ja.profiles[profile.id];
    if (!translation) {
      errors.push(`Missing Japanese profile translation: ${profile.id}.`);
      continue;
    }
    assertString(translation.display_name, `profile ${profile.id} display_name`, errors);
    assertString(translation.target_scope, `profile ${profile.id} target_scope`, errors);
    for (const group of profile.assessment_configuration.groups ?? []) {
      assertString(translation.groups?.[group.id], `profile ${profile.id} group ${group.id}`, errors);
    }
  }
  const extraProfiles = Object.keys(catalog.ja.profiles).filter((id) => !activeProfiles.some((profile) => profile.id === id));
  if (extraProfiles.length) errors.push(`Unexpected Japanese profile translations: ${extraProfiles.join(", ")}.`);
  errors.push(...validateChecklistOverlay(checklist, readJson(path.join(root, "references/screen-reader-ui-checks.ja.json"))));
  const methods = readJson(path.join(root, "references/web-audit-methods.json"));
  errors.push(...validateMethodOverlay(methods, readJson(path.join(root, "references/web-audit-methods.ja.json"))));
  const procedures = readJson(path.join(root, "references/criterion-procedures.json"));
  errors.push(...validateProcedureOverlay(procedures, readJson(path.join(root, "references/criterion-procedures.ja.json"))));
  return { valid: errors.length === 0, errors };
}
