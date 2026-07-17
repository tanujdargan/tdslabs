'use strict';

// Standalone assert-based smoke test for role-based auth. Run on a machine where
// deps are installed:  node test-auth.js
// It points the app at a throwaway data dir so it never touches a real database.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// MUST be set before requiring ./src/db or ./src/auth so config picks it up.
process.env.ARTIFACT_KEEPER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-test-'));

const auth = require('./src/auth');

async function main() {
  // Create an admin and a normal user.
  const A = auth.createUser('admin_a', 'password1', 'admin');
  const U = auth.createUser('user_u', 'password1', 'user');

  assert.strictEqual(auth.isAdmin(A), true, 'A should be an admin');
  assert.strictEqual(auth.isAdmin(U), false, 'U should not be an admin');

  // Password shorter than 8 chars is rejected.
  assert.throws(() => auth.createUser('shorty', 'short'), /at least 8 characters/);

  // Invalid role is rejected.
  assert.throws(() => auth.createUser('weird', 'password1', 'superuser'), /Invalid role/);

  // Reset the normal user's password, then verify the new credentials work.
  auth.setPassword(U.id, 'newpassword1');
  const verified = await auth.verifyCredentials(U.username, 'newpassword1');
  assert.ok(verified, 'verifyCredentials should resolve to the user');
  assert.strictEqual(verified.id, U.id, 'verified user id should match U');

  // Cannot delete the only admin.
  assert.throws(() => auth.deleteUser(A.id), /Cannot delete the last admin/);

  // With a second admin present, deleting the first admin succeeds.
  auth.createUser('admin_b', 'password1', 'admin');
  auth.deleteUser(A.id);
  assert.strictEqual(auth.getUserById(A.id), undefined, 'A should be deleted');

  // listUsers must never leak password_hash.
  const rows = auth.listUsers();
  assert.ok(rows.length > 0, 'listUsers should return rows');
  for (const row of rows) {
    assert.ok(
      !Object.keys(row).includes('password_hash'),
      'listUsers must not expose password_hash'
    );
  }

  console.log('ALL AUTH TESTS PASSED');
}

main().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
