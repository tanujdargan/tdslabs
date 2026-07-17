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

module.exports = db;
