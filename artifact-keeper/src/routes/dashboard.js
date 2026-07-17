'use strict';

const express = require('express');
const auth = require('../auth');
const artifacts = require('../artifacts');
const config = require('../config');
const cloner = require('../cloner');
const net = require('../net');

const router = express.Router();

// All dashboard routes require authentication.
router.use(auth.requireAuth);

router.get('/', (req, res) => {
  res.render('dashboard', {
    title: 'Artifacts',
    artifacts: artifacts.listArtifacts(),
    browserEnabled: cloner.browserAvailable(),
    defaultInterval: config.defaultCheckIntervalMinutes,
  });
});

router.post('/artifacts', auth.verifyCsrf, async (req, res) => {
  const { source_url, title, is_public, interval } = req.body;
  try {
    // Reject private/reserved destinations before persisting anything.
    await net.assertPublicUrl(source_url);
    const artifact = artifacts.createArtifact({
      sourceUrl: source_url,
      title,
      isPublic: is_public === 'on' || is_public === '1',
      intervalMinutes: interval,
    });
    // Do the first clone immediately (best-effort) so the user sees a result.
    try {
      await artifacts.refreshArtifact(artifact.id);
      req.session.flash = { type: 'success', message: 'Artifact added and cloned.' };
    } catch (err) {
      req.session.flash = {
        type: 'warning',
        message: `Artifact added, but the first clone failed: ${err.message}`,
      };
    }
    res.redirect(`/artifacts/${artifact.id}`);
  } catch (err) {
    req.session.flash = { type: 'danger', message: err.message };
    res.redirect('/');
  }
});

// Import an artifact from raw HTML the user saved themselves. The large request
// body is handled by a route-specific parser configured in server.js.
router.post('/import', auth.verifyCsrf, (req, res) => {
  try {
    const artifact = artifacts.importArtifact({
      html: req.body.html,
      title: req.body.title,
      isPublic: req.body.is_public === 'on' || req.body.is_public === '1',
    });
    req.session.flash = { type: 'success', message: 'Artifact imported.' };
    res.redirect(`/artifacts/${artifact.id}`);
  } catch (err) {
    req.session.flash = { type: 'danger', message: err.message };
    res.redirect('/');
  }
});

router.get('/artifacts/:id', (req, res) => {
  const artifact = artifacts.getArtifact(req.params.id);
  if (!artifact) {
    return res.status(404).render('error', { title: 'Not found', message: 'Artifact not found.' });
  }
  res.render('artifact', {
    title: artifact.title || artifact.slug,
    artifact,
    snapshots: artifacts.listSnapshots(artifact.id),
    current: artifacts.getCurrentSnapshot(artifact),
    defaultInterval: config.defaultCheckIntervalMinutes,
  });
});

router.post('/artifacts/:id/refresh', auth.verifyCsrf, async (req, res) => {
  const artifact = artifacts.getArtifact(req.params.id);
  if (!artifact) return res.redirect('/');
  if (artifacts.isImported(artifact)) {
    req.session.flash = {
      type: 'info',
      message: 'Imported artifacts have no live source to re-clone. Import again to replace it.',
    };
    return res.redirect(`/artifacts/${artifact.id}`);
  }
  try {
    const result = await artifacts.refreshArtifact(artifact.id);
    if (result.changed) {
      req.session.flash = { type: 'success', message: 'New snapshot captured — content changed.' };
    } else {
      req.session.flash = { type: 'info', message: 'Checked — content unchanged.' };
    }
    if (result.warning) {
      req.session.flash.message += ` (${result.warning})`;
    }
  } catch (err) {
    req.session.flash = { type: 'danger', message: `Refresh failed: ${err.message}` };
  }
  res.redirect(`/artifacts/${artifact.id}`);
});

router.post('/artifacts/:id/edit', auth.verifyCsrf, (req, res) => {
  const artifact = artifacts.getArtifact(req.params.id);
  if (!artifact) return res.redirect('/');
  artifacts.updateArtifact(artifact.id, {
    title: req.body.title,
    isPublic: req.body.is_public === 'on' || req.body.is_public === '1',
    intervalMinutes: req.body.interval,
    enabled: req.body.enabled === 'on' || req.body.enabled === '1',
  });
  req.session.flash = { type: 'success', message: 'Settings saved.' };
  res.redirect(`/artifacts/${artifact.id}`);
});

router.post('/artifacts/:id/delete', auth.verifyCsrf, (req, res) => {
  artifacts.deleteArtifact(req.params.id);
  req.session.flash = { type: 'success', message: 'Artifact deleted.' };
  res.redirect('/');
});

module.exports = router;
