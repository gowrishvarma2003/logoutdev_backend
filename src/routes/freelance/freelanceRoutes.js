const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const {
  listProjects,
  createProject,
  getProject,
  updateProject,
  updateProjectStatus,
  listMyProjects,
} = require('../../controllers/freelance/projectController');
const {
  listProjectProposals,
  createProposal,
  updateProposal,
  withdrawProposal,
  reviewProposal,
  listMyProposals,
} = require('../../controllers/freelance/proposalController');

const router = express.Router();

router.use(optionalAuthMiddleware);
router.get('/projects', listProjects);
router.get('/projects/:projectId', getProject);

router.use(authMiddleware);
router.get('/me/projects', listMyProjects);
router.get('/me/proposals', listMyProposals);
router.post('/projects', createProject);
router.patch('/projects/:projectId', updateProject);
router.patch('/projects/:projectId/status', updateProjectStatus);
router.get('/projects/:projectId/proposals', listProjectProposals);
router.post('/projects/:projectId/proposals', createProposal);
router.patch('/projects/:projectId/proposals/:proposalId', updateProposal);
router.post('/projects/:projectId/proposals/:proposalId/withdraw', withdrawProposal);
router.patch('/projects/:projectId/proposals/:proposalId/status', reviewProposal);

module.exports = router;
