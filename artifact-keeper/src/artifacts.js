'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const cloner = require('./cloner');

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function uniqueSlug(base) {
  let slug = base || 'artifact';
  let candidate = slug;
  let n = 1;
  while (db.prepare('SELECT 1 FROM artifacts WHERE slug = ?').get(candidate)) {
    candidate = `${slug}-${n++}`;
  }
  return candidate;
}

// Derive a stable slug hint from a Claude artifact URL when possible.
function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    if (/^[0-9a-f-]{8,}$/i.test(last)) return last.slice(0, 12);
    return slugify(last) || slugify(u.hostname);
  } catch {
    return '';
  }
}

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function listArtifacts() {
  return db
    .prepare(
      `SELECT a.*,
              (SELECT COUNT(*) FROM snapshots s WHERE s.artifact_id = a.id) AS snapshot_count
       FROM artifacts a
       ORDER BY a.created_at DESC`
    )
    .all();
}

function getArtifact(id) {
  return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
}

function getArtifactBySlug(slug) {
  return db.prepare('SELECT * FROM artifacts WHERE slug = ?').get(slug);
}

function listSnapshots(artifactId) {
  return db
    .prepare('SELECT * FROM snapshots WHERE artifact_id = ? ORDER BY created_at DESC, id DESC')
    .all(artifactId);
}

function getSnapshot(id) {
  return db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
}

function artifactDir(slug) {
  const dir = path.join(config.artifactsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createArtifact({ sourceUrl, title, isPublic, intervalMinutes }) {
  if (!isValidHttpUrl(sourceUrl)) {
    throw new Error('Please enter a valid http(s) URL.');
  }
  const base = uniqueSlug(slugFromUrl(sourceUrl) || 'artifact');
  const info = db
    .prepare(
      `INSERT INTO artifacts (slug, source_url, title, is_public, check_interval_minutes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      base,
      sourceUrl.trim(),
      (title || '').trim() || null,
      isPublic ? 1 : 0,
      Math.max(5, parseInt(intervalMinutes, 10) || config.defaultCheckIntervalMinutes)
    );
  return getArtifact(info.lastInsertRowid);
}

function updateArtifact(id, { title, isPublic, intervalMinutes, enabled }) {
  db.prepare(
    `UPDATE artifacts
       SET title = ?, is_public = ?, check_interval_minutes = ?, enabled = ?
     WHERE id = ?`
  ).run(
    (title || '').trim() || null,
    isPublic ? 1 : 0,
    Math.max(5, parseInt(intervalMinutes, 10) || config.defaultCheckIntervalMinutes),
    enabled ? 1 : 0,
    id
  );
  return getArtifact(id);
}

function deleteArtifact(id) {
  const artifact = getArtifact(id);
  if (!artifact) return;
  db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
  // Remove stored snapshot files.
  try {
    fs.rmSync(path.join(config.artifactsDir, artifact.slug), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// Clone the source URL and, if the content changed, persist a new snapshot.
// Returns { changed, snapshot|null, warning }.
async function refreshArtifact(id) {
  const artifact = getArtifact(id);
  if (!artifact) throw new Error('Artifact not found.');

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    const result = await cloner.cloneUrl(artifact.source_url);
    const latest = db
      .prepare('SELECT * FROM snapshots WHERE artifact_id = ? ORDER BY id DESC LIMIT 1')
      .get(id);

    const title = artifact.title || result.title || null;

    if (latest && latest.hash === result.hash) {
      db.prepare(
        `UPDATE artifacts SET last_checked_at = ?, last_status = 'unchanged',
                              last_error = NULL, title = COALESCE(title, ?) WHERE id = ?`
      ).run(now, title, id);
      return { changed: false, snapshot: null, warning: result.warning };
    }

    const dir = artifactDir(artifact.slug);
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.html`;
    fs.writeFileSync(path.join(dir, filename), result.html, 'utf8');

    const snapInfo = db
      .prepare(
        `INSERT INTO snapshots (artifact_id, hash, filename, size_bytes, method)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, result.hash, filename, result.size, result.method);

    db.prepare(
      `UPDATE artifacts
          SET last_checked_at = ?, last_status = ?, last_error = NULL,
              current_snapshot_id = ?, title = COALESCE(title, ?)
        WHERE id = ?`
    ).run(now, latest ? 'updated' : 'cloned', snapInfo.lastInsertRowid, title, id);

    return { changed: true, snapshot: getSnapshot(snapInfo.lastInsertRowid), warning: result.warning };
  } catch (err) {
    db.prepare(
      `UPDATE artifacts SET last_checked_at = ?, last_status = 'error', last_error = ? WHERE id = ?`
    ).run(now, String(err.message || err).slice(0, 500), id);
    throw err;
  }
}

// Read the HTML for the artifact's current (or a specific) snapshot.
function readSnapshotHtml(artifact, snapshot) {
  const file = path.join(config.artifactsDir, artifact.slug, snapshot.filename);
  return fs.readFileSync(file, 'utf8');
}

function getCurrentSnapshot(artifact) {
  if (artifact.current_snapshot_id) {
    const snap = getSnapshot(artifact.current_snapshot_id);
    if (snap) return snap;
  }
  return db
    .prepare('SELECT * FROM snapshots WHERE artifact_id = ? ORDER BY id DESC LIMIT 1')
    .get(artifact.id);
}

module.exports = {
  isValidHttpUrl,
  listArtifacts,
  getArtifact,
  getArtifactBySlug,
  listSnapshots,
  getSnapshot,
  createArtifact,
  updateArtifact,
  deleteArtifact,
  refreshArtifact,
  readSnapshotHtml,
  getCurrentSnapshot,
};
