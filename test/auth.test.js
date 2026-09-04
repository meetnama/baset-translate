const test = require('node:test');
const assert = require('node:assert/strict');

const { canUseCustomerId } = require('../server/src/auth');

test('a user with no customer assignments cannot use any customer', () => {
  assert.equal(canUseCustomerId([], 'diaab'), false);
  assert.equal(canUseCustomerId([], 'normal'), false);
});

test('an unrestricted user and an admin can use customers', () => {
  assert.equal(canUseCustomerId(null, 'diaab'), true);
  assert.equal(canUseCustomerId(['diaab'], 'diaab'), true);
  assert.equal(canUseCustomerId(['diaab'], 'normal'), false);
  assert.equal(canUseCustomerId([], 'normal', true), true);
});
