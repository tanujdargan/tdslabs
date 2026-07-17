'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

// Data directory holds the SQLite database and cloned artifact snapshots.
const dataDir = path.resolve(
  process.env.ARTIFACT_KEEPER_DATA_DIR || path.join(process.cwd(), 'data')
);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'artifacts'), { recursive: true });

// Persist a session secret across restarts unless one is supplied via env.
function resolveSessionSecret() {
  if (process.env.ARTIFACT_KEEPER_SESSION_SECRET) {
    return process.env.ARTIFACT_KEEPER_SESSION_SECRET;
  }
  const secretFile = path.join(dataDir, '.session-secret');
  try {
    return fs.readFileSync(secretFile, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }
}

const config = {
  env: process.env.NODE_ENV || 'production',
  host: process.env.ARTIFACT_KEEPER_HOST || '0.0.0.0',
  port: envInt('ARTIFACT_KEEPER_PORT', 8787),
  // Public base URL used when displaying share links (no trailing slash).
  baseUrl: (process.env.ARTIFACT_KEEPER_BASE_URL || '').replace(/\/$/, ''),
  // Optional dedicated, cookie-free hostname for serving cloned artifacts (e.g.
  // "view.example.com"). When set, public artifacts are served only there — with
  // same-origin storage enabled — while the session-bearing dashboard stays on
  // the main host, so a cloned page can never reach the dashboard's origin.
  artifactHost: (process.env.ARTIFACT_KEEPER_ARTIFACT_HOST || '').trim().toLowerCase(),
  dataDir,
  dbPath: path.join(dataDir, 'artifact-keeper.db'),
  artifactsDir: path.join(dataDir, 'artifacts'),
  sessionSecret: resolveSessionSecret(),
  // Set to true only when serving over HTTPS so the cookie is marked Secure.
  secureCookie: envBool('ARTIFACT_KEEPER_SECURE_COOKIE', false),
  // Optional admin seed for unattended installs (used only if no user exists).
  seedAdminUser: process.env.ARTIFACT_KEEPER_ADMIN_USER || '',
  seedAdminPassword: process.env.ARTIFACT_KEEPER_ADMIN_PASSWORD || '',
  // Default re-check interval for newly added artifacts, in minutes.
  defaultCheckIntervalMinutes: envInt('ARTIFACT_KEEPER_DEFAULT_INTERVAL', 360),
  // How often the scheduler wakes to look for artifacts that are due.
  schedulerCron: process.env.ARTIFACT_KEEPER_SCHEDULER_CRON || '*/5 * * * *',
  // Cloning behaviour.
  clone: {
    // Explicit path to a Chromium/Chrome binary. When empty, the cloner tries
    // Playwright's bundled browser, then common system locations.
    chromiumPath: process.env.ARTIFACT_KEEPER_CHROMIUM_PATH || '',
    // Disable headless browser rendering entirely and use plain HTTP fetch.
    disableBrowser: envBool('ARTIFACT_KEEPER_DISABLE_BROWSER', false),
    // Max time to wait for a page to settle, in milliseconds.
    timeoutMs: envInt('ARTIFACT_KEEPER_CLONE_TIMEOUT_MS', 45000),
    // Max size (bytes) for a single inlined asset. Larger assets are skipped.
    maxAssetBytes: envInt('ARTIFACT_KEEPER_MAX_ASSET_BYTES', 8 * 1024 * 1024),
    // Max size (bytes) for a fetched page in fetch-only fallback mode.
    maxHtmlBytes: envInt('ARTIFACT_KEEPER_MAX_HTML_BYTES', 16 * 1024 * 1024),
    userAgent:
      process.env.ARTIFACT_KEEPER_USER_AGENT ||
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
};

// Absolute base for public artifact share links (the artifact host if set,
// else whatever baseUrl the dashboard uses).
config.artifactBaseUrl = config.artifactHost ? `https://${config.artifactHost}` : config.baseUrl;

module.exports = config;
