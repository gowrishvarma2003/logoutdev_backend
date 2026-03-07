const QUESTION_TYPES = new Set(['open', 'mcq']);
const MCQ_MODES = new Set(['single', 'multi']);
const QUESTION_STATUSES = new Set(['open', 'closed']);
const QUESTION_TAG_TYPES = new Set(['role', 'stack', 'topic']);
const ROLE_TAG_VALUES = new Set([
  'frontend',
  'backend',
  'fullstack',
  'mobile',
  'devops',
  'data',
  'ai-ml',
  'security',
  'qa',
  'product',
  'design',
  'career',
]);

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function slugifyTag(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) {
    throw new Error('Tags are required.');
  }

  const normalized = [];
  const seen = new Set();
  const counts = { role: 0, stack: 0, topic: 0 };

  for (const rawTag of rawTags) {
    const tagType = asTrimmedString(rawTag?.tag_type).toLowerCase();
    const rawValue = asTrimmedString(rawTag?.tag);

    if (!QUESTION_TAG_TYPES.has(tagType)) {
      throw new Error('Invalid tag type.');
    }

    let slug;
    if (tagType === 'role') {
      slug = rawValue.toLowerCase();
      if (!ROLE_TAG_VALUES.has(slug)) {
        throw new Error('Invalid role tag.');
      }
    } else {
      slug = slugifyTag(rawValue);
      if (!slug) {
        throw new Error('Tag value is required.');
      }
    }

    const key = `${tagType}:${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    counts[tagType] += 1;
    if (counts.role > 2 || counts.stack > 3 || counts.topic > 3) {
      throw new Error('Too many tags of a given type.');
    }

    normalized.push({
      tag_type: tagType,
      tag: slug,
      slug,
    });
  }

  if (normalized.length === 0) {
    throw new Error('At least one tag is required.');
  }

  if (normalized.length > 6) {
    throw new Error('No more than 6 tags are allowed.');
  }

  const hasRequiredTypedTag = normalized.some(
    (tag) => tag.tag_type === 'role' || tag.tag_type === 'stack'
  );

  if (!hasRequiredTypedTag) {
    throw new Error('At least one role or stack tag is required.');
  }

  return normalized;
}

function normalizeOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) {
    throw new Error('MCQ options are required.');
  }

  const seen = new Set();
  const options = [];

  for (const rawOption of rawOptions) {
    const text = asTrimmedString(rawOption);
    const key = text.toLowerCase();
    if (!text) continue;
    if (seen.has(key)) {
      throw new Error('MCQ options must be unique.');
    }
    seen.add(key);
    options.push(text);
  }

  if (options.length < 2 || options.length > 4) {
    throw new Error('MCQ questions must have between 2 and 4 options.');
  }

  return options;
}

function normalizeCorrectOptionIndex(rawIndex, optionsLength, { required = true } = {}) {
  if (rawIndex === undefined || rawIndex === null || rawIndex === '') {
    if (required) {
      throw new Error('A correct answer option is required for MCQ questions.');
    }
    return undefined;
  }

  const index = Number.parseInt(String(rawIndex), 10);
  if (!Number.isInteger(index) || index < 0 || index >= optionsLength) {
    throw new Error('Correct answer option is invalid.');
  }

  return index;
}

function validateQuestionPayload(payload, { isUpdate = false, existingQuestion = null, hasMcqResponses = false } = {}) {
  const next = {};

  if (!isUpdate || payload.title !== undefined) {
    const title = asTrimmedString(payload.title);
    if (title.length < 8 || title.length > 160) {
      throw new Error('Question title must be between 8 and 160 characters.');
    }
    next.title = title;
  }

  if (!isUpdate || payload.body !== undefined) {
    const body = asTrimmedString(payload.body);
    if (body.length < 20 || body.length > 4000) {
      throw new Error('Question body must be between 20 and 4000 characters.');
    }
    next.body = body;
  }

  const currentType = existingQuestion?.type || null;
  const requestedType =
    payload.type !== undefined ? asTrimmedString(payload.type).toLowerCase() : currentType;

  if (!requestedType || !QUESTION_TYPES.has(requestedType)) {
    throw new Error('Invalid question type.');
  }

  if (isUpdate && payload.type !== undefined && requestedType !== currentType) {
    throw new Error('Question type cannot be changed after creation.');
  }

  next.type = requestedType;

  const requestedMcqMode =
    payload.mcq_mode !== undefined
      ? asTrimmedString(payload.mcq_mode).toLowerCase()
      : existingQuestion?.mcq_mode || null;

  if (requestedType === 'mcq') {
    if (!MCQ_MODES.has(requestedMcqMode)) {
      throw new Error('MCQ questions must use single or multi mode.');
    }
    next.mcq_mode = requestedMcqMode;
  } else {
    next.mcq_mode = null;
  }

  if (!isUpdate || payload.tags !== undefined) {
    next.tags = normalizeTags(payload.tags);
  }

  if (requestedType === 'mcq') {
    if (!isUpdate || payload.options !== undefined) {
      if (isUpdate && hasMcqResponses) {
        throw new Error('MCQ options cannot be edited after the first response.');
      }
      next.options = normalizeOptions(payload.options);
      next.correct_option_index = normalizeCorrectOptionIndex(payload.correct_option_index, next.options.length);
    } else if (payload.correct_option_index !== undefined) {
      throw new Error('Correct answer can only be updated together with the MCQ options.');
    }
  } else if (payload.options !== undefined && Array.isArray(payload.options) && payload.options.length > 0) {
    throw new Error('Open questions cannot include MCQ options.');
  }

  return next;
}

function validateAnswerBody(value) {
  const body = asTrimmedString(value);
  if (body.length < 20 || body.length > 3000) {
    throw new Error('Answer body must be between 20 and 3000 characters.');
  }
  return body;
}

function validateDiscussionBody(value) {
  const body = asTrimmedString(value);
  if (body.length < 1 || body.length > 1000) {
    throw new Error('Discussion comment must be between 1 and 1000 characters.');
  }
  return body;
}

function parseQuestionFilters(query) {
  const page = clamp(parseInt(query.page, 10) || 1, 1, 1000);
  const limit = clamp(parseInt(query.limit, 10) || 20, 1, 50);
  const type = asTrimmedString(query.type).toLowerCase();
  const status = asTrimmedString(query.status).toLowerCase();
  const sort = asTrimmedString(query.sort).toLowerCase() || 'active';
  const needsMyAnswer = parseBoolean(query.needs_my_answer);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    type: QUESTION_TYPES.has(type) ? type : undefined,
    status: QUESTION_STATUSES.has(status) ? status : undefined,
    sort: ['newest', 'active', 'unanswered', 'top'].includes(sort) ? sort : 'active',
    needs_my_answer: needsMyAnswer,
    role: toArray(query.role).map((value) => value.toLowerCase()).filter((value) => ROLE_TAG_VALUES.has(value)),
    stack: toArray(query.stack).map(slugifyTag).filter(Boolean),
    topic: toArray(query.topic).map(slugifyTag).filter(Boolean),
  };
}

module.exports = {
  QUESTION_TYPES,
  MCQ_MODES,
  QUESTION_STATUSES,
  QUESTION_TAG_TYPES,
  ROLE_TAG_VALUES,
  asTrimmedString,
  slugifyTag,
  normalizeTags,
  normalizeOptions,
  normalizeCorrectOptionIndex,
  validateQuestionPayload,
  validateAnswerBody,
  validateDiscussionBody,
  parseQuestionFilters,
};
