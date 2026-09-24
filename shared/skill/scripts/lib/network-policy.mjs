import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";

export const NETWORK_POLICY_VERSION = "1.0.0";
export const NETWORK_ADAPTERS = Object.freeze(["node-http-pinned-v1", "browser-http-pinned-v1"]);
const keys = ["schema_version", "targets", "standards_sources", "methods", "redirects", "subresources", "iframes", "deny_private_networks", "allow_localhost_fixture", "dns", "max_response_bytes", "max_requests", "enforcement"];
const sameKeys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
const uniqueStrings = (value, max = 64) => Array.isArray(value) && value.length <= max
  && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 4096)
  && new Set(value).size === value.length;

export function networkUrl(value, { origin = false } = {}) {
  if (typeof value !== "string" || !value || value.length > 4096 || value !== value.trim() || /[\u0000-\u0020\u007f\\]/u.test(value) || value.includes("#")) throw new Error("Network addresses must be explicit HTTP(S) URLs without whitespace, backslashes or fragments.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hostname.endsWith(".") || url.hostname.includes("*")) throw new Error("Network URLs cannot contain credentials, wildcard or ambiguous hosts.");
  if (origin && (url.pathname !== "/" || url.search)) throw new Error("Network origins cannot contain a path or query.");
  return url;
}

function scopeErrors(scope, label) {
  if (!sameKeys(scope, ["origins", "exact_urls"]) || !uniqueStrings(scope.origins) || !uniqueStrings(scope.exact_urls)) return [`${label} requires bounded unique origins and exact_urls arrays.`];
  const errors = [];
  for (const field of ["origins", "exact_urls"]) {
    const normalized = [];
    for (const value of scope[field]) {
      try {
        const parsed = networkUrl(value, { origin: field === "origins" });
        const canonical = field === "origins" ? parsed.origin : parsed.href;
        if (value !== canonical) errors.push(`${label}.${field} must use canonical URLs.`);
        normalized.push(canonical);
      } catch { errors.push(`${label}.${field} contains an invalid URL.`); }
    }
    if (new Set(normalized).size !== normalized.length) errors.push(`${label}.${field} contains equivalent duplicate URLs.`);
  }
  return errors;
}

export function networkPolicyErrors(policy) {
  if (!sameKeys(policy, keys)) return ["Network policy must contain exactly the versioned policy fields."];
  const errors = [...scopeErrors(policy.targets, "targets"), ...scopeErrors(policy.standards_sources, "standards_sources")];
  if (policy.schema_version !== NETWORK_POLICY_VERSION) errors.push("Unsupported network policy version.");
  if (!errors.length && ![policy.targets, policy.standards_sources].some((scope) => scope.origins.length || scope.exact_urls.length)) errors.push("Allowlisted network mode requires at least one explicit origin or exact URL.");
  if (!uniqueStrings(policy.methods, 2) || !policy.methods.length || policy.methods.some((method) => !["GET", "HEAD"].includes(method))) errors.push("Network methods must explicitly select GET and/or HEAD.");
  if (!["same_origin_only", "allowlisted"].includes(policy.redirects)) errors.push("Unsupported redirect policy.");
  for (const key of ["subresources", "iframes"]) if (!["denied", "same_origin", "declared"].includes(policy[key])) errors.push(`Unsupported ${key} policy.`);
  if (policy.deny_private_networks !== true) errors.push("Private networks must remain denied.");
  if (typeof policy.allow_localhost_fixture !== "boolean") errors.push("Localhost fixture permission must be explicit.");
  if (policy.dns !== "pinned_per_request") errors.push("DNS must be validated and pinned per request.");
  if (!Number.isInteger(policy.max_response_bytes) || policy.max_response_bytes < 1 || policy.max_response_bytes > 10485760) errors.push("max_response_bytes must be between 1 and 10485760.");
  if (!Number.isInteger(policy.max_requests) || policy.max_requests < 1 || policy.max_requests > 1000) errors.push("max_requests must be between 1 and 1000.");
  if (policy.enforcement !== "registered_adapter_required") errors.push("A registered enforcing adapter is required.");
  return errors;
}

export function assertNetworkPolicy(policy) {
  const errors = networkPolicyErrors(policy);
  if (errors.length) throw new Error(`Invalid network policy:\n- ${errors.join("\n- ")}`);
  return policy;
}

export function networkPolicyHash(policy) {
  assertNetworkPolicy(policy);
  return crypto.createHash("sha256").update(canonicalJson(policy)).digest("hex");
}

export function createNetworkPolicy({ targetOrigins = [], targetUrls = [], sourceOrigins = [], sourceUrls = [], methods = ["GET", "HEAD"], allowLocalhost = false } = {}) {
  const normalize = (values, origin) => [...new Set(values.map((value) => {
    const url = networkUrl(value, { origin });
    return origin ? url.origin : url.href;
  }))].sort();
  return assertNetworkPolicy({ schema_version: NETWORK_POLICY_VERSION,
    targets: { origins: normalize(targetOrigins, true), exact_urls: normalize(targetUrls, false) },
    standards_sources: { origins: normalize(sourceOrigins, true), exact_urls: normalize(sourceUrls, false) },
    methods: [...new Set(methods)].sort(), redirects: "same_origin_only", subresources: "same_origin", iframes: "same_origin",
    deny_private_networks: true, allow_localhost_fixture: allowLocalhost, dns: "pinned_per_request",
    max_response_bytes: 10485760, max_requests: 500, enforcement: "registered_adapter_required" });
}

function listed(url, scope) {
  return scope.origins.includes(url.origin) || scope.exact_urls.includes(url.href);
}

export function callerNetworkScope(caller) {
  if (caller?.network !== "allowlisted") throw new Error("Explicit caller network authorization is required.");
  const origins = caller.allowedOrigins ?? [];
  const exactUrls = caller.exactUrls ?? [];
  if (!uniqueStrings(origins) || !uniqueStrings(exactUrls) || !origins.length && !exactUrls.length) throw new Error("Caller authorization requires explicit origins or exact URLs.");
  return {
    origins: [...new Set(origins.map((value) => networkUrl(value, { origin: true }).origin))],
    exact_urls: [...new Set(exactUrls.map((value) => networkUrl(value).href))]
  };
}

// This decision never performs DNS or grants authority. Transport must then
// reject private addresses and connect to the validated address, without a new lookup.
export function networkRequestDecision(policy, request, caller) {
  assertNetworkPolicy(policy);
  let callerScope;
  try { callerScope = callerNetworkScope(caller); } catch { return { allowed: false, reason: "caller_authorization_missing" }; }
  let url;
  try { url = networkUrl(request.url); } catch { return { allowed: false, reason: "invalid_url" }; }
  const deny = (reason) => ({ allowed: false, reason });
  if (!["target", "standards_source"].includes(request.purpose)) return deny("purpose_not_declared");
  if (!NETWORK_ADAPTERS.includes(request.adapter)) return deny("adapter_cannot_enforce_policy");
  const scope = request.purpose === "target" ? policy.targets : policy.standards_sources;
  if (!listed(url, scope)) return deny("outside_run_scope");
  if (!listed(url, callerScope)) return deny("outside_caller_scope");
  if (!policy.methods.includes(request.method)) return deny("method_not_allowed");
  if (caller.methods && (!Array.isArray(caller.methods) || !caller.methods.includes(request.method))) return deny("caller_method_not_allowed");
  const types = request.purpose === "target" ? ["main_document", "iframe", "subresource"] : ["source_document"];
  if (!types.includes(request.resource_type)) return deny("resource_purpose_mismatch");
  if (request.redirect_from) {
    let previous;
    try { previous = networkUrl(request.redirect_from); } catch { return deny("invalid_redirect_origin"); }
    if (!listed(previous, scope) || !listed(previous, callerScope)) return deny("redirect_from_outside_scope");
    if (policy.redirects === "same_origin_only" && url.origin !== previous.origin) return deny("cross_origin_redirect_denied");
  }
  const resourcePolicy = request.resource_type === "iframe" ? policy.iframes : request.resource_type === "subresource" ? policy.subresources : null;
  if (resourcePolicy === "denied") return deny("resource_type_denied");
  if (resourcePolicy === "same_origin") {
    let initiator;
    try { initiator = networkUrl(request.initiator_url); } catch { return deny("initiator_not_declared"); }
    if (initiator.origin !== url.origin) return deny("cross_origin_resource_denied");
  }
  if (request.adapter === "browser-http-pinned-v1" && request.resource_type === "iframe") {
    let initiator;
    try { initiator = networkUrl(request.initiator_url); } catch { return deny("initiator_not_declared"); }
    if (initiator.origin !== url.origin) return deny("cross_origin_iframe_capture_unavailable");
  }
  return { allowed: true, reason: "within_run_and_caller_scope", url: url.href,
    allow_localhost: policy.allow_localhost_fixture && caller.allowLocalhost === true };
}

export function assertNetworkRequest(policy, request, caller) {
  const decision = networkRequestDecision(policy, request, caller);
  if (!decision.allowed) {
    const error = new Error(`Network request denied: ${decision.reason}`);
    error.code = decision.reason;
    throw error;
  }
  return decision;
}

export function networkScopeSummary(permissions, { publicOutput = false } = {}) {
  if (permissions?.network !== "allowlisted") return { mode: "denied", enforcement: "network_denied" };
  if (networkPolicyErrors(permissions.network_policy).length) return { mode: "unverified_legacy", enforcement: "concrete_policy_missing" };
  const policy = permissions.network_policy;
  const scope = (value) => publicOutput ? { origin_count: value.origins.length, exact_url_count: value.exact_urls.length } : structuredClone(value);
  return { mode: "allowlisted", enforcement: "declared_policy_requires_adapter_evidence", targets: scope(policy.targets),
    standards_sources: scope(policy.standards_sources), methods: [...policy.methods], redirects: policy.redirects,
    subresources: policy.subresources, iframes: policy.iframes, deny_private_networks: true,
    allow_localhost_fixture: policy.allow_localhost_fixture, dns: policy.dns, max_response_bytes: policy.max_response_bytes,
    max_requests: policy.max_requests };
}

export function networkScopeText(summary, locale = "en") {
  const ja = locale === "ja";
  if (summary.mode === "denied") return ja ? "通信範囲: この監査ではネットワーク通信を許可していません。" : "Network scope: network access is not authorized for this run.";
  if (summary.mode !== "allowlisted") return ja ? "通信範囲: 旧記録には具体的な許可先がなく、制限の強制は未確認です。" : "Network scope: the historical record lacks concrete destinations; enforcement is unverified.";
  const count = (scope) => (scope.origin_count ?? scope.origins?.length ?? 0) + (scope.exact_url_count ?? scope.exact_urls?.length ?? 0);
  return ja
    ? `通信範囲: 対象 ${count(summary.targets)} 件、規格資料 ${count(summary.standards_sources)} 件の許可先を宣言。方法 ${summary.methods.join("/")}、転送 ${summary.redirects}、子フレーム ${summary.iframes}、付随リソース ${summary.subresources}。通信ごとに呼出側の許可も必要です。宣言だけでは実行時の強制を証明せず、他のツールの通信は未確認です。`
    : `Network scope: ${count(summary.targets)} target and ${count(summary.standards_sources)} standards-source destinations declared; methods ${summary.methods.join("/")}, redirects ${summary.redirects}, iframes ${summary.iframes}, subresources ${summary.subresources}. Each request also requires caller authorization. Declaration alone does not prove enforcement; other tools remain unverified.`;
}
