const express = require('express');
const { handleGitTransport } = require('../../controllers/git/gitTransportController');

const router = express.Router();

router.all(/^\/([^/]+)\/([^/]+)\.git(?:\/(.*))?$/, handleGitTransport);

module.exports = router;
