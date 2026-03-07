const {
  Question,
  QuestionAnswer,
  QuestionMcqResponse,
} = require('../../models');

async function getQuestionOr404(questionId, res) {
  const question = await Question.findByPk(questionId);
  if (!question) {
    res.status(404).json({ error: 'Question not found.' });
    return null;
  }
  return question;
}

async function hasUserAnswered(question, userId) {
  if (!question || !userId) return false;

  if (question.type === 'open') {
    const answer = await QuestionAnswer.findOne({
      where: { question_id: question.id, author_id: userId },
      attributes: ['id'],
    });
    return Boolean(answer);
  }

  const response = await QuestionMcqResponse.findOne({
    where: { question_id: question.id, user_id: userId },
    attributes: ['id'],
  });
  return Boolean(response);
}

async function buildViewerState(question, userId) {
  const isAuthor = Boolean(userId && question.author_id === userId);
  const hasAnswered = isAuthor ? false : await hasUserAnswered(question, userId);
  const canViewLockedContent = isAuthor || hasAnswered;
  const canAnswer = Boolean(userId) && !isAuthor && question.status === 'open';

  return {
    is_author: isAuthor,
    has_answered: hasAnswered,
    can_answer: canAnswer,
    can_view_locked_content: canViewLockedContent,
    can_discuss: question.status === 'open' && canViewLockedContent,
    can_accept_answer: isAuthor && question.type === 'open',
  };
}

function ensureQuestionAuthor(question, userId, res) {
  if (!userId || question.author_id !== userId) {
    res.status(403).json({ error: 'Only the question author can perform this action.' });
    return false;
  }
  return true;
}

function ensureQuestionOpen(question, res) {
  if (question.status !== 'open') {
    res.status(400).json({ error: 'This question is closed.' });
    return false;
  }
  return true;
}

async function ensureQuestionUnlocked(question, userId, res) {
  if (!userId) {
    res.status(401).json({ error: 'Sign in to view this content.' });
    return null;
  }

  const viewerState = await buildViewerState(question, userId);
  if (!viewerState.can_view_locked_content) {
    res.status(403).json({
      error: 'Answer required to view this content.',
      code: 'ANSWER_REQUIRED',
    });
    return null;
  }

  return viewerState;
}

module.exports = {
  getQuestionOr404,
  hasUserAnswered,
  buildViewerState,
  ensureQuestionAuthor,
  ensureQuestionOpen,
  ensureQuestionUnlocked,
};
