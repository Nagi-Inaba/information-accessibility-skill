const safeMethods = new Set(["GET", "HEAD"]);
const redirectModes = new Set(["same_origin", "allowlisted_origins"]);

function normalizedHost(hostname) {
  return hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
}

function privateIpv4(host) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function privateHost(hostname) {
  const host = normalizedHost(hostname);
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "::"
    || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")
    || privateIpv4(host);
}

function normalizeOrigin(value, policy) {
  if (typeof value !== "string" || value.includes("*")) throw new Error("Network origins must be exact URLs without wildcards");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid network origin: ${String(value)}`);
  }
  if (parsed.username || parsed.password) throw new Error("Network origins must not contain credentials");
  if (parsed.protocol !== "https:") throw new Error("Network origins must use HTTPS");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("Network origins must not contain paths, queries, or fragments");
  if (!policy.allow_private_networks && privateHost(parsed.hostname)) throw new Error(`Private or local network origin is not allowed: ${parsed.hostname}`);
  if (!policy.allow_nonstandard_ports && parsed.port && parsed.port !== "443") throw new Error(`Non-standard HTTPS port is not allowed: ${parsed.port}`);
  return parsed.origin;
}

export function validateNetworkPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("network policy must be an object");
  if (!["denied", "allowlist"].includes(policy.mode)) throw new Error("network policy mode must be denied or allowlist");
  if (policy.credentials !== undefined && policy.credentials !== "omit") throw new Error("network credentials must be omitted");
  if (policy.mode === "denied") {
    if ((policy.origins?.length ?? 0) > 0) throw new Error("denied network policy must not contain origins");
    return { mode: "denied", origins: [], methods: [], redirects: "same_origin", credentials: "omit", max_response_bytes: 0 };
  }
  if (!Array.isArray(policy.origins) || policy.origins.length === 0) throw new Error("allowlist network policy requires at least one origin");
  const methods = [...new Set(policy.methods ?? ["GET", "HEAD"])].map((method) => String(method).toUpperCase());
  if (methods.length === 0 || methods.some((method) => !safeMethods.has(method))) throw new Error("Only GET and HEAD are allowed network methods");
  const redirects = policy.redirects ?? "same_origin";
  if (!redirectModes.has(redirects)) throw new Error("redirects must be same_origin or allowlisted_origins");
  if (!Number.isInteger(policy.max_response_bytes) || policy.max_response_bytes <= 0) throw new Error("max_response_bytes must be a positive integer");
  const normalized = [...new Set(policy.origins.map((origin) => normalizeOrigin(origin, policy)))].sort();
  return {
    mode: "allowlist",
    origins: normalized,
    methods,
    redirects,
    credentials: "omit",
    max_response_bytes: policy.max_response_bytes,
    allow_private_networks: policy.allow_private_networks === true,
    allow_nonstandard_ports: policy.allow_nonstandard_ports === true
  };
}

export function authorizeNetworkRequest({ url, method = "GET", redirectFrom = null }, policy) {
  const normalizedPolicy = validateNetworkPolicy(policy);
  if (normalizedPolicy.mode === "denied") throw new Error("Network access is denied by policy");
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error("Request URL must be absolute");
  }
  if (target.username || target.password) throw new Error("Request URL must not contain credentials");
  if (!normalizedPolicy.origins.includes(target.origin)) throw new Error(`Request origin is not allowlisted: ${target.origin}`);
  const normalizedMethod = String(method).toUpperCase();
  if (!normalizedPolicy.methods.includes(normalizedMethod)) throw new Error(`Request method is not allowed: ${normalizedMethod}`);
  if (redirectFrom) {
    const source = new URL(redirectFrom);
    if (normalizedPolicy.redirects === "same_origin" && source.origin !== target.origin) throw new Error("Cross-origin redirects are not allowed");
    if (normalizedPolicy.redirects === "allowlisted_origins" && !normalizedPolicy.origins.includes(source.origin)) throw new Error("Redirect source origin is not allowlisted");
  }
  return {
    allowed: true,
    url: target.href,
    origin: target.origin,
    method: normalizedMethod,
    credentials: "omit",
    redirect_mode: normalizedPolicy.redirects,
    max_response_bytes: normalizedPolicy.max_response_bytes
  };
}
