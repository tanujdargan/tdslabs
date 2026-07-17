'use strict';

const express = require('express');
const artifacts = require('../artifacts');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve the current (or a specific) snapshot of an artifact as raw HTML.
function serveSnapshot(req, res, artifact, snapshot) {
  // Private artifacts require an authenticated session.
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
