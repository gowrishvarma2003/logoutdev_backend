const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const {
  createPost,
  getFeed,
  getExplore,
  getPost,
  deletePost,
  createReply,
  getReplies,
  getPostsByHashtag,
} = require('../../controllers/feed/postController');
const { likePost, unlikePost } = require('../../controllers/feed/likeController');
const { repostPost, undoRepost } = require('../../controllers/feed/repostController');
const { submitPollVote } = require('../../controllers/feed/pollController');

const router = express.Router();

// All post routes require authentication
router.use(authMiddleware);

// Feed routes
router.get('/feed', getFeed);
router.get('/explore', getExplore);
router.get('/by-hashtag', getPostsByHashtag);

// Post CRUD
router.post('/', createPost);
router.get('/:postId', getPost);
router.delete('/:postId', deletePost);

// Replies
router.post('/:postId/replies', createReply);
router.get('/:postId/replies', getReplies);

// Likes
router.post('/:postId/like', likePost);
router.delete('/:postId/like', unlikePost);

// Reposts
router.post('/:postId/repost', repostPost);
router.delete('/:postId/repost', undoRepost);

// Polls
router.post('/:postId/poll-vote', submitPollVote);

module.exports = router;
