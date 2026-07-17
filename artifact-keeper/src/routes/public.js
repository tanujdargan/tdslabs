'use strict';

const express = require('express');
const artifacts = require('../artifacts');
const config = require('../config');

const router = express.Router();

function onArtifactHost(req) {
  return config.artifactHost && req.hostname.toLowerCase() === config.artifactHost;
}

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve the current (or a specific) snapshot of an artifact as raw HTML.
function serveSnapshot(req, res, artifact, snapshot) {
  // With a dedicated artifact host, public artifacts are viewable only there
  // (cookie-free, so they get same-origin storage). Bounce dashboard-host links.
  if (config.artifactHost && artifact.is_public && !onArtifactHost(req)) {
    return res.redirect(302, `https://${config.artifactHost}${req.originalUrl}`);
  }
  // Private artifacts require an authenticated session, so they stay on the
  // session-bearing dashboard host (served with the strict opaque sandbox).
  if (!artifact.is_public && !(req.session && req.session.userId)) {
    return res.status(403).render('error', {
      title: 'Private artifact',
      message: 'This artifact is private. Sign in to view it.',
    });
  }
  if (!snapshot) {
    return res.status(404).render('error', {
      title: 'Not captured yet',
      message: 'This artifact has no snapshot yet. Trigger a refresh from the dashboard.',
    });
  }
  let html;
  try {
    html = artifacts.readSnapshotHtml(artifact, snapshot);
  } catch {
    return res.status(500).render('error', {
      title: 'Snapshot unavailable',
      message: 'The snapshot file could not be read.',
    });
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('X-Artifact-Snapshot', String(snapshot.id));
  // Sandbox the cloned page so its (untrusted) inline scripts can't act on the
  // app. On the dedicated, cookie-free artifact host we add `allow-same-origin`
  // so real artifacts can use localStorage/IndexedDB/cookies — safe there
  // because that origin carries no session. Everywhere else we withhold it,
  // giving an opaque origin that can't reach the dashboard's cookies/CSRF token.
  const sameOrigin = onArtifactHost(req) ? ' allow-same-origin' : '';
  res.set(
    'Content-Security-Policy',
    `sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads${sameOrigin}`
  );
  // Let a CDN (e.g. Cloudflare) revalidate so a refreshed snapshot is never
  // served stale. Private artifacts must never be cached by shared caches.
  if (artifact.is_public) {
    res.set('Cache-Control', 'no-cache');
  } else {
    res.set('Cache-Control', 'private, no-store');
  }
  res.send(html);
}

router.get('/a/:slug', (req, res) => {
  const artifact = artifacts.getArtifactBySlug(req.params.slug);
  if (!artifact) {
    return res.status(404).render('error', { title: 'Not found', message: 'No such artifact.' });
  }
  serveSnapshot(req, res, artifact, artifacts.getCurrentSnapshot(artifact));
});

router.get('/a/:slug/v/:snapshotId', (req, res) => {
  const artifact = artifacts.getArtifactBySlug(req.params.slug);
  if (!artifact) {
    return res.status(404).render('error', { title: 'Not found', message: 'No such artifact.' });
  }
  const snapshot = artifacts.getSnapshot(req.params.snapshotId);
  if (!snapshot || snapshot.artifact_id !== artifact.id) {
    return res.status(404).render('error', { title: 'Not found', message: 'No such snapshot.' });
  }
  serveSnapshot(req, res, artifact, snapshot);
});

module.exports = router;
