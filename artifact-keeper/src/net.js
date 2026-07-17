'use strict';

// Shared SSRF-safe destination policy. Every outbound request the cloner makes
// (initial navigation, subresources, redirects) goes through here so a hostile
// artifact or its assets can't reach services on the host's private network.
//
// Server-side fetches use Node's http/https with a custom `lookup`, so the SAME
// DNS answer that passes the private-address check is the one the socket
// connects to — closing the resolve-then-connect (DNS-rebinding) window without
// a second, unchecked resolution.
//
// ponytail: the headless-browser path can't pin per-connection the same way, so
// its rebinding window stays open — enforce private-network egress at the OS /
// firewall layer if you run browser mode against untrusted submitters.

const http = require('http');
const https = require('https');
const dns = require('dns');
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

// Parse an IPv6 literal (incl. :: compression and embedded IPv4) into 16 bytes.
function ipv6ToBytes(ip) {
  let s = ip.split('%')[0].toLowerCase(); // drop zone id
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // embedded IPv4 tail
  if (m) {
    const o = m[2].split('.').map(Number);
    if (o.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return null;
    s = m[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(':') : [];
  const tail = dbl[1] !== undefined ? (dbl[1] ? dbl[1].split(':') : []) : null;
  let groups;
  if (tail === null) {
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = head.concat(Array(fill).fill('0'), tail);
  }
  if (groups.length !== 8) return null;
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    const v = parseInt(groups[i] || '0', 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    bytes.writeUInt16BE(v, i * 2);
  }
  return bytes;
}

function isPrivateIPv6(ip) {
  const b = ipv6ToBytes(ip);
  if (!b) return true; // unparseable → refuse
  const embeddedV4 = () => isPrivateIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  // ::/128 unspecified and ::1/128 loopback
  if (b.slice(0, 15).every((x) => x === 0) && (b[15] === 0 || b[15] === 1)) return true;
  // fc00::/7 unique-local
  if ((b[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 link-local (covers fe80..febf, not just fe80)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  // ::ffff:0:0/96 IPv4-mapped (e.g. ::ffff:7f00:1) → check the embedded v4
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return embeddedV4();
  }
  // ::/96 deprecated IPv4-compatible (::a.b.c.d) → check the embedded v4
  if (b.slice(0, 12).every((x) => x === 0) && !(b[12] === 0 && b[13] === 0 && b[14] === 0)) {
    return embeddedV4();
  }
  return false;
}

function isPrivateIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // unknown format — refuse
}

// A dns.lookup-compatible function that rejects private/reserved answers. Used
// as the `lookup` option on http/https requests so validation and connection
// share one resolution (no DNS-rebinding gap).
function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options || {};
  const lookupOpts = { all: true };
  if (opts.family) lookupOpts.family = opts.family;
  if (opts.hints) lookupOpts.hints = opts.hints;
  dns.lookup(hostname, lookupOpts, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || 4 }];
    for (const a of list) {
      if (isPrivateIp(a.address)) {
        return cb(new Error(`Refusing to connect to a private/reserved address (${a.address}).`));
      }
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

// One-shot validation for callers that must reject a URL up front (before
// persisting an artifact, or before a browser navigation the request router
// then re-checks). The authoritative enforcement for server-side fetches is
// safeLookup at connect time.
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
    const records = await dns.promises.lookup(host, { all: true }).catch(() => []);
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

// Perform one request (no redirect following). Streams the body with a running
// byte cap and a deadline that stays armed until the body is fully read, so a
// slow or oversized response can't hang or exhaust memory. Resolves either
// { redirect } or { ok, status, contentType, buffer } (buffer is null if the
// size cap was exceeded).
function requestOnce(rawUrl, { headers, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(rawUrl);
    } catch {
      return reject(new Error('Invalid URL.'));
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return reject(new Error('Only http(s) URLs are allowed.'));
    }
    // IP-literal hosts skip `lookup`, so safeLookup never sees them — check here.
    const literal = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal) && isPrivateIp(literal)) {
      return reject(new Error(`Refusing to connect to a private/reserved address (${literal}).`));
    }
    const lib = u.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const req = lib.request(
      u,
      { method: 'GET', headers: { 'Accept-Encoding': 'identity', ...headers }, lookup: safeLookup },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume(); // drain
          let next;
          try {
            next = new URL(location, u).href;
          } catch {
            return done(reject, new Error('Invalid redirect location.'));
          }
          return done(resolve, { redirect: next });
        }
        const contentType =
          (res.headers['content-type'] || '').split(';')[0].trim() || 'application/octet-stream';
        const declared = Number(res.headers['content-length'] || 0);
        const ok = status >= 200 && status < 300;
        if (declared && declared > maxBytes) {
          res.destroy();
          return done(resolve, { ok, status, contentType, buffer: null });
        }
        const chunks = [];
        let total = 0;
        let over = false;
        res.on('data', (c) => {
          if (over) return;
          total += c.length;
          if (total > maxBytes) {
            over = true;
            res.destroy();
            done(resolve, { ok, status, contentType, buffer: null });
          } else {
            chunks.push(c);
          }
        });
        res.on('end', () => done(resolve, { ok, status, contentType, buffer: Buffer.concat(chunks) }));
        res.on('error', (e) => done(reject, e));
      }
    );

    const timer = setTimeout(() => req.destroy(new Error('Request timed out.')), timeoutMs);
    req.on('error', (e) => done(reject, e));
    req.end();
  });
}

// http(s) GET that validates the target and every redirect hop against the SSRF
// policy (via safeLookup at connect time), with a deadline and byte cap.
async function safeFetch(rawUrl, { headers = {}, timeoutMs = 20000, maxBytes = 32 * 1024 * 1024, maxRedirects = 6 } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const r = await requestOnce(current, { headers, timeoutMs, maxBytes });
    if (r.redirect) {
      current = r.redirect;
      continue;
    }
    return r;
  }
  throw new Error('Too many redirects.');
}

module.exports = { isPrivateIp, assertPublicUrl, safeFetch };

// ponytail: self-check the range logic — the security-critical part.
if (require.main === module) {
  const assert = require('assert');
  const priv = [
    '127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.5', '172.16.9.9',
    '100.64.0.1', '::1', '::', 'fe80::1', 'fe90::1', 'fea0::1', 'febf::1',
    'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.1.1',
  ];
  for (const bad of priv) assert(isPrivateIp(bad), `${bad} should be private`);
  const pub = [
    '8.8.8.8', '1.1.1.1', '93.184.216.34',
    '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8', '2001:4860:4860::8888',
  ];
  for (const ok of pub) assert(!isPrivateIp(ok), `${ok} should be public`);
  // eslint-disable-next-line no-console
  console.log('net.js self-check passed');
}
