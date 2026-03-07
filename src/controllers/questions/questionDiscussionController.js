const {
  User,
  QuestionDiscussionComment,
} = require('../../models');
const {
  ensureQuestionOpen,
  ensureQuestionUnlocked,
} = require('../../services/questions/questionAccess');
const { validateDiscussionBody } = require('../../services/questions/questionValidation');
const {
  getQuestionById,
  refreshQuestionStats,
} = require('../../services/questions/questionQueries');

async function listDiscussion(req, res) {
  try {
    const question = await getQuestionById(req.params.questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const viewerState = await ensureQuestionUnlocked(question, req.user?.userId || null, res);
    if (!viewerState) return;

    const comments = await QuestionDiscussionComment.findAll({
      where: { question_id: question.id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
      order: [['created_at', 'ASC']],
    });

    return res.json({ comments, viewer_state: viewerState });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch discussion.' });
  }
}

async function createDiscussionComment(req, res) {
  try {
    const question = await getQuestionById(req.params.questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    if (!ensureQuestionOpen(question, res)) return;

    const viewerState = await ensureQuestionUnlocked(question, req.user.userId, res);
    if (!viewerState) return;

    const parentId = req.params.commentId || null;
    if (parentId) {
      const parent = await QuestionDiscussionComment.findOne({
        where: { id: parentId, question_id: question.id },
      });
      if (!parent) {
        return res.status(400).json({ error: 'Invalid parent comment.' });
      }
    }

    const body = validateDiscussionBody(req.body.body);
    const comment = await QuestionDiscussionComment.create({
      question_id: question.id,
      author_id: req.user.userId,
      parent_comment_id: parentId,
      body,
    });

    await refreshQuestionStats(question.id);

    const hydrated = await QuestionDiscussionComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
    });

    return res.status(201).json({ comment: hydrated });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to create discussion comment.' });
  }
}

module.exports = {
  listDiscussion,
  createDiscussionComment,
};
