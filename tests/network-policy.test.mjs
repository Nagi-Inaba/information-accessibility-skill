import assert from "node:assert/strict";
import test from "node:test";
import { createNetworkPolicy, networkPolicyErrors, networkPolicyHash, networkRequestDecision, networkScopeSummary } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";

const policy = () => createNetworkPolicy({ targetOrigins: ["https://site.example", "https://cdn.example"], sourceUrls: ["https://standards.example/spec?version=1"] });
const caller = { network: "allowlisted", allowedOrigins: ["https://site.example", "https://cdn.example", "https://standards.example"] };
const request = (extra = {}) => ({ url: "https://site.example/page", purpose: "target", method: "GET", resource_type: "main_document", adapter: "node-http-pinned-v1", ...extra });
const decision = (p, extra, c = caller) => networkRequestDecision(p, request(extra), c);

test("allowlisted policy needs concrete bounded destinations and exact supported enforcement fields", () => {
  assert.throws(() => createNetworkPolicy(), /explicit origin/);
  const p = policy();
  assert.deepEqual(networkPolicyErrors(p), []);
  for (const change of [{ methods: [] }, { methods: ["POST"] }, { deny_private_networks: false }, { dns: "system" }, { enforcement: "host_promises" }, { max_response_bytes: 10485761 }, { max_requests: 1001 }, { extra: true }]) {
    assert.ok(networkPolicyErrors({ ...p, ...change }).length, JSON.stringify(change));
  }
  for (const value of ["https://user:secret@site.example", "https://site.example./", "https://site.example/path", "https://site.example/?secret=1", "https://*.example", "file:///tmp/a"]) {
    assert.throws(() => createNetworkPolicy({ targetOrigins: [value] }), undefined, value);
  }
  assert.throws(() => createNetworkPolicy({ targetUrls: ["https://site.example/page#part"] }), /fragments/);
});

test("request decisions intersect run and caller scope and never infer standard-source permission from target scope", () => {
  const p = policy();
  assert.equal(decision(p, {}).allowed, true);
  assert.equal(decision(p, {}, { network: "denied" }).reason, "caller_authorization_missing");
  assert.equal(decision(p, {}, { network: "allowlisted", allowedOrigins: ["https://other.example"] }).reason, "outside_caller_scope");
  assert.equal(decision(p, { url: "https://other.example" }).reason, "outside_run_scope");
  assert.equal(decision(p, { url: "https://standards.example/spec?version=1" }).reason, "outside_run_scope");
  assert.equal(decision(p, { url: "https://standards.example/spec?version=1", purpose: "standards_source", resource_type: "source_document" }).allowed, true);
  assert.equal(decision(p, { url: "https://standards.example/spec?version=2", purpose: "standards_source", resource_type: "source_document" }).reason, "outside_run_scope");
  assert.equal(decision(p, { purpose: "standards_source" }).allowed, false);
  assert.equal(decision(p, { adapter: "host-browser-tool" }).reason, "adapter_cannot_enforce_policy");
  assert.equal(decision(p, { method: "POST" }).reason, "method_not_allowed");
  assert.equal(decision(p, { method: "HEAD" }, { ...caller, methods: ["GET"] }).reason, "caller_method_not_allowed");
});

test("exact URLs include query strings and cannot be widened by caller origins", () => {
  const p = createNetworkPolicy({ targetUrls: ["https://site.example/page?q=1"] });
  assert.equal(decision(p, { url: "https://site.example/page?q=1" }).allowed, true);
  for (const url of ["https://site.example/page", "https://site.example/page?q=2", "https://site.example/other"]) assert.equal(decision(p, { url }).reason, "outside_run_scope");
  assert.equal(decision(policy(), {}, { network: "allowlisted", exactUrls: ["https://site.example/other"] }).reason, "outside_caller_scope");
});

test("redirect, iframe and subresource decisions remain distinct at every hop", () => {
  const p = policy();
  assert.equal(decision(p, { redirect_from: "https://site.example/old" }).allowed, true);
  assert.equal(decision(p, { url: "https://cdn.example/new", redirect_from: "https://site.example/old" }).reason, "cross_origin_redirect_denied");
  assert.equal(decision({ ...p, redirects: "allowlisted" }, { url: "https://cdn.example/new", redirect_from: "https://site.example/old" }).allowed, true);
  for (const resource_type of ["iframe", "subresource"]) {
    assert.equal(decision(p, { resource_type, initiator_url: "https://site.example/parent" }).allowed, true);
    assert.equal(decision(p, { url: "https://cdn.example/a", resource_type, initiator_url: "https://site.example/parent" }).reason, "cross_origin_resource_denied");
    assert.equal(decision(p, { resource_type }).reason, "initiator_not_declared");
  }
  assert.equal(decision({ ...p, iframes: "declared" }, { url: "https://cdn.example/a", resource_type: "iframe" }).allowed, true);
  assert.equal(decision({ ...p, subresources: "denied" }, { resource_type: "subresource" }).reason, "resource_type_denied");
  assert.equal(decision({ ...p, iframes: "declared" }, { url: "https://cdn.example/new", resource_type: "iframe", redirect_from: "https://site.example/frame" }).reason, "cross_origin_redirect_denied");
});

test("localhost exception requires both explicit run and caller flags and public summary omits URLs", () => {
  const p = createNetworkPolicy({ targetOrigins: ["http://127.0.0.1:1234"], allowLocalhost: true });
  const c = { network: "allowlisted", allowedOrigins: ["http://127.0.0.1:1234"] };
  assert.equal(decision(p, { url: "http://127.0.0.1:1234/" }, c).allow_localhost, false);
  assert.equal(decision(p, { url: "http://127.0.0.1:1234/" }, { ...c, allowLocalhost: true }).allow_localhost, true);
  const publicScope = networkScopeSummary({ network: "allowlisted", network_policy: p }, { publicOutput: true });
  assert.doesNotMatch(JSON.stringify(publicScope), /127\.0\.0\.1|1234/);
  assert.equal(networkScopeSummary({ network: "allowlisted" }).mode, "unverified_legacy");
  assert.match(networkPolicyHash(p), /^[a-f0-9]{64}$/);
  assert.notEqual(networkPolicyHash(p), networkPolicyHash({ ...p, methods: ["HEAD"] }));
});
