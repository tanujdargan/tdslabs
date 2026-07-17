'use strict';

const cron = require('node-cron');
const db = require('./db');
const config = require('./config');
const artifacts = require('./artifacts');

let running = false;

// Artifacts are "due" when they have never been checked or when their interval
// has elapsed since the last check.
function findDueArtifacts() {
  return db
    .prepare(
      `SELECT * FROM artifacts
        WHERE enabled = 1
          AND (
            last_checked_at IS NULL
            OR datetime(last_checked_at, '+' || check_interval_minutes || ' minutes') <= datetime('now')
          )
        ORDER BY last_checked_at IS NOT NULL, last_checked_at ASC`
    )
    .all();
}

async function runDueChecks() {
  if (running) return; // Avoid overlapping sweeps.
  running = true;
  try {
    const due = findDueArtifacts();
    for (const artifact of due) {
      try {
        const res = await artifacts.refreshArtifact(artifact.id);
        const tag = res.changed ? 'updated' : 'unchanged';
        // eslint-disable-next-line no-console
        console.log(`[scheduler] ${artifact.slug}: ${tag}${res.warning ? ' (' + res.warning + ')' : ''}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[scheduler] ${artifact.slug}: error - ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

function start() {
  if (!cron.validate(config.schedulerCron)) {
    // eslint-disable-next-line no-console
    console.warn(`[scheduler] Invalid cron expression "${config.schedulerCron}"; scheduler disabled.`);
    return;
  }
  cron.schedule(config.schedulerCron, () => {
    runDueChecks().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[scheduler] sweep failed:', err);
    });
  });
  // eslint-disable-next-line no-console
  console.log(`[scheduler] running on cron "${config.schedulerCron}"`);
  // Kick an initial sweep shortly after boot so new installs populate quickly.
  setTimeout(() => {
    runDueChecks().catch(() => {});
  }, 5000);
}

module.exports = { start, runDueChecks, findDueArtifacts };
