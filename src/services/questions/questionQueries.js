const { Op } = require('sequelize');
const {
  User,
  Question,
  QuestionOption,
  QuestionMcqResponse,
  QuestionAnswer,
  QuestionDiscussionComment,
  QuestionTag,
} = require('../../models');
const { buildViewerState } = require('./questionAccess');

function getQuestionInclude() {
  return [
    { model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] },
    { model: QuestionTag, as: 'tags', attributes: ['id', 'tag_type', 'tag', 'slug'] },
    { model: QuestionOption, as: 'options', attributes: ['id', 'question_id', 'position', 'text', 'is_correct'], required: false },
  ];
}

async function getQuestionById(questionId) {
  return Question.findByPk(questionId, {
    include: getQuestionInclude(),
    order: [[{ model: QuestionOption, as: 'options' }, 'position', 'ASC']],
  });
}

async function resolveQuestionIdsByTagFilters(filters) {
  const groups = [
    { tag_type: 'role', slugs: filters.role || [] },
    { tag_type: 'stack', slugs: filters.stack || [] },
    { tag_type: 'topic', slugs: filters.topic || [] },
  ].filter((group) => group.slugs.length > 0);

  if (groups.length === 0) {
    return null;
  }

  let intersection = null;

  for (const group of groups) {
    const matches = await QuestionTag.findAll({
      where: {
        tag_type: group.tag_type,
        slug: { [Op.in]: group.slugs },
      },
      attributes: ['question_id'],
      raw: true,
    });

    const ids = new Set(matches.map((row) => row.question_id));
    if (intersection === null) {
      intersection = ids;
    } else {
      intersection = new Set([...intersection].filter((id) => ids.has(id)));
    }

    if (intersection.size === 0) {
      return [];
    }
  }

  return [...(intersection || [])];
}

async function getAnsweredQuestionIdsForUser(userId) {
  const [answerRows, mcqRows] = await Promise.all([
    QuestionAnswer.findAll({
      where: { author_id: userId },
      attributes: ['question_id'],
      raw: true,
    }),
    QuestionMcqResponse.findAll({
      where: { user_id: userId },
      attributes: ['question_id'],
      raw: true,
    }),
  ]);

  return new Set([
    ...answerRows.map((row) => row.question_id),
    ...mcqRows.map((row) => row.question_id),
  ]);
}

function getSortOrder(sort) {
  if (sort === 'newest') {
    return [['created_at', 'DESC']];
  }

  if (sort === 'top') {
    return [
      ['answer_count', 'DESC'],
      ['discussion_count', 'DESC'],
      ['latest_activity_at', 'DESC'],
      ['created_at', 'DESC'],
    ];
  }

  return [
    ['latest_activity_at', 'DESC'],
    ['created_at', 'DESC'],
  ];
}

async function listQuestionsWithFilters(filters, userId) {
  const where = {};

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.needs_my_answer && userId) {
    where.author_id = { [Op.ne]: userId };
    const answeredIds = await getAnsweredQuestionIdsForUser(userId);
    if (answeredIds.size > 0) {
      where.id = { [Op.notIn]: [...answeredIds] };
    }
  }

  const tagFilteredIds = await resolveQuestionIdsByTagFilters(filters);
  if (tagFilteredIds && tagFilteredIds.length === 0) {
    return { questions: [], total: 0, page: filters.page, limit: filters.limit };
  }

  if (tagFilteredIds) {
    if (where.id && where.id[Op.notIn]) {
      where.id = { [Op.and]: [{ [Op.in]: tagFilteredIds }, { [Op.notIn]: where.id[Op.notIn] }] };
    } else {
      where.id = { [Op.in]: tagFilteredIds };
    }
  }

  const { count, rows } = await Question.findAndCountAll({
    where,
    include: [
      { model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] },
      { model: QuestionTag, as: 'tags', attributes: ['id', 'tag_type', 'tag', 'slug'] },
    ],
    order: getSortOrder(filters.sort),
    limit: filters.limit,
    offset: filters.offset,
    distinct: true,
  });

  const questions = [];
  for (const question of rows) {
    const viewerState = await buildViewerState(question, userId);
    questions.push({
      ...question.toJSON(),
      tags: (question.tags || []).sort((a, b) => a.tag.localeCompare(b.tag)),
      viewer_state: viewerState,
    });
  }

  return {
    questions,
    total: count,
    page: filters.page,
    limit: filters.limit,
  };
}

async function getMcqOptionStats(questionId, userId) {
  const [options, responses] = await Promise.all([
    QuestionOption.findAll({
      where: { question_id: questionId },
      order: [['position', 'ASC']],
      raw: true,
    }),
    QuestionMcqResponse.findAll({
      where: { question_id: questionId },
      raw: true,
    }),
  ]);

  const counts = new Map();
  const selected = new Set();

  for (const response of responses) {
    counts.set(response.option_id, (counts.get(response.option_id) || 0) + 1);
    if (userId && response.user_id === userId) {
      selected.add(response.option_id);
    }
  }

  const totalResponses = responses.length;
  return options.map((option) => {
    const voteCount = counts.get(option.id) || 0;
    return {
      ...option,
      vote_count: voteCount,
      vote_percent: totalResponses === 0 ? 0 : Math.round((voteCount / totalResponses) * 100),
      selected_by_me: selected.has(option.id),
      is_correct: Boolean(option.is_correct),
    };
  });
}

async function serializeQuestion(question, viewerState, userId) {
  const data = question.toJSON();
  const base = {
    ...data,
    tags: (data.tags || []).sort((a, b) => a.tag.localeCompare(b.tag)),
    viewer_state: viewerState,
  };

  if (question.type !== 'mcq') {
    return base;
  }

  if (viewerState.can_view_locked_content) {
    base.options = await getMcqOptionStats(question.id, userId);
    return base;
  }

  base.options = (data.options || [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      id: option.id,
      question_id: option.question_id,
      position: option.position,
      text: option.text,
    }));

  return base;
}

async function refreshQuestionStats(questionId) {
  const question = await Question.findByPk(questionId);
  if (!question) return null;

  const [answers, comments, responses] = await Promise.all([
    QuestionAnswer.findAll({
      where: { question_id: questionId },
      attributes: ['author_id', 'updated_at', 'created_at'],
      raw: true,
    }),
    QuestionDiscussionComment.findAll({
      where: { question_id: questionId },
      attributes: ['author_id', 'updated_at', 'created_at'],
      raw: true,
    }),
    QuestionMcqResponse.findAll({
      where: { question_id: questionId },
      attributes: ['user_id', 'created_at'],
      raw: true,
    }),
  ]);

  const participants = new Set([question.author_id]);
  let latest = new Date(question.updated_at || question.created_at || new Date());

  for (const answer of answers) {
    participants.add(answer.author_id);
    const candidate = new Date(answer.updated_at || answer.created_at);
    if (candidate > latest) latest = candidate;
  }

  for (const comment of comments) {
    participants.add(comment.author_id);
    const candidate = new Date(comment.updated_at || comment.created_at);
    if (candidate > latest) latest = candidate;
  }

  for (const response of responses) {
    participants.add(response.user_id);
    const candidate = new Date(response.created_at);
    if (candidate > latest) latest = candidate;
  }

  await question.update({
    answer_count: question.type === 'open' ? answers.length : responses.length,
    discussion_count: comments.length,
    participant_count: participants.size,
    latest_activity_at: latest,
    updated_at: new Date(),
  });

  return question;
}

module.exports = {
  getQuestionInclude,
  getQuestionById,
  listQuestionsWithFilters,
  getMcqOptionStats,
  serializeQuestion,
  refreshQuestionStats,
};
