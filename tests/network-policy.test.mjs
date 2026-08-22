import assert from "node:assert/strict";
import test from "node:test";
import { authorizeNetworkRequest, validateNetworkPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";

const policy = {
  mode: "allowlist",
  origins: ["https://example.invalid", "https://static.example.invalid"],
  methods: ["GET", "HEAD"],
  redirects: "same_origin",
  credentials: "omit",
  max_response_bytes: 2_000_000
};

test("an exact allowlisted GET receives explicit side-effect-free request limits", () => {
  const authorization = authorizeNetworkRequest({ url: "https://example.invalid/wcag/page", method: "GET" }, policy);
  assert.equal(authorization.allowed, true);
  assert.equal(authorization.origin, "https://example.invalid");
  assert.equal(authorization.credentials, "omit");
  assert.equal(authorization.max_response_bytes, 2_000_000);
});

test("denied mode, non-allowlisted origins, and mutating methods fail closed", () => {
  assert.throws(() => authorizeNetworkRequest({ url: "https://example.invalid/" }, { mode: "denied" }), /denied by policy/u);
  assert.throws(() => authorizeNetworkRequest({ url: "https://other.invalid/" }, policy), /not allowlisted/u);
  assert.throws(() => authorizeNetworkRequest({ url: "https://example.invalid/", method: "POST" }, policy), /not allowed/u);
  assert.throws(() => validateNetworkPolicy({ ...policy, methods: ["GET", "POST"] }), /Only GET and HEAD/u);
});

test("wildcards, credentials, private networks, and non-standard ports are rejected", () => {
  assert.throws(() => validateNetworkPolicy({ ...policy, origins: ["https://*.example.invalid"] }), /without wildcards/u);
  assert.throws(() => validateNetworkPolicy({ ...policy, origins: ["https://user:pass@example.invalid"] }), /credentials/u);
  assert.throws(() => validateNetworkPolicy({ ...policy, origins: ["https://127.0.0.1"] }), /Private or local/u);
  assert.throws(() => validateNetworkPolicy({ ...policy, origins: ["https://[::1]"] }), /Private or local/u);
  assert.throws(() => validateNetworkPolicy({ ...policy, origins: ["https://example.invalid:8443"] }), /Non-standard HTTPS port/u);
  assert.doesNotThrow(() => validateNetworkPolicy({ ...policy, origins: ["https://fc-example.invalid"] }));
});

test("redirect policy distinguishes same-origin from an explicit allowlisted redirect", () => {
  assert.throws(() => authorizeNetworkRequest({
    url: "https://static.example.invalid/final",
    method: "GET",
    redirectFrom: "https://example.invalid/start"
  }, policy), /Cross-origin redirects/u);

  const allowed = authorizeNetworkRequest({
    url: "https://static.example.invalid/final",
    method: "GET",
    redirectFrom: "https://example.invalid/start"
  }, { ...policy, redirects: "allowlisted_origins" });
  assert.equal(allowed.redirect_mode, "allowlisted_origins");
});

test("response size must be explicit and positive", () => {
  assert.throws(() => validateNetworkPolicy({ ...policy, max_response_bytes: 0 }), /positive integer/u);
  assert.throws(() => validateNetworkPolicy({ ...policy, max_response_bytes: undefined }), /positive integer/u);
});
