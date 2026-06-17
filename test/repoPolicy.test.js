const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_URL = process.env.DB_URL || 'postgres://localhost/logoutdev_test';

const { acceptedDirectRole, roleMeets, maxRole } = require('../src/services/spaces/repoAccess');
const {
  branchPatternMatches,
  buildReviewSummary,
  evaluateDirectBranchUpdate,
  evaluateRuleForPullRequest,
} = require('../src/services/repos/repoGovernance');

test('repo role ordering prefers the strongest role', () => {
  assert.equal(maxRole('read', 'maintain', 'triage'), 'maintain');
  assert.equal(roleMeets('maintain', 'write'), true);
  assert.equal(roleMeets('triage', 'write'), false);
});

test('pending repo memberships do not resolve to direct roles', () => {
  assert.equal(acceptedDirectRole({ role: 'write', status: 'pending' }), null);
  assert.equal(acceptedDirectRole({ role: 'write', status: 'accepted' }), 'write');
  assert.equal(acceptedDirectRole(null), null);
});

test('branch patterns support exact names and wildcard segments', () => {
  assert.equal(branchPatternMatches('main', 'main'), true);
  assert.equal(branchPatternMatches('release/1.2', 'release/*'), true);
  assert.equal(branchPatternMatches('feature/login', 'release/*'), false);
});

test('direct protected branch updates are blocked when PRs are required', () => {
  const result = evaluateDirectBranchUpdate({
    rule: {
      require_pr: true,
      restrict_pushes: false,
      allow_deletions: false,
    },
    access: {
      effective_role: 'admin',
      permissions: { can_push: true },
    },
    branchName: 'main',
  });

  assert.equal(result.allowed, false);
  assert.match(result.blocking_reasons[0], /Open a pull request/i);
});

test('protected branch merge evaluation requires approvals and status checks', () => {
  const result = evaluateRuleForPullRequest({
    rule: {
      require_pr: true,
      required_approvals: 2,
      dismiss_stale_reviews: true,
      require_status_checks: true,
      required_status_contexts: ['build', 'tests'],
    },
    reviews: [
      {
        reviewer_id: 'reviewer-1',
        status: 'approved',
        submitted_at: '2026-03-20T10:00:00.000Z',
      },
    ],
    commits: [
      { authored_at: '2026-03-21T10:00:00.000Z' },
    ],
    providedStatusContexts: ['build'],
    actorRole: 'maintain',
    isDraft: false,
  });

  assert.equal(result.merge_allowed, false);
  assert.equal(result.status_checks.pending.length, 1);
  assert.equal(result.review_summary.stale_reviews_count, 1);
  assert.ok(result.blocking_reasons.length >= 1);
});

test('pull request merge evaluation reports missing head branch explicitly', () => {
  const result = evaluateRuleForPullRequest({
    rule: null,
    reviews: [],
    commits: [],
    actorRole: 'write',
    isDraft: false,
    sourceBranchExists: false,
  });

  assert.equal(result.merge_allowed, false);
  assert.equal(result.mergeable_state, 'head_missing');
  assert.match(result.blocking_reasons[0], /source branch/i);
});

test('review summaries understand legacy Sequelize camelCase timestamps', () => {
  const summary = buildReviewSummary([
    {
      reviewer_id: 'reviewer-1',
      status: 'approved',
      createdAt: '2026-03-21T10:00:00.000Z',
    },
  ], [], false);

  assert.equal(summary.approvals_count, 1);
  assert.equal(summary.latest_by_reviewer.length, 1);
});
