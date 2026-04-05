const express = require('express');
const internalServiceAuth = require('../../middleware/internalServiceAuth');
const {
  getInventory,
  readBlobsBatch,
  readBlobsPreviewBatch,
  getRecentCommits,
  getDiff,
  getBranchHead,
  searchRepoCode,
  ensureAiBranch,
  commitAiArtifacts,
  getExistingAgentArtifacts,
} = require('../../controllers/internal/repoAgentController');

const router = express.Router();

router.use(internalServiceAuth({
  allowedServiceIds: ['repo-doc-agent'],
}));

router.post('/repos/:repoId/inventory', getInventory);
router.post('/repos/:repoId/blobs/batch', readBlobsBatch);
router.post('/repos/:repoId/blobs/preview-batch', readBlobsPreviewBatch);
router.post('/repos/:repoId/search', searchRepoCode);
router.get('/repos/:repoId/commits', getRecentCommits);
router.get('/repos/:repoId/diff', getDiff);
router.get('/repos/:repoId/branch-head', getBranchHead);
router.get('/repos/:repoId/agent-artifacts', getExistingAgentArtifacts);
router.post('/repos/:repoId/agent-branch/ensure', ensureAiBranch);
router.post('/repos/:repoId/agent-branch/commit', commitAiArtifacts);

module.exports = router;
