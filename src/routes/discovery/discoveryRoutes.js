const express = require('express');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const { getDiscovery } = require('../../controllers/discovery/discoveryController');

const router = express.Router();

router.use(optionalAuthMiddleware);
router.get('/', getDiscovery);

module.exports = router;