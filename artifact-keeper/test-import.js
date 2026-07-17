'use strict';

// Standalone assert-based smoke test for HTML import. Run where deps exist:
//   node test-import.js
// Uses a throwaway data dir so it never touches a real database.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.ARTIFACT_KEEPER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-imp-'));

const artifacts = require('./src/artifacts');

function main() {
  const html =
    '<!DOCTYPE html><html><head><title>T</title></head><body><h1>Hello Orbit</h1></body></html>';

  const a = artifacts.importArtifact({ html, title: 'My Import', isPublic: true });
  assert.strictEqual(a.source_url, 'imported', 'source_url should be the imported sentinel');
  assert.strictEqual(a.enabled, 0, 'imported artifact must be disabled from scheduling');
  assert.strictEqual(a.is_public, 1, 'should honour isPublic');
  assert.strictEqual(a.last_status, 'imported', 'status should read imported');
  assert.ok(artifacts.isImported(a), 'isImported should be true');

  const snap = artifacts.getCurrentSnapshot(a);
  assert.ok(snap, 'should have a current snapshot');
  assert.strictEqual(snap.method, 'import', 'snapshot method should be import');

  const stored = artifacts.readSnapshotHtml(a, snap);
  assert.strictEqual(stored, html, 'stored HTML must match input byte-for-byte');

  // Empty/whitespace HTML is rejected.
  assert.throws(() => artifacts.importArtifact({ html: '   ' }), /Paste or upload/);

  // Imported artifacts are skipped by the scheduler (enabled = 0).
  const scheduler = require('./src/scheduler');
  const due = scheduler.findDueArtifacts();
  assert.ok(!due.some((d) => d.id === a.id), 'imported artifact must never be scheduled');

  console.log('ALL IMPORT TESTS PASSED');
}

try {
  main();
} catch (e) {
  console.error('TEST FAILED:', e);
  process.exit(1);
}
