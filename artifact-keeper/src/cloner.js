'use strict';

const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

let chromium = null;
try {
  // playwright-core is optional at runtime; the app still works (in fetch-only
  // mode) if browser rendering is unavailable.
  ({ chromium } = require('playwright-core'));
} catch {
  chromium = null;
}

// Candidate locations for a Chromium/Chrome binary, tried in order.
const SYSTEM_BROWSERS = [
  process.env.ARTIFACT_KEEPER_CHROMIUM_PATH,
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
];

function resolveBrowserExecutable() {
  if (config.clone.chromiumPath && fs.existsSync(config.clone.chromiumPath)) {
    return config.clone.chromiumPath;
  }
  // Let Playwright locate its own managed browser if one was installed.
  if (chromium) {
    try {
      const p = chromium.executablePath();
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* not installed via playwright */
    }
  }
  for (const p of SYSTEM_BROWSERS) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function browserAvailable() {
  return !config.clone.disableBrowser && !!chromium && !!resolveBrowserExecutable();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Hash a normalised copy of the HTML so cosmetic whitespace churn does not
// register as a real change.
function contentHash(html) {
  return sha256(String(html).replace(/\s+/g, ' ').trim());
}

// --- Server-side asset fetching (avoids browser CORS restrictions) ---------

async function fetchAsset(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': config.clone.userAgent },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > config.clone.maxAssetBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > config.clone.maxAssetBytes) return null;
    const contentType =
      (res.headers.get('content-type') || '').split(';')[0].trim() ||
      'application/octet-stream';
    return { buf, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toDataUri(buf, contentType) {
  return `data:${contentType};base64,${buf.toString('base64')}`;
}

// Run async tasks with a bounded concurrency.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Inline url(...) references found inside a stylesheet as data URIs.
async function inlineCssUrls(cssText, cssBaseUrl) {
  const refs = [];
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const raw = m[2].trim();
    if (!raw || raw.startsWith('data:') || raw.startsWith('#')) continue;
    let abs;
    try {
      abs = new URL(raw, cssBaseUrl).href;
    } catch {
      continue;
    }
    refs.push({ raw, abs });
  }
  if (refs.length === 0) return cssText;
  const unique = [...new Map(refs.map((r) => [r.abs, r])).values()].slice(0, 60);
  const fetched = await mapLimit(unique, 6, async (r) => {
    const asset = await fetchAsset(r.abs);
    return { raw: r.raw, abs: r.abs, asset };
  });
  let out = cssText;
  for (const f of fetched) {
    if (!f.asset) continue;
    const dataUri = toDataUri(f.asset.buf, f.asset.contentType);
    out = out.split(`url(${f.raw})`).join(`url(${dataUri})`);
    out = out.split(`url('${f.raw}')`).join(`url('${dataUri}')`);
    out = out.split(`url("${f.raw}")`).join(`url("${dataUri}")`);
  }
  return out;
}

// --- Browser-based capture -------------------------------------------------

// Serialise one Playwright frame into a self-contained HTML string.
async function captureFrame(frame) {
  // Tag every external resource in the frame's DOM with a stable id so we can
  // rewrite it after fetching the bytes server-side.
  const refs = await frame.evaluate(() => {
    let id = 0;
    const out = [];
    const mark = (el, kind, url) => {
      if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
      el.setAttribute('data-ak-id', String(id));
      out.push({ id: String(id), kind, url });
      id += 1;
    };
    document
      .querySelectorAll('link[rel~="stylesheet"][href]')
      .forEach((el) => mark(el, 'css', el.href));
    document.querySelectorAll('script[src]').forEach((el) => mark(el, 'js', el.src));
    document.querySelectorAll('img[src]').forEach((el) => mark(el, 'img', el.src));
    document
      .querySelectorAll('link[rel~="icon"][href]')
      .forEach((el) => mark(el, 'icon', el.href));
    document
      .querySelectorAll('source[src]')
      .forEach((el) => mark(el, 'img', el.src));
    return out;
  });

  const baseUrl = frame.url();

  const fetched = await mapLimit(refs, 6, async (ref) => {
    const asset = await fetchAsset(ref.url);
    if (!asset) return { ...ref, ok: false };
    if (ref.kind === 'css') {
      const css = await inlineCssUrls(asset.buf.toString('utf8'), ref.url);
      return { ...ref, ok: true, kind: 'css', text: css };
    }
    if (ref.kind === 'js') {
      return { ...ref, ok: true, kind: 'js', text: asset.buf.toString('utf8') };
    }
    return { ...ref, ok: true, kind: ref.kind, dataUri: toDataUri(asset.buf, asset.contentType) };
  });

  // Apply the fetched content back into the DOM inside the frame.
  await frame.evaluate((payload) => {
    for (const item of payload) {
      const el = document.querySelector(`[data-ak-id="${item.id}"]`);
      if (!el) continue;
      el.removeAttribute('data-ak-id');
      if (!item.ok) continue;
      if (item.kind === 'css') {
        const style = document.createElement('style');
        style.textContent = item.text;
        el.replaceWith(style);
      } else if (item.kind === 'js') {
        const script = document.createElement('script');
        if (el.type) script.type = el.type;
        script.textContent = item.text;
        el.replaceWith(script);
      } else if (item.dataUri) {
        el.setAttribute('src', item.dataUri);
        if (el.hasAttribute('srcset')) el.removeAttribute('srcset');
      }
    }
    // Drop preloads/prefetch that now point at nothing useful.
    document
      .querySelectorAll('link[rel~="preload"],link[rel~="modulepreload"],link[rel~="prefetch"]')
      .forEach((el) => el.remove());
  }, fetched);

  return frame.content();
}

// Pick the frame that actually contains the artifact. Public Claude artifacts
// render inside a sandboxed child iframe, so we prefer the richest child frame
// and fall back to the main document.
async function selectPrimaryFrame(page) {
  const main = page.mainFrame();
  const children = page.frames().filter((f) => f !== main);
  let best = null;
  let bestScore = 0;
  for (const frame of children) {
    if (!frame.url() || frame.url() === 'about:blank') continue;
    let score = 0;
    try {
      score = await frame.evaluate(() => {
        if (!document.body) return 0;
        const text = (document.body.innerText || '').trim().length;
        const nodes = document.querySelectorAll('*').length;
        return text + nodes;
      });
    } catch {
      score = 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = frame;
    }
  }
  // Require a meaningful amount of content before preferring a child frame.
  return bestScore >= 40 ? best : main;
}

async function cloneWithBrowser(url) {
  const executablePath = resolveBrowserExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({
      userAgent: config.clone.userAgent,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: config.clone.timeoutMs });
    // Give client-rendered content and its sandboxed iframe time to settle.
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch {
      /* networkidle is best-effort */
    }
    await page.waitForTimeout(1500);

    const title = (await page.title()) || url;
    const frame = await selectPrimaryFrame(page);
    let html = await captureFrame(frame);

    // Ensure a doctype and charset so the hosted file renders predictably.
    if (!/<!doctype/i.test(html)) html = '<!DOCTYPE html>\n' + html;
    if (!/<meta[^>]+charset/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, '<head$1>\n<meta charset="utf-8">');
    }
    return { html, title, method: 'browser' };
  } finally {
    await browser.close().catch(() => {});
  }
}

// --- Fetch-only fallback ---------------------------------------------------

async function cloneWithFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.clone.userAgent },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Fetch failed with HTTP ${res.status}`);
  }
  let html = await res.text();
  const origin = new URL(url).origin;
  const base = new URL('./', url).href;

  // Without a DOM we cannot fully self-contain the page, so inject a <base>
  // tag making relative resources resolve against the original origin.
  if (!/<base\s/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${base}">`);
    } else {
      html = `<base href="${base}">\n` + html;
    }
  }
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : origin;
  return { html, title, method: 'fetch' };
}

// --- Public API ------------------------------------------------------------

async function cloneUrl(url) {
  let result;
  if (browserAvailable()) {
    try {
      result = await cloneWithBrowser(url);
    } catch (err) {
      // Fall back to a plain fetch if the browser path fails for any reason.
      result = await cloneWithFetch(url);
      result.warning = `Browser render failed (${err.message}); used fetch fallback.`;
    }
  } else {
    result = await cloneWithFetch(url);
    result.warning = 'Headless browser unavailable; used fetch fallback (clone is not fully self-contained).';
  }
  result.hash = contentHash(result.html);
  result.size = Buffer.byteLength(result.html, 'utf8');
  return result;
}

module.exports = {
  cloneUrl,
  browserAvailable,
  resolveBrowserExecutable,
  contentHash,
};
