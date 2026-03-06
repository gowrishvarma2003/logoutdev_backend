const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const {
  createSpaceRateLimiter,
  joinRequestRateLimiter,
  discussionRateLimiter,
  updateRateLimiter,
} = require('../../middleware/spacesRateLimiter');

const {
  createSpace,
  listSpaces,
  getSpace,
  updateSpace,
  deleteSpace,
} = require('../../controllers/spaces/spaceController');
const { replaceStack, getStack } = require('../../controllers/spaces/stackController');
const {
  getContributors,
  updateContributorRole,
  removeContributor,
} = require('../../controllers/spaces/contributorController');
const {
  createJoinRequest,
  listJoinRequests,
  reviewJoinRequest,
} = require('../../controllers/spaces/joinRequestController');
const {
  createDiscussion,
  listDiscussions,
  getDiscussion,
  addDiscussionReply,
  updateDiscussion,
} = require('../../controllers/spaces/discussionController');
const {
  createUpdate,
  listUpdates,
  updateUpdate,
  deleteUpdate,
} = require('../../controllers/spaces/updateController');
const { getHealth, getDecisions } = require('../../controllers/spaces/signalController');

const router = express.Router();

router.use(optionalAuthMiddleware);

// Public read endpoints for discovery
router.get('/', listSpaces);
router.get('/:spaceId', getSpace);
router.get('/:spaceId/stack', getStack);
router.get('/:spaceId/contributors', getContributors);
router.get('/:spaceId/discussions', listDiscussions);
router.get('/:spaceId/discussions/:threadId', getDiscussion);
router.get('/:spaceId/updates', listUpdates);
router.get('/:spaceId/health', getHealth);
router.get('/:spaceId/decisions', getDecisions);

// Authenticated operations
router.use(authMiddleware);

router.post('/', createSpaceRateLimiter, createSpace);
router.patch('/:spaceId', updateSpace);
router.delete('/:spaceId', deleteSpace);

router.put('/:spaceId/stack', replaceStack);

router.patch('/:spaceId/contributors/:userId/role', updateContributorRole);
router.delete('/:spaceId/contributors/:userId', removeContributor);

router.post('/:spaceId/join-requests', joinRequestRateLimiter, createJoinRequest);
router.get('/:spaceId/join-requests', listJoinRequests);
router.patch('/:spaceId/join-requests/:requestId', reviewJoinRequest);

router.post('/:spaceId/discussions', discussionRateLimiter, createDiscussion);
router.post('/:spaceId/discussions/:threadId/replies', discussionRateLimiter, addDiscussionReply);
router.patch('/:spaceId/discussions/:threadId', updateDiscussion);

router.post('/:spaceId/updates', updateRateLimiter, createUpdate);
router.patch('/:spaceId/updates/:updateId', updateUpdate);
router.delete('/:spaceId/updates/:updateId', deleteUpdate);

module.exports = router;
