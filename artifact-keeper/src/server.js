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

// Keep useful security headers but avoid breaking hosting/embedding of cloned
// artifacts (which contain their own inline scripts and may be iframed).
app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: false,
  })
);

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

// Expose common template data.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? auth.getUserById(req.session.userId)
    : null;
  res.locals.csrfToken = auth.ensureCsrfToken(req);
  res.locals.baseUrl = config.baseUrl;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// Public artifact hosting + health are mounted before the setup gate so cloned
// pages stay reachable regardless of app state.
app.use('/', require('./routes/public'));

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
