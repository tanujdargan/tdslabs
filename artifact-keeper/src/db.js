'use strict';

const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                   TEXT NOT NULL UNIQUE,
  source_url             TEXT NOT NULL,
  title                  TEXT,
  is_public              INTEGER NOT NULL DEFAULT 1,
  check_interval_minutes INTEGER NOT NULL DEFAULT 360,
  enabled                INTEGER NOT NULL DEFAULT 1,
  last_checked_at        TEXT,
  last_status            TEXT,
  last_error             TEXT,
  current_snapshot_id    INTEGER,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  hash        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  method      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_artifact ON snapshots(artifact_id);
`);

// --- Migrations ------------------------------------------------------------

// Add the `role` column to pre-existing databases created before roles existed.
// SQLite permits ALTER TABLE ADD COLUMN with a constant default + CHECK, so this
// backfills every existing row to 'user'. Idempotent: skipped once present.
const hasRoleColumn = db
  .prepare("PRAGMA table_info(users)")
  .all()
  .some((col) => col.name === 'role');
if (!hasRoleColumn) {
  db.exec(
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user'))"
  );
}

// Always keep at least one admin: after the migration above, a legacy database
// could have users but no admin (everyone defaulted to 'user'), which would lock
// all administrative actions out permanently. Promote the lowest-id user so the
// instance is never left with zero admins. Runs every boot but is a no-op once
// an admin exists.
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount > 0) {
  const adminCount = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    .get().n;
  if (adminCount === 0) {
    db.prepare(
      "UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)"
    ).run();
  }
}

module.exports = db;
