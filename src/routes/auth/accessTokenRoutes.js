const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const {
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
} = require('../../controllers/auth/accessTokenController');

const router = express.Router();

router.use(authMiddleware);

router.get('/', listAccessTokens);
router.post('/', createAccessToken);
router.delete('/:tokenId', revokeAccessToken);

module.exports = router;
