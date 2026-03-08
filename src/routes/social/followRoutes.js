const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  suggestUsers,
} = require('../../controllers/social/followController');

const router = express.Router();

// All social routes require authentication
router.use(authMiddleware);

router.get('/suggest', suggestUsers);
router.post('/:userId/follow', followUser);
router.delete('/:userId/follow', unfollowUser);
router.get('/:userId/followers', getFollowers);
router.get('/:userId/following', getFollowing);

module.exports = router;
