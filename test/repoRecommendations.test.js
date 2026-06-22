const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_URL = process.env.DB_URL || 'postgres://localhost/logoutdev_test';

const {
  VALID_SCOPES,
  isRecommendationCandidate,
  scoreRepositoryRecommendation,
} = require('../src/services/repos/repoListingService');

function buildRepo(overrides = {}) {
  return {
    id: 'repo-1',
    owner_id: 'owner-2',
    name: 'starter-api',
    slug: 'starter-api',
    visibility: 'public',
    description: 'A small API starter for teams shipping together.',
    default_branch: 'main',
    language: 'TypeScript',
    archived_at: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
    updated_at: new Date().toISOString(),
    space_id: 'space-1',
    owner: {
      id: 'owner-2',
      name: 'Builder Two',
      username: 'builder-two',
    },
    space: {
      id: 'space-1',
      name: 'Starter API',
      slug: 'starter-api',
      visibility: 'public',
      status: 'building',
      working_in_public: true,
      current_focus: 'Preparing contributor-ready issues',
      open_roles: ['backend maintainer'],
      needed_skills: ['TypeScript', 'Postgres'],
      contribution_guide: 'Pick an issue and open a small pull request.',
      stack: [
        { technology: 'TypeScript' },
        { technology: 'Postgres' },
      ],
    },
    ...overrides,
  };
}

test('recommendation candidates exclude own, private, and archived repos', () => {
  assert.equal(isRecommendationCandidate(buildRepo(), 'viewer-1'), true);
  assert.equal(isRecommendationCandidate(buildRepo({ owner_id: 'viewer-1' }), 'viewer-1'), false);
  assert.equal(isRecommendationCandidate(buildRepo({ visibility: 'private' }), 'viewer-1'), false);
  assert.equal(isRecommendationCandidate(buildRepo({ archived_at: new Date().toISOString() }), 'viewer-1'), false);
});

test('repo listing scopes include shared and starred collections', () => {
  assert.ok(VALID_SCOPES.includes('shared'));
  assert.ok(VALID_SCOPES.includes('starred'));
});

test('collaboration fit outranks popularity-only repos', () => {
  const collaborationRepo = buildRepo();
  const popularRepo = buildRepo({
    id: 'repo-2',
    name: 'popular-lib',
    slug: 'popular-lib',
    language: 'Python',
    space_id: null,
    space: null,
    updated_at: new Date().toISOString(),
  });

  const collaborationScore = scoreRepositoryRecommendation({
    repo: collaborationRepo,
    metrics: {
      star_count: 3,
      fork_count: 1,
      watcher_count: 2,
      collaborator_count: 2,
      open_issue_count: 3,
      good_first_task_count: 1,
      help_wanted_count: 1,
      open_pull_request_count: 1,
      discussion_count: 2,
    },
    viewerSignals: { skills: ['TypeScript'] },
  });
  const popularityScore = scoreRepositoryRecommendation({
    repo: popularRepo,
    metrics: {
      star_count: 500,
      fork_count: 90,
      watcher_count: 120,
      collaborator_count: 1,
      open_issue_count: 0,
      good_first_task_count: 0,
      help_wanted_count: 0,
      open_pull_request_count: 0,
      discussion_count: 0,
    },
    viewerSignals: { skills: ['TypeScript'] },
  });

  assert.ok(collaborationScore.score > popularityScore.score);
  assert.ok(collaborationScore.signal_breakdown.collaboration_fit > popularityScore.signal_breakdown.collaboration_fit);
});

test('viewer skill matches increase recommendation score', () => {
  const repo = buildRepo();
  const base = scoreRepositoryRecommendation({
    repo,
    metrics: {},
    viewerSignals: { skills: [] },
  });
  const matched = scoreRepositoryRecommendation({
    repo,
    metrics: {},
    viewerSignals: { skills: ['TypeScript'] },
  });

  assert.ok(matched.score > base.score);
  assert.deepEqual(matched.matched_stacks, ['TypeScript']);
});

test('recommendation reasons and breakdown are deterministic', () => {
  const result = scoreRepositoryRecommendation({
    repo: buildRepo(),
    metrics: {
      star_count: 2,
      open_issue_count: 2,
      good_first_task_count: 1,
      help_wanted_count: 1,
    },
    viewerSignals: { skills: ['TypeScript'] },
  });

  assert.deepEqual(result.reasons, ['Matches TypeScript', 'Good first tasks', 'Help wanted']);
  assert.equal(result.source, 'logoutdev');
  assert.deepEqual(Object.keys(result.signal_breakdown), [
    'collaboration_fit',
    'stack_fit',
    'freshness_activity',
    'social_proof',
    'completeness_trust',
  ]);
});
