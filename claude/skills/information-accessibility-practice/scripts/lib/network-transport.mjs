import http from "node:http";
import https from "node:https";
import { resolveInspectionEndpoint } from "../capture-web-evidence.mjs";
import { assertNetworkPolicy, assertNetworkRequest, callerNetworkScope, networkPolicyHash } from "./network-policy.mjs";

const freeze = (value) => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const failure = (code) => Object.assign(new Error(`Network operation stopped: ${code}`), { code });

async function abortable(operation, signal) {
  if (signal.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export const NETWORK_SESSION_MAX_BYTES = 32 * 1024 * 1024;
export const NETWORK_MAX_CONCURRENCY = 4;

function retrieve(url, endpoint, method, maxBytes, signal, entry, countBytes) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method, agent: false, autoSelectFamily: false, signal, maxHeaderSize: 16384,
      lookup: (_hostname, options, callback) => options?.all
        ? callback(null, [{ address: endpoint.address, family: endpoint.family }])
        : callback(null, endpoint.address, endpoint.family),
      headers: { "accept-encoding": "identity", "user-agent": "information-accessibility-network/1", connection: "close" }
    }, (response) => {
      response.on("error", reject);
      entry.response_status = response.statusCode;
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding.toLowerCase() !== "identity") {
        response.destroy(failure("unexpected_content_encoding"));
        reject(failure("unexpected_content_encoding"));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => {
        entry.response_bytes += chunk.length;
        try { countBytes(chunk.length); } catch (error) { response.destroy(error); return; }
        if (entry.response_bytes > maxBytes) response.destroy(failure("response_size_exceeded"));
        else chunks.push(chunk);
      });
      response.on("aborted", () => reject(failure("response_aborted")));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks, entry.response_bytes) }));
    });
    request.on("error", reject);
    request.on("finish", () => { entry.request_sent = true; });
    request.end();
  });
}

// The caller supplies authority separately from the saved declaration. Neither
// a copied run nor a serialized log grants permission to perform network I/O.
export function createNetworkSession({ runId, policy, caller, purpose = "target", adapter = "node-http-pinned-v1" }) {
  if (typeof runId !== "string" || !/^RUN-[0-9]{8}T[0-9]{6}Z-[A-Z0-9]{8}$/u.test(runId)) throw new Error("Network session requires an explicit run ID.");
  assertNetworkPolicy(policy);
  const callerScope = callerNetworkScope(caller);
  const fixedPolicy = freeze(structuredClone(policy));
  const fixedCaller = freeze(structuredClone(caller));
  const entries = [];
  let overflow = 0;
  let receivedBytes = 0;
  let active = 0;
  let stopped = false;
  const controllers = new Set();
  const stop = () => { stopped = true; for (const controller of controllers) controller.abort(failure("network_session_stopped")); };
  const policyHash = networkPolicyHash(fixedPolicy);
  const startedAt = new Date().toISOString();
  const log = () => freeze({ schema_version: "1.0.0", kind: "network-request-log", run_id: runId,
    network_policy_sha256: policyHash, adapter, purpose, publication: "private_by_default",
    caller_authorization: { network: "allowlisted", allowedOrigins: callerScope.origins, exactUrls: callerScope.exact_urls,
      methods: fixedCaller.methods ?? ["GET", "HEAD"], allowLocalhost: fixedCaller.allowLocalhost === true },
    started_at: startedAt, completed_at: new Date().toISOString(), entries: structuredClone(entries),
    truncated: overflow > 0, dropped_request_count: overflow, credentials: "not_forwarded",
    session_limits: { max_total_bytes: NETWORK_SESSION_MAX_BYTES, max_concurrent_requests: NETWORK_MAX_CONCURRENCY },
    limitations: ["Only this adapter's HTTP(S) requests are recorded; other host tools and channels are unverified.",
      "Authorization is checked per request; this log does not authenticate its producer."] });

  const request = async ({ url, method = "GET", resource_type = purpose === "target" ? "main_document" : "source_document", initiator_url = null, redirect_from = null }) => {
    if (entries.length >= fixedPolicy.max_requests) { overflow += 1; throw Object.assign(failure("request_limit_exceeded"), { networkLog: log() }); }
    const entry = { request_id: `REQ-${String(entries.length + 1).padStart(4, "0")}`, at: new Date().toISOString(),
      url: typeof url === "string" ? url.slice(0, 4096) : "invalid_url",
      method: typeof method === "string" ? method.slice(0, 32) : "invalid_method",
      resource_type: typeof resource_type === "string" ? resource_type.slice(0, 32) : "invalid_type",
      initiator_url: typeof initiator_url === "string" ? initiator_url.slice(0, 4096) : null,
      redirect_from: typeof redirect_from === "string" ? redirect_from.slice(0, 4096) : null,
      decision: "pending", reason: "not_checked", outcome: "pending", error_code: null, request_sent: false,
      pinned_address: null, address_family: null,
      response_status: null, response_bytes: 0 };
    entries.push(entry);
    const controller = new AbortController();
    let acquired = false;
    const timer = setTimeout(() => controller.abort(failure("request_timeout")), 15_000);
    timer.unref();
    try {
      const permitted = assertNetworkRequest(fixedPolicy, { url, method, resource_type, initiator_url, redirect_from, purpose, adapter }, fixedCaller);
      if (stopped) throw failure("network_session_stopped");
      if (receivedBytes >= NETWORK_SESSION_MAX_BYTES) throw failure("session_byte_limit_exceeded");
      if (active >= NETWORK_MAX_CONCURRENCY) throw failure("concurrent_request_limit_exceeded");
      active += 1;
      acquired = true;
      controllers.add(controller);
      entry.url = permitted.url;
      const target = new URL(permitted.url);
      const endpoint = await abortable(resolveInspectionEndpoint(target, { allowLocalhost: permitted.allow_localhost }), controller.signal);
      entry.pinned_address = endpoint.address;
      entry.address_family = endpoint.family;
      entry.decision = "allowed";
      entry.reason = "validated_and_pinned";
      const response = await retrieve(target, endpoint, method, fixedPolicy.max_response_bytes, controller.signal, entry, (count) => {
        receivedBytes += count;
        if (receivedBytes > NETWORK_SESSION_MAX_BYTES) throw failure("session_byte_limit_exceeded");
      });
      entry.outcome = "succeeded";
      return response;
    } catch (error) {
      entry.error_code = typeof error.code === "string" && /^[a-zA-Z0-9_]+$/u.test(error.code) ? error.code : "network_request_failed";
      if (entry.decision !== "allowed") { entry.decision = "denied"; entry.reason = entry.error_code; }
      entry.outcome = entry.decision === "allowed" ? "failed" : "blocked";
      throw Object.assign(failure(entry.error_code), { networkLog: log() });
    } finally { if (acquired) active -= 1; controllers.delete(controller); clearTimeout(timer); }
  };

  const fetch = async (options) => {
    const visited = new Set();
    const redirects = [];
    let current = options.url;
    let previous = null;
    while (true) {
      if (visited.has(current)) throw Object.assign(failure("redirect_loop"), { networkLog: log() });
      visited.add(current);
      const response = await request({ ...options, url: current, redirect_from: previous });
      if (![301, 302, 303, 307, 308].includes(response.status)) return { ...response, final_url: current, redirects };
      if (redirects.length >= 5 || typeof response.headers.location !== "string") throw Object.assign(failure("invalid_or_excessive_redirects"), { networkLog: log() });
      let next;
      try { next = new URL(response.headers.location, current).href; }
      catch { throw Object.assign(failure("invalid_redirect_url"), { networkLog: log() }); }
      redirects.push({ from: current, to: next, status: response.status });
      previous = current;
      current = next;
    }
  };
  return Object.freeze({ request, fetch, log, policyHash, stop,
    rejectOverflow(code) { overflow += 1; throw Object.assign(failure(code), { networkLog: log() }); } });
}
