const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const {
  createSpaceRateLimiter,
  joinRequestRateLimiter,
  discussionRateLimiter,
  updateRateLimiter,
  issueWriteRateLimiter,
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
const {
  listIssues,
  getIssue,
  createIssue,
  updateIssue,
  listWork,
  getWork,
  createWork,
  updateWork,
  bulkUpdateWork,
  getWorkActivity,
  getWorkSummary,
} = require('../../controllers/spaces/issueController');
const {
  listWorkComments,
  createWorkComment,
} = require('../../controllers/spaces/workCommentController');
const {
  listMilestones,
  createMilestone,
  updateMilestone,
} = require('../../controllers/spaces/milestoneController');
const {
  listAttachments,
  createAttachment,
  updateAttachment,
  deleteAttachment,
} = require('../../controllers/spaces/attachmentController');
const {
  listFollowers,
  followSpace,
  unfollowSpace,
} = require('../../controllers/spaces/followerController');
const {
  listRepos,
  createRepo,
  getRepo,
  updateRepo,
  archiveRepo,
} = require('../../controllers/spaces/repoController');
const {
  listRepoMembers,
  upsertRepoMember,
  removeRepoMember,
} = require('../../controllers/spaces/repoMemberController');
const {
  getTree,
  getBlob,
  getReadme,
  getCommits,
} = require('../../controllers/spaces/repoReadController');
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
router.get('/:spaceId/work/summary', getWorkSummary);
router.get('/:spaceId/issues/summary', getWorkSummary);
router.get('/:spaceId/work/:issueId/activity', getWorkActivity);
router.get('/:spaceId/issues/:issueId/activity', getWorkActivity);
router.get('/:spaceId/work/:issueId/comments', listWorkComments);
router.get('/:spaceId/issues/:issueId/comments', listWorkComments);
router.get('/:spaceId/work', listWork);
router.get('/:spaceId/work/:issueId', getWork);
router.get('/:spaceId/issues', listIssues);
router.get('/:spaceId/issues/:issueId', getIssue);
router.get('/:spaceId/milestones', listMilestones);
router.get('/:spaceId/attachments', listAttachments);
router.get('/:spaceId/followers', listFollowers);
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

router.patch('/:spaceId/work/bulk', issueWriteRateLimiter, bulkUpdateWork);
router.patch('/:spaceId/issues/bulk', issueWriteRateLimiter, bulkUpdateWork);
router.post('/:spaceId/work/:issueId/comments', issueWriteRateLimiter, createWorkComment);
router.post('/:spaceId/work/:issueId/comments/:commentId/replies', issueWriteRateLimiter, createWorkComment);
router.post('/:spaceId/issues/:issueId/comments', issueWriteRateLimiter, createWorkComment);
router.post('/:spaceId/issues/:issueId/comments/:commentId/replies', issueWriteRateLimiter, createWorkComment);
router.post('/:spaceId/work', issueWriteRateLimiter, createWork);
router.patch('/:spaceId/work/:issueId', issueWriteRateLimiter, updateWork);
router.post('/:spaceId/issues', issueWriteRateLimiter, createIssue);
router.patch('/:spaceId/issues/:issueId', issueWriteRateLimiter, updateIssue);
router.post('/:spaceId/milestones', issueWriteRateLimiter, createMilestone);
router.patch('/:spaceId/milestones/:milestoneId', issueWriteRateLimiter, updateMilestone);

router.post('/:spaceId/followers', followSpace);
router.delete('/:spaceId/followers', unfollowSpace);

router.post('/:spaceId/attachments', createAttachment);
router.patch('/:spaceId/attachments/:attachmentId', updateAttachment);
router.delete('/:spaceId/attachments/:attachmentId', deleteAttachment);

router.get('/:spaceId/repos', listRepos);
router.post('/:spaceId/repos', createRepo);
router.get('/:spaceId/repos/:repoId', getRepo);
router.patch('/:spaceId/repos/:repoId', updateRepo);
router.delete('/:spaceId/repos/:repoId', archiveRepo);

router.get('/:spaceId/repos/:repoId/members', listRepoMembers);
router.put('/:spaceId/repos/:repoId/members/:userId', upsertRepoMember);
router.delete('/:spaceId/repos/:repoId/members/:userId', removeRepoMember);

router.get('/:spaceId/repos/:repoId/tree', getTree);
router.get('/:spaceId/repos/:repoId/blob', getBlob);
router.get('/:spaceId/repos/:repoId/readme', getReadme);
router.get('/:spaceId/repos/:repoId/commits', getCommits);

module.exports = router;
