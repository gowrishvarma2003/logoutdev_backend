const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const {
  listLaunches,
  listMyLaunches,
  getLaunch,
  createLaunch,
  updateLaunch,
  publishLaunch,
  archiveLaunch,
} = require('../../controllers/launches/launchController');
const { upvoteLaunch, removeLaunchUpvote } = require('../../controllers/launches/launchUpvoteController');
const {
  listLaunchReviews,
  upsertMyReview,
  deleteMyReview,
} = require('../../controllers/launches/launchReviewController');
const {
  listLaunchFeedback,
  createLaunchFeedback,
  updateLaunchFeedback,
  deleteLaunchFeedback,
  createLaunchFeedbackComment,
} = require('../../controllers/launches/launchFeedbackController');
const { createLaunchCollaborationRequest } = require('../../controllers/launches/launchCollaborationController');

const router = express.Router();

router.use(optionalAuthMiddleware);

router.get('/', listLaunches);
router.get('/me', authMiddleware, listMyLaunches);
router.get('/:launchId', getLaunch);
router.get('/:launchId/reviews', listLaunchReviews);
router.get('/:launchId/feedback', listLaunchFeedback);

router.post('/', authMiddleware, createLaunch);
router.patch('/:launchId', authMiddleware, updateLaunch);
router.post('/:launchId/publish', authMiddleware, publishLaunch);
router.post('/:launchId/archive', authMiddleware, archiveLaunch);
router.post('/:launchId/upvote', authMiddleware, upvoteLaunch);
router.delete('/:launchId/upvote', authMiddleware, removeLaunchUpvote);
router.put('/:launchId/my-review', authMiddleware, upsertMyReview);
router.delete('/:launchId/my-review', authMiddleware, deleteMyReview);
router.post('/:launchId/feedback', authMiddleware, createLaunchFeedback);
router.patch('/:launchId/feedback/:feedbackId', authMiddleware, updateLaunchFeedback);
router.delete('/:launchId/feedback/:feedbackId', authMiddleware, deleteLaunchFeedback);
router.post('/:launchId/feedback/:feedbackId/comments', authMiddleware, createLaunchFeedbackComment);
router.post('/:launchId/collaboration-request', authMiddleware, createLaunchCollaborationRequest);

module.exports = router;