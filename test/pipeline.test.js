const test = require('node:test');
const assert = require('node:assert/strict');

const { canAccessRun } = require('../server/src/services/pipeline');

test('translation runs are private to their creator when authentication is enabled', () => {
  const run = { username: 'alice' };

  assert.equal(canAccessRun(run, { authEnabled: true, username: 'alice' }), true);
  assert.equal(canAccessRun(run, { authEnabled: true, username: 'bob' }), false);
  assert.equal(canAccessRun(run, { authEnabled: true, username: 'admin', isAdmin: true }), true);
});

test('unauthenticated mode keeps translation runs available, but legacy ownerless runs need an admin', () => {
  assert.equal(canAccessRun({ username: 'alice' }, { authEnabled: false }), true);
  assert.equal(canAccessRun({ username: null }, { authEnabled: true, username: 'alice' }), false);
  assert.equal(canAccessRun({ username: null }, { authEnabled: true, username: 'admin', isAdmin: true }), true);
});
