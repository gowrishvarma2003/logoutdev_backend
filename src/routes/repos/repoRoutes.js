const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const {
  listRepositories,
  createRepository,
  getRepository,
  updateRepository,
  archiveRepository,
} = require('../../controllers/repos/repositoryController');
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
const {
  getRepoAttachment,
  upsertRepoAttachment,
  removeRepoAttachment,
} = require('../../controllers/spaces/attachmentController');
const {
  listRepoBranches,
  createRepoBranch,
  deleteRepoBranch,
  listRepoTags,
  createRepoTag,
  deleteRepoTag,
  getRepoCommitDetail,
} = require('../../controllers/repos/branchTagController');
const {
  writeContents,
  deleteContents,
} = require('../../controllers/repos/fileEditController');
const {
  toggleStar,
  unstar,
  listStargazers,
  setWatch,
  unwatch,
  listWatchers,
} = require('../../controllers/repos/socialController');
const {
  forkRepo,
  listForks,
} = require('../../controllers/repos/forkController');
const {
  listReleases,
  createRelease,
  getRelease,
  updateRelease,
  deleteRelease,
} = require('../../controllers/repos/releaseController');

const router = express.Router();

// ─── Public routes (optional auth) ──────────────────────────────────
router.use(optionalAuthMiddleware);

router.get('/', listRepositories);
router.get('/:repoId', getRepository);
router.get('/:repoId/tree', getTree);
router.get('/:repoId/blob', getBlob);
router.get('/:repoId/readme', getReadme);
router.get('/:repoId/commits', getCommits);
router.get('/:repoId/commits/:oid', getRepoCommitDetail);
router.get('/:repoId/attachment', getRepoAttachment);
router.get('/:repoId/branches', listRepoBranches);
router.get('/:repoId/tags', listRepoTags);
router.get('/:repoId/stars', listStargazers);
router.get('/:repoId/watchers', listWatchers);
router.get('/:repoId/forks', listForks);
router.get('/:repoId/releases', listReleases);
router.get('/:repoId/releases/:releaseId', getRelease);

// ─── Authenticated routes ───────────────────────────────────────────
router.use(authMiddleware);

// Repo CRUD
router.post('/', createRepository);
router.patch('/:repoId', updateRepository);
router.delete('/:repoId', archiveRepository);

// Members
router.get('/:repoId/members', listRepoMembers);
router.put('/:repoId/members/:userId', upsertRepoMember);
router.delete('/:repoId/members/:userId', removeRepoMember);

// Attachments
router.put('/:repoId/attachment', upsertRepoAttachment);
router.delete('/:repoId/attachment', removeRepoAttachment);

// Branches
router.post('/:repoId/branches', createRepoBranch);
router.delete('/:repoId/branches/:name', deleteRepoBranch);

// Tags
router.post('/:repoId/tags', createRepoTag);
router.delete('/:repoId/tags/:name', deleteRepoTag);

// File editing (web commits)
router.put('/:repoId/contents', writeContents);
router.delete('/:repoId/contents', deleteContents);

// Social
router.put('/:repoId/star', toggleStar);
router.delete('/:repoId/star', unstar);
router.put('/:repoId/watch', setWatch);
router.delete('/:repoId/watch', unwatch);

// Forks
router.post('/:repoId/forks', forkRepo);

// Releases
router.post('/:repoId/releases', createRelease);
router.patch('/:repoId/releases/:releaseId', updateRelease);
router.delete('/:repoId/releases/:releaseId', deleteRelease);

// Pull Requests
const {
  listPullRequests,
  createPullRequest,
  getPullRequest,
  updatePullRequest,
  mergePullRequest,
  closePullRequest,
  reopenPullRequest,
  getPullRequestDiff,
  listPullRequestCommits,
} = require('../../controllers/repos/pullRequestController');

router.get('/:repoId/pulls', listPullRequests);
router.post('/:repoId/pulls', createPullRequest);
router.get('/:repoId/pulls/:number', getPullRequest);
router.patch('/:repoId/pulls/:number', updatePullRequest);
router.put('/:repoId/pulls/:number/merge', mergePullRequest);
router.put('/:repoId/pulls/:number/close', closePullRequest);
router.put('/:repoId/pulls/:number/reopen', reopenPullRequest);
router.get('/:repoId/pulls/:number/diff', getPullRequestDiff);
router.get('/:repoId/pulls/:number/commits', listPullRequestCommits);

// Pull Request Reviews
const {
  submitReview,
  listReviews,
} = require('../../controllers/repos/prReviewController');

router.post('/:repoId/pulls/:number/reviews', submitReview);
router.get('/:repoId/pulls/:number/reviews', listReviews);

// Pull Request Comments
const {
  addComment,
  listComments,
  updateComment,
  deleteComment,
  resolveThread,
} = require('../../controllers/repos/prCommentController');

router.post('/:repoId/pulls/:number/comments', addComment);
router.get('/:repoId/pulls/:number/comments', listComments);
router.patch('/:repoId/pulls/:number/comments/:commentId', updateComment);
router.delete('/:repoId/pulls/:number/comments/:commentId', deleteComment);
router.put('/:repoId/pulls/:number/comments/:commentId/resolve', resolveThread);

// Branch Protection Rules
const {
  listBranchProtectionRules,
  createBranchProtectionRule,
  deleteBranchProtectionRule,
} = require('../../controllers/repos/branchProtectionController');

router.get('/:repoId/branches/protection', listBranchProtectionRules);
router.post('/:repoId/branches/protection', createBranchProtectionRule);
router.delete('/:repoId/branches/protection/:ruleId', deleteBranchProtectionRule);

// Repository Discussions
const {
  listDiscussions,
  createDiscussion,
  getDiscussion,
  addDiscussionComment,
  markAnswer,
} = require('../../controllers/repos/repoDiscussionController');

router.get('/:repoId/discussions', listDiscussions);
router.post('/:repoId/discussions', createDiscussion);
router.get('/:repoId/discussions/:discussionId', getDiscussion);
router.post('/:repoId/discussions/:discussionId/comments', addDiscussionComment);
router.put('/:repoId/discussions/:discussionId/answer/:commentId', markAnswer);

module.exports = router;
