const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const { listMyProjects } = require('../../controllers/freelance/projectController');
const { listMyProposals } = require('../../controllers/freelance/proposalController');

const router = express.Router();

router.use(authMiddleware);
router.get('/projects', listMyProjects);
router.get('/proposals', listMyProposals);

module.exports = router;
