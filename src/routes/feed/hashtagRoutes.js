const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const {
  suggestHashtags,
  getTrendingHashtags,
} = require('../../controllers/feed/hashtagController');

const router = express.Router();

router.use(authMiddleware);
router.get('/suggest', suggestHashtags);
router.get('/trending', getTrendingHashtags);

module.exports = router;
