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
const {
  buildEntityRef,
  emitUserNotifications,
} = require('../../services/notifications/notificationService');

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
    let parent = null;
    if (parentId) {
      parent = await QuestionDiscussionComment.findOne({
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

    const recipientIds = [...new Set([
      question.author_id,
      parent?.author_id,
    ].filter(Boolean))];

    await emitUserNotifications(
      recipientIds.map((recipientUserId) => ({
        recipientUserId,
        actorUserId: req.user.userId,
        eventType: 'question_discussion_comment_added',
        category: 'question',
        priority: 'important',
        entityType: 'question',
        entityId: question.id,
        entitySnapshot: buildEntityRef({
          type: 'question',
          id: question.id,
          title: question.title,
          href: `/questions/${question.id}`,
        }),
        secondaryEntityType: 'question_comment',
        secondaryEntityId: comment.id,
        secondarySnapshot: {
          type: 'question_comment',
          id: comment.id,
          title: 'New discussion reply',
          href: `/questions/${question.id}`,
          subtitle: body,
          visibility: null,
          tags: [],
        },
        actionUrl: `/questions/${question.id}`,
        previewText: 'commented on a question you follow',
        groupKey: `question_discussion_comment:${question.id}:${recipientUserId}`,
        dedupeKey: `question_discussion_comment_added:${comment.id}:${recipientUserId}`,
        createdAt: comment.created_at,
      }))
    );

    return res.status(201).json({ comment: hydrated });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to create discussion comment.' });
  }
}

module.exports = {
  listDiscussion,
  createDiscussionComment,
};
