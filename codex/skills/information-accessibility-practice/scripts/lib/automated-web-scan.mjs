import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectWebEvidence,
  settlePage,
  WebInspectionError,
  withWebInspectionSession
} from "../capture-web-evidence.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

const MAX_TEXT_CODE_POINTS = 2_000;
const MAX_CONTEXT_ITEMS = 100;
const MAX_CONTEXT_NODES = 20;
const MAX_CONTEXT_FRAME_ENTRIES = 50;
const MAX_CONTEXT_BYTES = 512 * 1024;
const SUPPORTED_AXE = "4.13.0";
const SUPPORTED_PLAYWRIGHT = "1.62.1";
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const SCANNER_RENDERING_PROFILE = {
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce"
};
const IMPACT_PRIORITY = new Map([
  ["critical", 0],
  ["serious", 1],
  ["moderate", 2],
  ["minor", 3],
  [null, 4]
]);
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptRoot, "../..");
const require = createRequire(import.meta.url);

export class AutomatedWebScanError extends Error {
  constructor(message, { exitCode = 4, code = "AUTOMATED_SCAN_ERROR", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AutomatedWebScanError";
    this.exitCode = exitCode;
    this.code = code;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

export function truncateCodePoints(value, limit = MAX_TEXT_CODE_POINTS) {
  const points = Array.from(String(value ?? ""));
  return {
    value: points.slice(0, limit).join(""),
    truncated: points.length > limit
  };
}

export function successCriterionFromAxeTag(tag) {
  const match = /^wcag([1-4])([1-9])([0-9]+)$/u.exec(String(tag));
  return match ? `${match[1]}.${match[2]}.${Number(match[3])}` : null;
}

export function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new AutomatedWebScanError("Origin must be a valid absolute URL.", {
      exitCode: 2,
      code: "INVALID_ORIGIN",
      cause
    });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AutomatedWebScanError("Origin must use http or https.", { exitCode: 2, code: "INVALID_ORIGIN_PROTOCOL" });
  }
  if (url.username || url.password) {
    throw new AutomatedWebScanError("Origin must not contain credentials.", { exitCode: 2, code: "ORIGIN_CREDENTIALS_DENIED" });
  }
  if (url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new AutomatedWebScanError("Origin must not contain path, query, or fragment data.", { exitCode: 2, code: "ORIGIN_NOT_BARE" });
  }
  if (url.hostname.endsWith(".")) {
    throw new AutomatedWebScanError("Trailing-dot hostnames are not accepted.", { exitCode: 2, code: "TRAILING_DOT_ORIGIN" });
  }
  if (url.hostname.includes("*")) {
    throw new AutomatedWebScanError("Wildcard origins are not accepted.", { exitCode: 2, code: "WILDCARD_ORIGIN" });
  }
  return url.origin;
}

export function profileRequirementMap(profileId, standardsRegistry, criteriaCatalog) {
  const profile = standardsRegistry.profiles?.find((entry) => entry.id === profileId);
  if (!profile || profile.implementation_status !== "active" || profile.assessment_configuration?.active !== true) {
    throw new AutomatedWebScanError(`Profile is unknown or inactive: ${profileId}`, {
      exitCode: 2,
      code: "PROFILE_INACTIVE"
    });
  }
  const result = new Map();
  for (const catalogKey of profile.assessment_configuration.catalog_keys ?? []) {
    for (const item of criteriaCatalog.catalogs?.[catalogKey] ?? []) {
      const values = result.get(item.success_criterion) ?? [];
      values.push(item.id);
      result.set(item.success_criterion, [...new Set(values)].sort((left, right) => left.localeCompare(right, "en")));
    }
  }
  return result;
}

function criterionIds(tags, profileMap) {
  const ids = new Set();
  for (const tag of tags ?? []) {
    const criterion = successCriterionFromAxeTag(tag);
    for (const id of criterion ? (profileMap.get(criterion) ?? []) : []) ids.add(id);
  }
  return [...ids].sort((left, right) => left.localeCompare(right, "en"));
}

function identitySelector(selector) {
  return String(selector)
    .replace(/:nth-(?:child|of-type)\(\s*\d+\s*\)/giu, ":nth-(*)")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeNode(node) {
  const html = truncateCodePoints(node.html);
  const failure = truncateCodePoints(node.failureSummary);
  const targets = (node.target ?? []).map(String).sort((left, right) => left.localeCompare(right, "en"));
  return {
    targets,
    identity_targets: targets.map(identitySelector),
    html: html.value,
    html_truncated: html.truncated,
    failure_summary: failure.value,
    failure_summary_truncated: failure.truncated
  };
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "withheld-invalid-url";
  }
}

function normalizeRule(rule, kind, source, frame, engine, profileMap) {
  const profileIds = criterionIds(rule.tags, profileMap);
  const nodes = (rule.nodes ?? []).map(normalizeNode);
  const groups = new Map();
  const groupableNodes = nodes.length ? nodes : [{
    targets: [],
    identity_targets: [],
    html: "",
    html_truncated: false,
    failure_summary: "",
    failure_summary_truncated: false
  }];
  for (const node of groupableNodes) {
    const identity = canonicalJson({
      engine,
      rule_id: rule.id,
      frame_path: frame.path,
      frame_url: sanitizeUrl(frame.url),
      targets: node.identity_targets,
      failure_summary: node.failure_summary,
      impact: rule.impact ?? null
    });
    const key = sha256(identity);
    const grouped = groups.get(key) ?? [];
    grouped.push(node);
    groups.set(key, grouped);
  }
  return [...groups.entries()].map(([dedupKey, groupedNodes]) => ({
    dedup_key: dedupKey,
    kind,
    source,
    rule_id: rule.id,
    impact: rule.impact ?? null,
    help: String(rule.help ?? ""),
    help_url: rule.helpUrl ?? null,
    tags: [...new Set(rule.tags ?? [])].sort((left, right) => left.localeCompare(right, "en")),
    criterion_relation: "reference_only",
    profile_requirement_ids: profileIds,
    occurrence_count: groupedNodes.length,
    frame: { path: frame.path, url: sanitizeUrl(frame.url) },
    nodes: groupedNodes.map(({ identity_targets: _identityTargets, ...node }) => node)
  }));
}

function ruleSummary(rule) {
  return {
    rule_id: rule.id,
    impact: rule.impact ?? null,
    help: String(rule.help ?? ""),
    help_url: rule.helpUrl ?? null,
    tags: [...new Set(rule.tags ?? [])].sort((left, right) => left.localeCompare(right, "en"))
  };
}

function ruleOrder(left, right) {
  return String(left.rule_id).localeCompare(String(right.rule_id), "en");
}

function itemOrder(left, right) {
  return left.rule_id.localeCompare(right.rule_id, "en") || left.dedup_key.localeCompare(right.dedup_key, "en");
}

function sortItems(items) {
  return [...items].sort(itemOrder);
}

export function normalizeAxeResults({ axeResults, profileMap, frame, engine }) {
  const machineViolations = [];
  const reviewCandidates = [];
  const unmappedFindings = [];
  for (const rule of axeResults.violations ?? []) {
    const normalized = normalizeRule(rule, "machine_violation", "axe-core", frame, engine, profileMap);
    for (const item of normalized) {
      if (item.profile_requirement_ids.length > 0) machineViolations.push(item);
      else unmappedFindings.push({ ...item, kind: "unmapped_finding" });
    }
  }
  for (const rule of axeResults.incomplete ?? []) {
    reviewCandidates.push(...normalizeRule(rule, "review_candidate", "axe-core", frame, engine, profileMap));
  }
  return {
    machine_violations: sortItems(machineViolations),
    review_candidates: sortItems(reviewCandidates),
    unmapped_findings: sortItems(unmappedFindings),
    machine_passes: (axeResults.passes ?? []).map(ruleSummary).sort(ruleOrder),
    inapplicable: (axeResults.inapplicable ?? []).map(ruleSummary).sort(ruleOrder)
  };
}

function compactItem(item) {
  return {
    ...item,
    nodes: (item.nodes ?? []).slice(0, MAX_CONTEXT_NODES),
    nodes_truncated: (item.nodes?.length ?? 0) > MAX_CONTEXT_NODES
  };
}

function contextPriority(item) {
  if (item.source === "axe-frame-error") return 0;
  if (item.source === "internal-reflow-probe") return 1;
  if (item.kind === "machine_violation") return 2 + (IMPACT_PRIORITY.get(item.impact ?? null) ?? 4);
  return 10 + (IMPACT_PRIORITY.get(item.impact ?? null) ?? 4);
}

function contextItemOrder(left, right) {
  return contextPriority(left) - contextPriority(right) || itemOrder(left, right);
}

function compactFrameCoverage(frameCoverage) {
  const entries = (frameCoverage.entries ?? []).slice(0, MAX_CONTEXT_FRAME_ENTRIES);
  return {
    coverage_status: frameCoverage.coverage_status,
    attempted: frameCoverage.attempted,
    succeeded: frameCoverage.succeeded,
    failed: frameCoverage.failed,
    skipped: frameCoverage.skipped,
    entries,
    entries_truncated: (frameCoverage.entries?.length ?? 0) > entries.length,
    omitted_entries: Math.max(0, (frameCoverage.entries?.length ?? 0) - entries.length)
  };
}

export function buildAutomatedScanContext(scan, sourceScanSha256) {
  const allItems = [
    ...(scan.machine_violations ?? []),
    ...(scan.review_candidates ?? [])
  ].sort(contextItemOrder);
  const initiallyIncluded = allItems.slice(0, MAX_CONTEXT_ITEMS);
  const initiallyOmitted = allItems.slice(MAX_CONTEXT_ITEMS);
  const items = initiallyIncluded.map(compactItem);
  const omittedByClass = {
    machine_violations: initiallyOmitted.filter((item) => item.kind === "machine_violation").length,
    review_candidates: initiallyOmitted.filter((item) => item.kind === "review_candidate").length
  };
  let omittedNodes = initiallyOmitted.reduce((total, item) => total + (item.nodes?.length ?? 0), 0);
  omittedNodes += initiallyIncluded.reduce(
    (total, item) => total + Math.max(0, (item.nodes?.length ?? 0) - MAX_CONTEXT_NODES),
    0
  );

  const context = {
    schema_version: "1.0.0",
    kind: "automated-web-scan-context",
    stability: "experimental",
    source_scan_sha256: sourceScanSha256,
    target: {
      requested_url: sanitizeUrl(scan.target.requested_url),
      final_url: sanitizeUrl(scan.target.final_url),
      http_status: scan.target.http_status,
      dom_sha256: scan.target.dom_sha256,
      ax_tree_sha256: scan.target.ax_tree_sha256
    },
    environment: scan.environment,
    frame_coverage: compactFrameCoverage(scan.frame_coverage),
    policy_summary: {
      dns_binding: scan.policy.dns_binding,
      blocked_request_count: scan.policy.blocked_request_count,
      blocked_requests_truncated: scan.policy.blocked_requests_truncated,
      blocked_channel_count: scan.policy.blocked_channel_count,
      blocked_channels_truncated: scan.policy.blocked_channels_truncated,
      active_channels_blocked: scan.policy.blocked_channels
    },
    summary: scan.summary,
    items,
    focus_summary: {
      steps: scan.evidence?.focus_path?.length ?? 0,
      active_element: scan.evidence?.active_element ?? null
    },
    reflow_summary: scan.evidence?.reflow ?? null,
    truncation: {
      truncated: initiallyOmitted.length > 0 || omittedNodes > 0,
      omitted_items: initiallyOmitted.length,
      omitted_nodes: omittedNodes,
      omitted_by_class: omittedByClass,
      reason: initiallyOmitted.length > 0 || omittedNodes > 0 ? "context_limit" : "none"
    }
  };

  while (Buffer.byteLength(JSON.stringify(context), "utf8") > MAX_CONTEXT_BYTES && context.items.length > 0) {
    const removed = context.items.pop();
    context.truncation.truncated = true;
    context.truncation.omitted_items += 1;
    context.truncation.omitted_nodes += removed.nodes?.length ?? 0;
    context.truncation.omitted_by_class[
      removed.kind === "machine_violation" ? "machine_violations" : "review_candidates"
    ] += 1;
    context.truncation.reason = "context_limit";
  }
  if (Buffer.byteLength(JSON.stringify(context), "utf8") > MAX_CONTEXT_BYTES) {
    throw new AutomatedWebScanError("Compact scan context exceeds the 512 KiB limit even without item details.", {
      exitCode: 5,
      code: "CONTEXT_SIZE_LIMIT"
    });
  }
  return context;
}

export function scanSha256(scan) {
  return sha256(canonicalJson(scan));
}

function packageVersion(name) {
  return readJson(require.resolve(`${name}/package.json`)).version;
}

async function loadAxe() {
  let imported;
  try {
    imported = await import("axe-core");
  } catch (cause) {
    throw new AutomatedWebScanError(`axe-core is not installed. Install axe-core@${SUPPORTED_AXE} and retry.`, {
      exitCode: 4,
      code: "AXE_MISSING",
      cause
    });
  }
  const axe = imported.default ?? imported;
  const version = packageVersion("axe-core");
  if (version !== SUPPORTED_AXE) {
    throw new AutomatedWebScanError(`Unsupported axe-core version ${version}; expected ${SUPPORTED_AXE}.`, {
      exitCode: 4,
      code: "AXE_VERSION_UNSUPPORTED"
    });
  }
  return { axe, version };
}

function assertPlaywrightVersion() {
  let version;
  try {
    version = packageVersion("playwright");
  } catch (cause) {
    throw new AutomatedWebScanError(`Playwright is not installed. Install playwright@${SUPPORTED_PLAYWRIGHT} and Chromium, then retry.`, {
      exitCode: 4,
      code: "PLAYWRIGHT_MISSING",
      cause
    });
  }
  if (version !== SUPPORTED_PLAYWRIGHT) {
    throw new AutomatedWebScanError(`Unsupported Playwright version ${version}; expected ${SUPPORTED_PLAYWRIGHT}.`, {
      exitCode: 4,
      code: "PLAYWRIGHT_VERSION_UNSUPPORTED"
    });
  }
  return version;
}

function framePath(frame, frames) {
  const chain = [];
  let current = frame;
  while (current) {
    chain.unshift(frames.indexOf(current));
    current = current.parentFrame();
  }
  return chain.join(".");
}

async function runAxeInFrame(frame, axeSource) {
  return frame.evaluate(async (source) => {
    Function(source)();
    return globalThis.axe.run(document, {
      resultTypes: ["violations", "incomplete", "passes", "inapplicable"]
    });
  }, axeSource);
}

function mergeNormalized(target, normalized) {
  target.machine_violations.push(...normalized.machine_violations);
  target.review_candidates.push(...normalized.review_candidates);
  target.unmapped_findings.push(...normalized.unmapped_findings);
  target.machine_passes.push(...normalized.machine_passes);
  target.inapplicable.push(...normalized.inapplicable);
}

async function reflowProbe(page, width, primaryViewport, profileMap) {
  await page.setViewportSize({ width, height: primaryViewport.height });
  try {
    await settlePage(page);
    const measured = await page.evaluate(() => {
      const root = document.documentElement;
      const candidates = [];
      for (const element of document.querySelectorAll("body *")) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.right <= innerWidth + 1 && rect.left >= -1) continue;
        let explicitScroller = false;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const parentStyle = getComputedStyle(parent);
          if (["auto", "scroll"].includes(parentStyle.overflowX) && parent.scrollWidth > parent.clientWidth) {
            explicitScroller = true;
            break;
          }
        }
        if (!explicitScroller) {
          candidates.push({
            selector: element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase(),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width)
          });
        }
        if (candidates.length >= 50) break;
      }
      return {
        document_scroll_width: root.scrollWidth,
        document_client_width: root.clientWidth,
        candidates
      };
    });
    return {
      captured_at: new Date().toISOString(),
      viewport: { width, height: primaryViewport.height },
      ...measured,
      profile_requirement_ids: profileMap.get("1.4.10") ?? []
    };
  } finally {
    await page.setViewportSize(primaryViewport);
    await settlePage(page);
  }
}

function validateAgainstSchema(value, schemaFile, label) {
  const schema = readJson(schemaFile);
  const errors = [];
  validateJsonSchema(value, schema, "$", errors);
  if (errors.length) {
    throw new AutomatedWebScanError(`${label} schema validation failed:\n- ${errors.join("\n- ")}`, {
      exitCode: 5,
      code: "SCAN_SCHEMA_INVALID"
    });
  }
}

function coverageStatus({ attempted, succeeded, failed, skipped }) {
  if (attempted === 0 || succeeded === 0) return "none";
  return failed > 0 || skipped > 0 ? "partial" : "complete";
}

function uniqueRuleSummaries(items) {
  const byId = new Map();
  for (const item of items) {
    if (!byId.has(item.rule_id)) byId.set(item.rule_id, item);
  }
  return [...byId.values()].sort(ruleOrder);
}

export async function runAutomatedWebScan(options) {
  const registry = readJson(path.join(skillRoot, "references", "standards-registry.json"));
  const catalog = readJson(path.join(skillRoot, "references", "criteria-catalog.json"));
  const profileMap = profileRequirementMap(options.profile, registry, catalog);
  const playwrightVersion = assertPlaywrightVersion();
  const { axe, version: axeVersion } = await loadAxe();
  const primaryViewport = options.viewport ?? DEFAULT_VIEWPORT;

  try {
    return await withWebInspectionSession({
      ...options,
      allowedMethods: new Set(["GET", "HEAD"]),
      acceptDownloads: false,
      blockActiveNetworkChannels: true,
      blockServiceWorkers: true,
      guardFocusNavigation: true,
      includeBlockReasons: true,
      includeNetworkPolicyDetails: true,
      pinResolvedHosts: true,
      revalidateRequests: true,
      renderingProfile: SCANNER_RENDERING_PROFILE,
      settleBeforeInspection: true
    }, async (session) => {
      const frames = session.page.frames();
      const aggregate = {
        machine_violations: [],
        review_candidates: [],
        unmapped_findings: [],
        machine_passes: [],
        inapplicable: []
      };
      const entries = [];
      const rawResults = [];
      for (const frame of frames) {
        const descriptor = { url: frame.url(), path: framePath(frame, frames) };
        try {
          const result = await runAxeInFrame(frame, axe.source);
          rawResults.push({ frame: descriptor, result });
          mergeNormalized(aggregate, normalizeAxeResults({
            axeResults: result,
            profileMap,
            frame: descriptor,
            engine: { name: "axe-core", version: axeVersion }
          }));
          entries.push({ frame_path: descriptor.path, url: sanitizeUrl(descriptor.url), status: "succeeded", reason: null });
        } catch (error) {
          const reason = truncateCodePoints(error instanceof Error ? error.message : String(error), 500).value;
          entries.push({ frame_path: descriptor.path, url: sanitizeUrl(descriptor.url), status: "failed", reason });
          aggregate.review_candidates.push({
            dedup_key: sha256(`frame-error:${descriptor.path}:${sanitizeUrl(descriptor.url)}:${reason}`),
            kind: "review_candidate",
            source: "axe-frame-error",
            rule_id: "frame-scan",
            impact: null,
            help: "Frame could not be scanned automatically",
            help_url: null,
            tags: [],
            criterion_relation: "reference_only",
            profile_requirement_ids: [],
            occurrence_count: 1,
            frame: { path: descriptor.path, url: sanitizeUrl(descriptor.url) },
            nodes: []
          });
        }
      }

      const evidenceBundle = await collectWebEvidence(session, options);
      const reflow = await reflowProbe(session.page, options.reflowWidth ?? 320, primaryViewport, profileMap);
      if (reflow.candidates.length) {
        aggregate.review_candidates.push({
          dedup_key: sha256(canonicalJson({ rule: "reflow-overflow", candidates: reflow.candidates })),
          kind: "review_candidate",
          source: "internal-reflow-probe",
          rule_id: "reflow-overflow",
          impact: null,
          help: "Horizontal overflow detected at the 320 CSS-pixel proxy viewport",
          help_url: null,
          tags: ["wcag1410"],
          criterion_relation: "reference_only",
          profile_requirement_ids: reflow.profile_requirement_ids,
          occurrence_count: reflow.candidates.length,
          frame: { path: "0", url: sanitizeUrl(session.finalUrl.href) },
          nodes: []
        });
      }

      aggregate.machine_violations = sortItems(aggregate.machine_violations);
      aggregate.review_candidates = sortItems(aggregate.review_candidates);
      aggregate.unmapped_findings = sortItems(aggregate.unmapped_findings);
      aggregate.machine_passes = uniqueRuleSummaries(aggregate.machine_passes);
      aggregate.inapplicable = uniqueRuleSummaries(aggregate.inapplicable);

      const frameCoverage = {
        attempted: entries.length,
        succeeded: entries.filter((entry) => entry.status === "succeeded").length,
        failed: entries.filter((entry) => entry.status === "failed").length,
        skipped: entries.filter((entry) => entry.status === "skipped").length,
        entries
      };
      frameCoverage.coverage_status = coverageStatus(frameCoverage);
      const scan = {
        schema_version: "1.0.0",
        kind: "automated-web-scan",
        scan_status: "complete",
        captured_at: new Date().toISOString(),
        profile: { id: options.profile, registry_version: registry.schema_version },
        target: evidenceBundle.target,
        environment: {
          ...evidenceBundle.environment,
          scanner: { name: "axe-core", version: axeVersion },
          playwright_version: playwrightVersion
        },
        frame_coverage: frameCoverage,
        policy: {
          allowed_origins: evidenceBundle.network.allowed_origins,
          blocked_request_count: evidenceBundle.network.blocked_request_count ?? evidenceBundle.network.blocked_requests.length,
          blocked_requests_truncated: evidenceBundle.network.blocked_requests_truncated ?? false,
          blocked_channels: evidenceBundle.network.blocked_channels ?? [],
          blocked_channel_count: evidenceBundle.network.blocked_channel_count ?? (evidenceBundle.network.blocked_channels?.length ?? 0),
          blocked_channels_truncated: evidenceBundle.network.blocked_channels_truncated ?? false,
          dns_binding: evidenceBundle.network.dns_binding ?? "preflight_only",
          pinned_endpoints: evidenceBundle.network.pinned_endpoints ?? [],
          reflow_width: options.reflowWidth ?? 320
        },
        summary: {
          machine_violations: aggregate.machine_violations.length,
          review_candidates: aggregate.review_candidates.length,
          unmapped_findings: aggregate.unmapped_findings.length,
          machine_pass_rules: aggregate.machine_passes.length,
          inapplicable_rules: aggregate.inapplicable.length
        },
        machine_violations: aggregate.machine_violations,
        review_candidates: aggregate.review_candidates,
        unmapped_findings: aggregate.unmapped_findings,
        machine_passes: aggregate.machine_passes,
        inapplicable: aggregate.inapplicable,
        evidence: {
          ...evidenceBundle.evidence,
          reflow,
          blocked_requests: evidenceBundle.network.blocked_requests
        },
        raw_result_sha256: sha256(canonicalJson(rawResults)),
        interpretation: "Automated scan results are machine observations and do not by themselves determine formal WCAG conformance."
      };

      validateAgainstSchema(scan, path.join(skillRoot, "references", "automated-web-scan.schema.json"), "Automated scan");
      const sourceScanSha256 = scanSha256(scan);
      const context = buildAutomatedScanContext(scan, sourceScanSha256);
      validateAgainstSchema(context, path.join(skillRoot, "references", "automated-web-scan-context.schema.json"), "Automated scan context");
      return { scan, context };
    });
  } catch (error) {
    if (error instanceof AutomatedWebScanError || error instanceof WebInspectionError) throw error;
    throw new AutomatedWebScanError(error instanceof Error ? error.message : String(error), {
      exitCode: 4,
      code: "SCAN_RUNTIME_FAILURE",
      cause: error instanceof Error ? error : undefined
    });
  }
}
