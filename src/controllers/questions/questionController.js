const {
  sequelize,
  Question,
  QuestionOption,
  QuestionMcqResponse,
  QuestionTag,
} = require('../../models');
const {
  buildViewerState,
  ensureQuestionAuthor,
  getQuestionOr404,
} = require('../../services/questions/questionAccess');
const {
  parseQuestionFilters,
  validateQuestionPayload,
} = require('../../services/questions/questionValidation');
const {
  getQuestionById,
  listQuestionsWithFilters,
  refreshQuestionStats,
  serializeQuestion,
} = require('../../services/questions/questionQueries');
const { getQuestionGraph } = require('../../services/workGraph/workGraphService');

const UUID_V4_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function listQuestions(req, res) {
  try {
    const filters = parseQuestionFilters(req.query);
    const userId = req.user?.userId || null;
    const payload = await listQuestionsWithFilters(filters, userId);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch questions.' });
  }
}

async function getQuestion(req, res) {
  try {
    if (!UUID_V4_LIKE_REGEX.test(String(req.params.questionId || ''))) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const userId = req.user?.userId || null;
    const question = await getQuestionById(req.params.questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const viewerState = await buildViewerState(question, userId);
    const serialized = await serializeQuestion(question, viewerState, userId);
    const graph = await getQuestionGraph(question, userId);
    return res.json({ question: { ...serialized, ...graph } });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch question.' });
  }
}

async function createQuestion(req, res) {
  try {
    const userId = req.user.userId;
    const payload = validateQuestionPayload(req.body);

    const question = await sequelize.transaction(async (transaction) => {
      const created = await Question.create(
        {
          author_id: userId,
          type: payload.type,
          mcq_mode: payload.mcq_mode,
          title: payload.title,
          body: payload.body,
          status: 'open',
          latest_activity_at: new Date(),
        },
        { transaction }
      );

      if (payload.tags?.length) {
        await QuestionTag.bulkCreate(
          payload.tags.map((tag) => ({ question_id: created.id, ...tag })),
          { transaction }
        );
      }

      if (payload.type === 'mcq' && payload.options?.length) {
        await QuestionOption.bulkCreate(
          payload.options.map((text, index) => ({
            question_id: created.id,
            position: index + 1,
            text,
            is_correct: index === payload.correct_option_index,
          })),
          { transaction }
        );
      }

      return created;
    });

    await refreshQuestionStats(question.id);
    const hydrated = await getQuestionById(question.id);
    const viewerState = await buildViewerState(hydrated, userId);
    const serialized = await serializeQuestion(hydrated, viewerState, userId);
    return res.status(201).json({ question: serialized });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to create question.' });
  }
}

async function updateQuestion(req, res) {
  try {
    const userId = req.user.userId;
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    if (!ensureQuestionAuthor(question, userId, res)) return;

    if (question.status !== 'open') {
      return res.status(400).json({ error: 'Closed questions cannot be edited.' });
    }

    const hasMcqResponses = question.type === 'mcq'
      ? (await QuestionMcqResponse.count({ where: { question_id: question.id } })) > 0
      : false;

    const payload = validateQuestionPayload(req.body, {
      isUpdate: true,
      existingQuestion: question.toJSON(),
      hasMcqResponses,
    });

    await sequelize.transaction(async (transaction) => {
      const updates = {};
      if (payload.title !== undefined) updates.title = payload.title;
      if (payload.body !== undefined) updates.body = payload.body;
      if (payload.mcq_mode !== undefined) updates.mcq_mode = payload.mcq_mode;
      updates.updated_at = new Date();

      await question.update(updates, { transaction });

      if (payload.tags) {
        await QuestionTag.destroy({ where: { question_id: question.id }, transaction });
        await QuestionTag.bulkCreate(
          payload.tags.map((tag) => ({ question_id: question.id, ...tag })),
          { transaction }
        );
      }

      if (payload.options) {
        await QuestionOption.destroy({ where: { question_id: question.id }, transaction });
        await QuestionOption.bulkCreate(
          payload.options.map((text, index) => ({
            question_id: question.id,
            position: index + 1,
            text,
            is_correct: index === payload.correct_option_index,
          })),
          { transaction }
        );
      }
    });

    await refreshQuestionStats(question.id);
    const hydrated = await getQuestionById(question.id);
    const viewerState = await buildViewerState(hydrated, userId);
    const serialized = await serializeQuestion(hydrated, viewerState, userId);
    return res.json({ question: serialized });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to update question.' });
  }
}

async function closeQuestion(req, res) {
  try {
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    if (!ensureQuestionAuthor(question, req.user.userId, res)) return;

    await question.update({
      status: 'closed',
      updated_at: new Date(),
      latest_activity_at: new Date(),
    });

    const hydrated = await getQuestionById(question.id);
    const viewerState = await buildViewerState(hydrated, req.user.userId);
    const serialized = await serializeQuestion(hydrated, viewerState, req.user.userId);
    return res.json({ question: serialized });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to close question.' });
  }
}

async function reopenQuestion(req, res) {
  try {
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    if (!ensureQuestionAuthor(question, req.user.userId, res)) return;

    await question.update({
      status: 'open',
      updated_at: new Date(),
      latest_activity_at: new Date(),
    });

    const hydrated = await getQuestionById(question.id);
    const viewerState = await buildViewerState(hydrated, req.user.userId);
    const serialized = await serializeQuestion(hydrated, viewerState, req.user.userId);
    return res.json({ question: serialized });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reopen question.' });
  }
}

module.exports = {
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  closeQuestion,
  reopenQuestion,
};
