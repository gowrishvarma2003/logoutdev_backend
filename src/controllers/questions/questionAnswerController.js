const {
  sequelize,
  User,
  Question,
  QuestionAnswer,
  QuestionAnswerVote,
} = require('../../models');
const {
  ensureQuestionAuthor,
  ensureQuestionOpen,
  ensureQuestionUnlocked,
  getQuestionOr404,
} = require('../../services/questions/questionAccess');
const { validateAnswerBody } = require('../../services/questions/questionValidation');
const {
  getQuestionById,
  refreshQuestionStats,
} = require('../../services/questions/questionQueries');

async function putMyAnswer(req, res) {
  try {
    const userId = req.user.userId;
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    if (question.type !== 'open') {
      return res.status(400).json({ error: 'Only open questions accept written answers.' });
    }

    if (!ensureQuestionOpen(question, res)) return;

    if (question.author_id === userId) {
      return res.status(403).json({ error: 'You cannot answer your own question.' });
    }

    const body = validateAnswerBody(req.body.body);

    const [answer, created] = await QuestionAnswer.findOrCreate({
      where: { question_id: question.id, author_id: userId },
      defaults: {
        body,
        score: 0,
        is_accepted: false,
      },
    });

    if (!created) {
      await answer.update({ body, updated_at: new Date() });
    }

    await refreshQuestionStats(question.id);

    const hydrated = await QuestionAnswer.findByPk(answer.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
    });

    return res.json({ answer: hydrated });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to save answer.' });
  }
}

async function listAnswers(req, res) {
  try {
    const userId = req.user?.userId || null;
    const question = await getQuestionById(req.params.questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    if (question.type !== 'open') {
      return res.status(400).json({ error: 'MCQ questions do not expose written answers.' });
    }

    const viewerState = await ensureQuestionUnlocked(question, userId, res);
    if (!viewerState) return;

    const answers = await QuestionAnswer.findAll({
      where: { question_id: question.id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
      order: [['is_accepted', 'DESC'], ['score', 'DESC'], ['created_at', 'ASC']],
    });

    let upvotedSet = new Set();
    if (userId && answers.length > 0) {
      const votes = await QuestionAnswerVote.findAll({
        where: {
          answer_id: answers.map((answer) => answer.id),
          user_id: userId,
        },
        attributes: ['answer_id'],
      });
      upvotedSet = new Set(votes.map((vote) => vote.answer_id));
    }

    return res.json({
      answers: answers.map((answer) => ({
        ...answer.toJSON(),
        is_upvoted_by_me: upvotedSet.has(answer.id),
      })),
      viewer_state: viewerState,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch answers.' });
  }
}

async function upvoteAnswer(req, res) {
  try {
    const userId = req.user.userId;
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    const viewerState = await ensureQuestionUnlocked(question, userId, res);
    if (!viewerState) return;

    if (!ensureQuestionOpen(question, res)) return;

    const answer = await QuestionAnswer.findOne({
      where: { id: req.params.answerId, question_id: question.id },
    });

    if (!answer) {
      return res.status(404).json({ error: 'Answer not found.' });
    }

    if (answer.author_id === userId) {
      return res.status(400).json({ error: 'You cannot upvote your own answer.' });
    }

    const [, created] = await QuestionAnswerVote.findOrCreate({
      where: { answer_id: answer.id, user_id: userId },
      defaults: { answer_id: answer.id, user_id: userId },
    });

    if (created) {
      await answer.increment('score');
    }

    const hydrated = await QuestionAnswer.findByPk(answer.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
    });

    return res.json({
      answer: {
        ...hydrated.toJSON(),
        is_upvoted_by_me: true,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to upvote answer.' });
  }
}

async function removeAnswerUpvote(req, res) {
  try {
    const userId = req.user.userId;
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    const viewerState = await ensureQuestionUnlocked(question, userId, res);
    if (!viewerState) return;

    const answer = await QuestionAnswer.findOne({
      where: { id: req.params.answerId, question_id: question.id },
    });

    if (!answer) {
      return res.status(404).json({ error: 'Answer not found.' });
    }

    const deleted = await QuestionAnswerVote.destroy({
      where: { answer_id: answer.id, user_id: userId },
    });

    if (deleted > 0) {
      await answer.decrement('score');
    }

    const hydrated = await QuestionAnswer.findByPk(answer.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
    });

    return res.json({
      answer: {
        ...hydrated.toJSON(),
        is_upvoted_by_me: false,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to remove answer upvote.' });
  }
}

async function acceptAnswer(req, res) {
  try {
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    if (question.type !== 'open') {
      return res.status(400).json({ error: 'Only open questions can accept answers.' });
    }

    if (!ensureQuestionAuthor(question, req.user.userId, res)) return;

    const answer = await QuestionAnswer.findOne({
      where: { id: req.params.answerId, question_id: question.id },
    });

    if (!answer) {
      return res.status(404).json({ error: 'Answer not found.' });
    }

    await sequelize.transaction(async (transaction) => {
      await QuestionAnswer.update(
        { is_accepted: false },
        { where: { question_id: question.id }, transaction }
      );

      await answer.update({ is_accepted: true, updated_at: new Date() }, { transaction });
      await Question.update(
        {
          accepted_answer_id: answer.id,
          updated_at: new Date(),
          latest_activity_at: new Date(),
        },
        {
          where: { id: question.id },
          transaction,
        }
      );
    });

    await refreshQuestionStats(question.id);

    const hydrated = await QuestionAnswer.findByPk(answer.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
    });

    return res.json({ answer: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to accept answer.' });
  }
}

module.exports = {
  putMyAnswer,
  listAnswers,
  upvoteAnswer,
  removeAnswerUpvote,
  acceptAnswer,
};
