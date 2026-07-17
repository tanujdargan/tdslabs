#!/usr/bin/env node
'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const scheduler = require('./scheduler');
const cloner = require('./cloner');

const SqliteStore = require('better-sqlite3-session-store')(session);

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// Strict headers (incl. CSP) for the dashboard. `upgrade-insecure-requests` is
// dropped so the app still works on a plain-HTTP LAN. Cloned artifacts get a
// relaxed set instead — they carry their own inline scripts and are served
// with a `sandbox` CSP (opaque origin) in routes/public.js, so they can't
// touch the dashboard's origin, cookies, or CSRF token.
const strictHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: { 'upgrade-insecure-requests': null },
  },
});
const artifactHelmet = helmet({
  contentSecurityPolicy: false,
  frameguard: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  hsts: false,
});
app.use((req, res, next) => {
  if (req.path.startsWith('/a/')) return artifactHelmet(req, res, next);
  return strictHelmet(req, res, next);
});

app.use(
  session({
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'ak.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookie,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// When a dedicated artifact host is configured, it must serve ONLY artifact,
// health, and static routes — never login/setup/dashboard, so no session cookie
// is ever set on that host. That keeps it cookie-free, which is what makes
// same-origin storage safe for cloned pages there.
if (config.artifactHost) {
  app.use((req, res, next) => {
    if (req.hostname.toLowerCase() !== config.artifactHost) return next();
    const allowed =
      req.path === '/health' || req.path.startsWith('/a/') || req.path.startsWith('/static/');
    if (!allowed) return res.status(404).type('text/plain').send('Not found');
    next();
  });
}

// Public artifact hosting + health are mounted first — before the template-data
// middleware — so anonymous visitors to /a/:slug and /health never touch the
// session (no CSRF token, no flash), which would otherwise persist a session
// row per request and bloat the store.
app.use('/', require('./routes/public'));

// Expose common template data (only reached by the authenticated app below).
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? auth.getUserById(req.session.userId)
    : null;
  res.locals.baseUrl = config.baseUrl;
  res.locals.artifactBaseUrl = config.artifactBaseUrl;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  // Generate the CSRF token lazily so a view that never references it doesn't
  // needlessly mutate the session.
  Object.defineProperty(res.locals, 'csrfToken', {
    configurable: true,
    enumerable: true,
    get: () => auth.ensureCsrfToken(req),
  });
  next();
});

// Force first-run setup when no account exists.
app.use(auth.requireSetup);

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));

// 404 + error handlers.
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: config.env === 'development' ? String(err.stack || err) : 'Internal server error.',
  });
});

auth.seedAdminIfConfigured();
scheduler.start();

const server = app.listen(config.port, config.host, () => {
  const where = `${config.host}:${config.port}`;
  // eslint-disable-next-line no-console
  console.log(`Artifact Keeper listening on http://${where}`);
  // eslint-disable-next-line no-console
  console.log(
    `[clone] browser rendering: ${cloner.browserAvailable() ? 'enabled (' + cloner.resolveBrowserExecutable() + ')' : 'DISABLED (fetch-only fallback)'}`
  );
  if (auth.countUsers() === 0) {
    // eslint-disable-next-line no-console
    console.log('[setup] No users yet — open the app in a browser to create the admin account.');
  }
});

function shutdown() {
  // eslint-disable-next-line no-console
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
