import assert from "node:assert/strict";
import test from "node:test";

import {
  hasReservedHostnameSuffix,
  isExplicitLoopback,
  isNonPublicHostname,
  isPrivateAddress,
  isPrivateIpv4,
  normalizeIpLiteral
} from "../codex/skills/information-accessibility-practice/scripts/lib/network-address.mjs";

const nonPublicIpv4 = [
  "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1",
  "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255",
  "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255"
];
const publicIpv4 = [
  "1.1.1.1", "8.8.8.8", "93.184.216.34", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1",
  "198.17.0.1", "198.20.0.1", "223.255.255.255"
];
const nonPublicIpv6 = [
  "::", "::1", "::ffff:10.0.0.5", "::ffff:172.17.0.1", "::ffff:192.168.1.1", "::ffff:7f00:1", "::ffff:a00:5",
  "64:ff9b::a00:1", "2002:7f00:1::", "fe80::1", "fec0::1", "fc00::1", "fd12:3456::1", "ff02::1", "100::1",
  "2001:db8::1", "2001::1", "2001:20::1", "3fff::1"
];
const publicIpv6 = ["2001:4860:4860::8888", "2606:4700:4700::1111", "2a00:1450:4001:81b::200e"];

test("IPv4 and IPv6 literals are classified as non-global or global unicast", () => {
  for (const value of [...nonPublicIpv4, ...nonPublicIpv6]) assert.equal(isPrivateAddress(value), true, value);
  for (const value of [...publicIpv4, ...publicIpv6]) assert.equal(isPrivateAddress(value), false, value);
});

test("malformed IPv4 text fails closed instead of being treated as public", () => {
  for (const value of ["1.2.3", "256.1.1.1", "1..2.3", "a.b.c.d", "1.2.3.4.5", "0x7f.0.0.1", ""]) {
    assert.equal(isPrivateIpv4(value), true, value);
  }
});

test("hostnames and bracketed literals share the address rules", () => {
  for (const value of [...nonPublicIpv4, ...publicIpv4]) {
    assert.equal(isNonPublicHostname(value), isPrivateAddress(value), value);
  }
  for (const value of [...nonPublicIpv6, ...publicIpv6]) {
    assert.equal(isNonPublicHostname(`[${value}]`), isPrivateAddress(value), value);
  }
});

test("single-label names and reserved suffixes are non-public; ordinary public names are not", () => {
  for (const host of [
    "localhost", "app.localhost", "printer.local", "nas.lan", "wiki.internal", "intranet.corp", "router.home.arpa",
    "host.localdomain", "build.test", "foo.invalid", "demo.example", "intranet", "intranet.corp."
  ]) {
    assert.equal(isNonPublicHostname(host), true, host);
  }
  for (const host of ["example.com", "www.w3.org", "sub.example.org", "waic.jp"]) {
    assert.equal(isNonPublicHostname(host), false, host);
  }
  assert.equal(hasReservedHostnameSuffix("Intranet.CORP."), true);
  assert.equal(hasReservedHostnameSuffix("example.com"), false);
});

test("literal normalization removes brackets, zone ids and case", () => {
  assert.equal(normalizeIpLiteral(" [FE80::1%eth0] "), "fe80::1");
  assert.equal(isExplicitLoopback("LOCALHOST"), true);
  assert.equal(isExplicitLoopback("127.9.9.9"), true);
  assert.equal(isExplicitLoopback("[::1]"), true);
  assert.equal(isExplicitLoopback("10.0.0.1"), false);
  assert.equal(isExplicitLoopback("example.com"), false);
});
