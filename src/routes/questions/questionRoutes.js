const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const {
  createQuestionRateLimiter,
  answerRateLimiter,
  discussionRateLimiter,
} = require('../../middleware/questionsRateLimiter');
const {
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  closeQuestion,
  reopenQuestion,
} = require('../../controllers/questions/questionController');
const {
  putMyAnswer,
  listAnswers,
  upvoteAnswer,
  removeAnswerUpvote,
  acceptAnswer,
} = require('../../controllers/questions/questionAnswerController');
const { submitMcqResponse } = require('../../controllers/questions/questionMcqController');
const {
  listDiscussion,
  createDiscussionComment,
} = require('../../controllers/questions/questionDiscussionController');

const router = express.Router();

router.use(optionalAuthMiddleware);

router.get('/', listQuestions);
router.get('/:questionId', getQuestion);
router.get('/:questionId/answers', listAnswers);
router.get('/:questionId/discussion', listDiscussion);

router.use(authMiddleware);

router.post('/', createQuestionRateLimiter, createQuestion);
router.patch('/:questionId', createQuestionRateLimiter, updateQuestion);
router.post('/:questionId/close', closeQuestion);
router.post('/:questionId/reopen', reopenQuestion);
router.post('/:questionId/mcq-response', answerRateLimiter, submitMcqResponse);
router.put('/:questionId/my-answer', answerRateLimiter, putMyAnswer);
router.post('/:questionId/answers/:answerId/upvote', answerRateLimiter, upvoteAnswer);
router.delete('/:questionId/answers/:answerId/upvote', removeAnswerUpvote);
router.post('/:questionId/answers/:answerId/accept', acceptAnswer);
router.post('/:questionId/discussion', discussionRateLimiter, createDiscussionComment);
router.post('/:questionId/discussion/:commentId/replies', discussionRateLimiter, createDiscussionComment);

module.exports = router;
