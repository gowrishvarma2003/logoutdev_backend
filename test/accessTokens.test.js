const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_URL = process.env.DB_URL || 'postgres://localhost/logoutdev_test';

const { normalizeScopes, tokenHasScope } = require('../src/services/auth/accessTokens');

test('normalizeScopes defaults to read/write for unspecified input', () => {
  assert.deepEqual(normalizeScopes(undefined), ['git:read', 'git:write']);
});

test('normalizeScopes keeps only supported unique scopes', () => {
  assert.deepEqual(
    normalizeScopes(['git:write', 'git:read', 'git:write', 'nope']),
    ['git:write', 'git:read']
  );
});

test('tokenHasScope checks granted Git scopes', () => {
  const token = { scopes: ['git:read'] };
  assert.equal(tokenHasScope(token, 'git:read'), true);
  assert.equal(tokenHasScope(token, 'git:write'), false);
});
