const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBetaSummary,
  canCreateFeedback,
  canViewFeedbackItem,
} = require('../src/services/launches/launchPhase');
const { validateLaunchForPublish } = require('../src/services/launches/launchValidation');

test('buildBetaSummary computes remaining seats and full state', () => {
  assert.deepEqual(
    buildBetaSummary({ capacity: 10, approvedCount: 7, pendingCount: 4 }),
    {
      capacity: 10,
      approved_count: 7,
      pending_count: 4,
      remaining_seats: 3,
      is_full: false,
    }
  );
});

test('buildBetaSummary treats zero remaining seats as full', () => {
  assert.equal(buildBetaSummary({ capacity: 2, approvedCount: 2, pendingCount: 1 }).is_full, true);
});

test('validateLaunchForPublish requires beta access settings for beta launches', () => {
  const error = validateLaunchForPublish({
    name: 'Shipboard',
    tagline: 'A launch platform that keeps early access controlled.',
    description: 'Detailed description',
    product_type: 'web-app',
    development_stage: 'beta',
    launch_phase: 'beta',
    beta_capacity: null,
    beta_access_url: null,
    screenshots: [{ image_url: 'https://example.com/shot.png' }],
  });

  assert.equal(error, 'beta_capacity is required before publishing a beta launch.');
});

test('validateLaunchForPublish requires a live link for live launches', () => {
  const error = validateLaunchForPublish({
    name: 'Shipboard',
    tagline: 'A launch platform that keeps early access controlled.',
    description: 'Detailed description',
    product_type: 'web-app',
    development_stage: 'live',
    launch_phase: 'live',
    live_url: null,
    demo_url: null,
    website_url: null,
    screenshots: [{ image_url: 'https://example.com/shot.png' }],
  });

  assert.equal(error, 'live_url is required before publishing a live launch.');
});

test('canCreateFeedback only allows approved beta users during beta', () => {
  assert.equal(canCreateFeedback({ launchPhase: 'beta', isApprovedBetaUser: true }), true);
  assert.equal(canCreateFeedback({ launchPhase: 'beta', isApprovedBetaUser: false }), false);
  assert.equal(canCreateFeedback({ launchPhase: 'live', isApprovedBetaUser: false }), true);
});

test('canViewFeedbackItem keeps beta-only feedback private after go-live', () => {
  const item = {
    author_id: 'author-1',
    visibility_scope: 'beta',
    comments: [{ author_id: 'commenter-1' }],
  };

  assert.equal(
    canViewFeedbackItem({
      item,
      launchPhase: 'live',
      viewerId: 'random-user',
      isOwner: false,
      isApprovedBetaUser: true,
    }),
    false
  );

  assert.equal(
    canViewFeedbackItem({
      item,
      launchPhase: 'live',
      viewerId: 'author-1',
      isOwner: false,
      isApprovedBetaUser: false,
    }),
    true
  );
});
