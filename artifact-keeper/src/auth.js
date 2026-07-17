'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const SALT_ROUNDS = 12;

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createUser(username, password) {
  const clean = String(username || '').trim();
  if (!clean) throw new Error('Username is required.');
  if (!password || String(password).length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const hash = bcrypt.hashSync(String(password), SALT_ROUNDS);
  const info = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(clean, hash);
  return getUserById(info.lastInsertRowid);
}

// Async so the ~300ms bcrypt work doesn't block the event loop during a login.
// No dummy-compare: for a single-admin app, username enumeration isn't a real
// threat, so the timing mitigation isn't worth blocking on.
async function verifyCredentials(username, password) {
  const user = getUserByUsername(String(username || '').trim());
  if (!user) return null;
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  return ok ? user : null;
}

// Seed an admin account from env vars for unattended installs. Only runs when
// there are no users yet, so it never clobbers an existing account.
function seedAdminIfConfigured() {
  if (countUsers() > 0) return;
  if (config.seedAdminUser && config.seedAdminPassword) {
    createUser(config.seedAdminUser, config.seedAdminPassword);
    // eslint-disable-next-line no-console
    console.log(`[auth] Seeded admin user "${config.seedAdminUser}" from environment.`);
  }
}

// --- CSRF helpers (double-submit token stored in the session) -------------

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function verifyCsrf(req, res, next) {
  const sent = req.body && req.body._csrf;
  if (!sent || sent !== req.session.csrfToken) {
    res.status(403).render('error', {
      title: 'Invalid request',
      message: 'Your session token was invalid or expired. Please try again.',
    });
    return;
  }
  next();
}

// --- Route guards ----------------------------------------------------------

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  if (req.method === 'GET') {
    req.session.returnTo = req.originalUrl;
  }
  return res.redirect('/login');
}

function requireSetup(req, res, next) {
  // When no user exists, force the visitor through the first-run setup flow.
  if (countUsers() === 0 && !req.path.startsWith('/setup') && !req.path.startsWith('/a/')) {
    return res.redirect('/setup');
  }
  next();
}

module.exports = {
  countUsers,
  getUserByUsername,
  getUserById,
  createUser,
  verifyCredentials,
  seedAdminIfConfigured,
  ensureCsrfToken,
  verifyCsrf,
  requireAuth,
  requireSetup,
};
