const {
  sequelize,
  QuestionMcqResponse,
  QuestionOption,
} = require('../../models');
const {
  buildViewerState,
  ensureQuestionOpen,
  getQuestionOr404,
} = require('../../services/questions/questionAccess');
const {
  getQuestionById,
  refreshQuestionStats,
  serializeQuestion,
} = require('../../services/questions/questionQueries');

async function submitMcqResponse(req, res) {
  try {
    const userId = req.user.userId;
    const question = await getQuestionOr404(req.params.questionId, res);
    if (!question) return;

    if (question.type !== 'mcq') {
      return res.status(400).json({ error: 'Only MCQ questions accept option responses.' });
    }

    if (!ensureQuestionOpen(question, res)) return;

    if (question.author_id === userId) {
      return res.status(403).json({ error: 'You cannot answer your own question.' });
    }

    const optionIds = Array.isArray(req.body.option_ids)
      ? [...new Set(req.body.option_ids.filter((value) => typeof value === 'string'))]
      : [];

    const options = await QuestionOption.findAll({
      where: { question_id: question.id },
      order: [['position', 'ASC']],
    });

    if (optionIds.length === 0) {
      return res.status(400).json({ error: 'At least one option must be selected.' });
    }

    if (question.mcq_mode === 'single' && optionIds.length !== 1) {
      return res.status(400).json({ error: 'Single-choice MCQ requires exactly one selected option.' });
    }

    if (question.mcq_mode === 'multi' && optionIds.length > options.length) {
      return res.status(400).json({ error: 'Too many options selected for this MCQ.' });
    }

    const validOptionIds = new Set(options.map((option) => option.id));
    const allValid = optionIds.every((optionId) => validOptionIds.has(optionId));
    if (!allValid) {
      return res.status(400).json({ error: 'One or more selected options are invalid.' });
    }

    await sequelize.transaction(async (transaction) => {
      await QuestionMcqResponse.destroy({
        where: { question_id: question.id, user_id: userId },
        transaction,
      });

      await QuestionMcqResponse.bulkCreate(
        optionIds.map((optionId) => ({
          question_id: question.id,
          option_id: optionId,
          user_id: userId,
        })),
        { transaction }
      );
    });

    await refreshQuestionStats(question.id);

    const hydrated = await getQuestionById(question.id);
    const viewerState = await buildViewerState(hydrated, userId);
    const serialized = await serializeQuestion(hydrated, viewerState, userId);
    return res.json({ question: serialized });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to submit MCQ response.' });
  }
}

module.exports = {
  submitMcqResponse,
};
