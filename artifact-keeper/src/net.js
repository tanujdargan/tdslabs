'use strict';

// Shared SSRF-safe destination policy. Every outbound request the cloner makes
// (initial navigation, subresources, redirects) goes through here so a hostile
// artifact or its assets can't reach services on the host's private network.
//
// ponytail: resolve-then-check has a DNS-rebinding TOCTOU window (the name may
// resolve differently between this check and the actual connect). Closing it
// means pinning the resolved IP into the socket; for a trusted home-lab mirror
// the resolve-and-reject check is the pragmatic ceiling. Pin the IP if this is
// ever exposed to untrusted submitters.

const dns = require('dns').promises;
const net = require('net');

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + (Number(o) & 0xff), 0) >>> 0;
}

function inV4Range(int, cidrBase, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (int & mask) === (ipv4ToInt(cidrBase) & mask);
}

// Private, loopback, link-local, and other non-public IPv4 ranges.
function isPrivateIPv4(ip) {
  const int = ipv4ToInt(ip);
  return (
    inV4Range(int, '0.0.0.0', 8) ||       // "this" network
    inV4Range(int, '10.0.0.0', 8) ||      // private
    inV4Range(int, '100.64.0.0', 10) ||   // CGNAT
    inV4Range(int, '127.0.0.0', 8) ||     // loopback
    inV4Range(int, '169.254.0.0', 16) ||  // link-local (incl. cloud metadata)
    inV4Range(int, '172.16.0.0', 12) ||   // private
    inV4Range(int, '192.0.0.0', 24) ||    // IETF protocol assignments
    inV4Range(int, '192.168.0.0', 16) ||  // private
    inV4Range(int, '198.18.0.0', 15) ||   // benchmarking
    inV4Range(int, '224.0.0.0', 4) ||     // multicast
    inV4Range(int, '240.0.0.0', 4)        // reserved
  );
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true; // link-local + unique-local
  }
  return false;
}

function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // unknown format — refuse
}

// Validate a URL is http(s) and does not resolve to a private/reserved address.
async function assertPublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }
  const host = u.hostname;
  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const records = await dns.lookup(host, { all: true }).catch(() => []);
    ips = records.map((r) => r.address);
  }
  if (ips.length === 0) throw new Error(`Host "${host}" did not resolve.`);
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new Error(`Refusing to fetch a private/reserved address (${ip}).`);
    }
  }
  return u;
}

// fetch() that validates the target (and every redirect hop) against the SSRF
// policy, with a timeout. Returns the final Response.
async function safeFetch(rawUrl, { headers, timeoutMs = 20000, maxRedirects = 6 } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, { headers, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}

// Read a Response body with a hard byte cap (rejects oversized payloads).
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) return null;
  return buf;
}

module.exports = { isPrivateIp, assertPublicUrl, safeFetch, readCapped };

// ponytail: self-check the range logic — the security-critical part.
if (require.main === module) {
  const assert = require('assert');
  for (const bad of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.5', '172.16.9.9', '100.64.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert(isPrivateIp(bad), `${bad} should be private`);
  }
  for (const ok of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']) {
    assert(!isPrivateIp(ok), `${ok} should be public`);
  }
  // eslint-disable-next-line no-console
  console.log('net.js self-check passed');
}
