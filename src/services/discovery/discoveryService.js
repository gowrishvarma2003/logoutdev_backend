const { Op } = require('sequelize');
const {
  User,
  UserProfileSkill,
  Post,
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceStack,
  Launch,
  LaunchTechStack,
  Question,
  QuestionTag,
  FreelanceProject,
  FreelanceProjectSkill,
} = require('../../models');

const DISCOVERY_TYPES = ['builders', 'launches', 'spaces', 'questions', 'freelance'];
const SECTION_LIMIT = 4;

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildProfileHref(user) {
  return `/profile/${user.username || user.id}`;
}

function getSignalsBand(score) {
  if (score >= 70) return 'Strong';
  if (score >= 40) return 'Growing';
  return 'Early';
}

function getRecencyScore(dateValue) {
  if (!dateValue) return 20;
  const diffMs = Date.now() - new Date(dateValue).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return clamp(Math.round(100 - diffDays * 7), 10, 100);
}

function getTextRelevance({ q, stack, tag }, fields, tags = []) {
  if (!q && !stack && !tag) {
    return 55;
  }

  let score = 0;
  const normalizedFields = fields.filter(Boolean).map((value) => String(value).toLowerCase());
  const normalizedTags = tags.filter(Boolean).map((value) => String(value).toLowerCase());

  if (q) {
    if (normalizedFields.some((field) => field.includes(q))) score += 55;
    if (normalizedTags.some((value) => value.includes(q))) score += 15;
  }

  if (stack) {
    if (normalizedTags.some((value) => value.includes(stack))) score += 35;
    if (normalizedFields.some((field) => field.includes(stack))) score += 10;
  }

  if (tag) {
    if (normalizedTags.some((value) => value.includes(tag))) score += 25;
    if (normalizedFields.some((field) => field.includes(tag))) score += 10;
  }

  return clamp(score, 0, 100);
}

function buildRankExplanation(score, reasons, matchedTags, freshnessBucket, proofBand) {
  return {
    score,
    reasons: uniqueStrings(reasons).slice(0, 3),
    matched_stacks: uniqueStrings(matchedTags).slice(0, 4),
    freshness_bucket: freshnessBucket,
    proof_of_work_band: proofBand,
  };
}

function getFreshnessBucket(dateValue) {
  if (!dateValue) return 'steady';
  const diffMs = Date.now() - new Date(dateValue).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours <= 24) return 'hot';
  if (diffHours <= 24 * 7) return 'active';
  return 'steady';
}

function normalizeFilters(query, userId) {
  const q = asTrimmedString(query.q).toLowerCase();
  const stack = asTrimmedString(query.stack).toLowerCase();
  const tag = asTrimmedString(query.tag).toLowerCase();
  const status = asTrimmedString(query.status).toLowerCase();
  const sort = asTrimmedString(query.sort).toLowerCase() || 'recommended';
  const collab = ['1', 'true', 'yes', 'open', 'looking'].includes(asTrimmedString(query.collab).toLowerCase());
  const requestedTypes = asTrimmedString(query.type)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => DISCOVERY_TYPES.includes(value));

  return {
    q,
    stack,
    tag,
    status,
    sort,
    collab,
    userId: userId || null,
    types: requestedTypes.length > 0 ? requestedTypes : DISCOVERY_TYPES,
    sectionLimit: SECTION_LIMIT,
  };
}

function buildExploreHref(filters, overrides = {}) {
  const params = new URLSearchParams();
  const next = {
    q: filters.q,
    type: overrides.type || '',
    stack: filters.stack,
    tag: filters.tag,
    status: filters.status,
    collab: filters.collab ? 'true' : '',
    sort: filters.sort,
  };

  for (const [key, value] of Object.entries(next)) {
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `/explore?${query}` : '/explore';
}

async function fetchBuilders(filters) {
  const skillFilter = filters.stack || filters.tag;
  const skillWhere = skillFilter
    ? { skill: { [Op.iLike]: `%${skillFilter}%` } }
    : undefined;
  const where = {};

  if (filters.q) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${filters.q}%` } },
      { username: { [Op.iLike]: `%${filters.q}%` } },
      { headline: { [Op.iLike]: `%${filters.q}%` } },
    ];
  }

  const users = await User.findAll({
    where,
    attributes: ['id', 'name', 'email', 'username', 'headline', 'created_at'],
    include: [
      {
        model: UserProfileSkill,
        as: 'profile_skills',
        required: Boolean(skillWhere),
        attributes: ['id', 'skill', 'rank', 'created_at'],
        ...(skillWhere ? { where: skillWhere } : {}),
      },
    ],
    order: [['created_at', 'DESC']],
    limit: filters.sectionLimit * 3,
  });

  const items = [];

  for (const user of users) {
    if (filters.userId && user.id === filters.userId) {
      continue;
    }

    const [launchCount, lookingLaunchCount, activeProjects, postsCount, latestLaunch] = await Promise.all([
      Launch.count({ where: { builder_id: user.id, status: 'published' } }),
      Launch.count({ where: { builder_id: user.id, status: 'published', collaboration_mode: 'looking' } }),
      ProjectSpaceMember.count({ where: { user_id: user.id }, distinct: true, col: 'space_id' }),
      Post.count({ where: { user_id: user.id } }),
      Launch.findOne({
        where: { builder_id: user.id, status: 'published' },
        attributes: ['published_at', 'updated_at'],
        order: [['published_at', 'DESC'], ['updated_at', 'DESC']],
      }),
    ]);

    if (!filters.q && !filters.stack && !filters.tag && launchCount === 0 && activeProjects === 0 && postsCount === 0) {
      continue;
    }

    const proofScore = clamp((launchCount * 18) + (activeProjects * 10) + (Math.min(postsCount, 10) * 4), 0, 100);
    const proofBand = getSignalsBand(proofScore);
    const recentActivityAt = latestLaunch?.published_at || latestLaunch?.updated_at || user.created_at;
    const tags = (user.profile_skills || []).map((skill) => skill.skill);
    const relevance = getTextRelevance(filters, [user.name, user.username, user.headline], tags);
    const recency = getRecencyScore(recentActivityAt);
    const collaboration = lookingLaunchCount > 0 ? 100 : 30;
    const score = Math.round((relevance * 0.4) + (recency * 0.2) + (proofScore * 0.25) + (collaboration * 0.15));
    const reasons = [];

    if (filters.stack && tags.some((value) => value.toLowerCase().includes(filters.stack))) reasons.push(`Matches ${filters.stack}`);
    if (lookingLaunchCount > 0) reasons.push('Open to collaborate');
    if (launchCount > 0) reasons.push(`${launchCount} published launches`);

    items.push({
      id: user.id,
      type: 'builder',
      title: user.name,
      subtitle: user.headline || `@${user.username || user.email.split('@')[0]}`,
      href: buildProfileHref(user),
      visibility: 'public',
      tags: tags.slice(0, 4),
      rank_explanation: buildRankExplanation(score, reasons, tags, getFreshnessBucket(recentActivityAt), proofBand),
      meta: {
        eyebrow: 'Builder',
        byline: user.username ? `@${user.username}` : user.email,
        stats: `${launchCount} launches • ${activeProjects} spaces • ${postsCount} posts`,
        updated_at: recentActivityAt,
        collaboration_label: lookingLaunchCount > 0 ? 'Seeking collaborators' : null,
        proof_of_work_band: proofBand,
      },
    });
  }

  items.sort((left, right) => right.rank_explanation.score - left.rank_explanation.score);

  return {
    key: 'builders',
    title: 'Builders',
    see_all_href: buildExploreHref(filters, { type: 'builders' }),
    empty_copy: 'No builders match these filters yet.',
    total: items.length,
    items: items.slice(0, filters.sectionLimit),
  };
}

async function fetchLaunches(filters) {
  const where = { status: 'published' };
  if (filters.q) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${filters.q}%` } },
      { tagline: { [Op.iLike]: `%${filters.q}%` } },
      { description: { [Op.iLike]: `%${filters.q}%` } },
    ];
  }
  if (filters.collab) where.collaboration_mode = 'looking';
  if (filters.status) {
    if (['published', 'draft', 'archived'].includes(filters.status)) where.status = filters.status;
    else where.development_stage = filters.status;
  }

  const stackInclude = {
    model: LaunchTechStack,
    as: 'tech_stack',
    attributes: ['id', 'technology', 'rank', 'created_at'],
    required: Boolean(filters.stack || filters.tag),
    ...((filters.stack || filters.tag)
      ? { where: { technology: { [Op.iLike]: `%${filters.stack || filters.tag}%` } } }
      : {}),
  };

  const rows = await Launch.findAll({
    where,
    include: [
      { model: User, as: 'builder', attributes: ['id', 'name', 'email', 'username'] },
      { model: ProjectSpace, as: 'linked_space', attributes: ['id', 'name', 'slug', 'status', 'visibility'], required: false },
      stackInclude,
    ],
    order: filters.sort === 'newest'
      ? [['published_at', 'DESC'], ['created_at', 'DESC']]
      : [['upvote_count', 'DESC'], ['review_count', 'DESC'], ['published_at', 'DESC']],
    limit: filters.sectionLimit * 3,
  });

  const items = rows.map((launch) => {
    const tags = (launch.tech_stack || []).map((item) => item.technology);
    const relevance = getTextRelevance(filters, [launch.name, launch.tagline, launch.description], tags);
    const recency = getRecencyScore(launch.published_at || launch.updated_at);
    const proofScore = clamp((launch.upvote_count * 8) + (launch.review_count * 14) + (launch.feedback_count * 6), 0, 100);
    const collaboration = launch.collaboration_mode === 'looking' ? 100 : 20;
    const quality = launch.linked_space_id ? 70 : 45;
    const score = Math.round((relevance * 0.4) + (recency * 0.2) + (proofScore * 0.2) + (collaboration * 0.15) + (quality * 0.05));
    const reasons = [];

    if (launch.collaboration_mode === 'looking') reasons.push('Seeking collaborators');
    if (filters.stack && tags.some((value) => value.toLowerCase().includes(filters.stack))) reasons.push(`Matches ${filters.stack}`);
    if (launch.review_count > 0) reasons.push(`${launch.review_count} reviews`);

    return {
      id: launch.id,
      type: 'launch',
      title: launch.name,
      subtitle: launch.tagline,
      href: `/launches/${launch.id}`,
      visibility: 'public',
      tags: tags.slice(0, 4),
      rank_explanation: buildRankExplanation(score, reasons, tags, getFreshnessBucket(launch.published_at || launch.updated_at), getSignalsBand(proofScore)),
      meta: {
        eyebrow: 'Launch',
        byline: launch.builder ? `by ${launch.builder.name}` : null,
        stats: `${launch.upvote_count} upvotes • ${launch.review_count} reviews`,
        updated_at: launch.published_at || launch.updated_at,
        collaboration_label: launch.collaboration_mode === 'looking' ? 'Seeking collaborators' : null,
        status_label: launch.development_stage,
      },
    };
  });

  items.sort((left, right) => right.rank_explanation.score - left.rank_explanation.score);

  return {
    key: 'launches',
    title: 'Launches',
    see_all_href: buildExploreHref(filters, { type: 'launches' }),
    empty_copy: 'No launches match these filters yet.',
    total: items.length,
    items: items.slice(0, filters.sectionLimit),
  };
}

async function fetchSpaces(filters) {
  const where = { visibility: 'public' };
  if (filters.q) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${filters.q}%` } },
      { summary: { [Op.iLike]: `%${filters.q}%` } },
      { description: { [Op.iLike]: `%${filters.q}%` } },
    ];
  }
  if (filters.status && ['idea', 'building', 'shipping', 'paused', 'archived'].includes(filters.status)) {
    where.status = filters.status;
  }

  const stackFilter = filters.stack || filters.tag;
  const rows = await ProjectSpace.findAll({
    where,
    include: [
      { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'] },
      { model: ProjectSpaceMember, as: 'members', attributes: ['id', 'user_id', 'role'] },
      {
        model: ProjectSpaceStack,
        as: 'stack',
        attributes: ['id', 'technology', 'category', 'maturity'],
        required: Boolean(stackFilter),
        ...(stackFilter ? { where: { technology: { [Op.iLike]: `%${stackFilter}%` } } } : {}),
      },
      { model: Launch, as: 'linked_launch', attributes: ['id', 'name', 'slug', 'status', 'upvote_count', 'review_count'], required: false },
    ],
    order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    limit: filters.sectionLimit * 3,
  });

  const items = rows.map((space) => {
    const tags = (space.stack || []).map((item) => item.technology);
    const relevance = getTextRelevance(filters, [space.name, space.summary, space.description], tags);
    const recency = getRecencyScore(space.updated_at || space.created_at);
    const proofScore = clamp(((space.members?.length || 0) * 14) + (space.linked_launch ? 25 : 0), 0, 100);
    const collaboration = ['idea', 'building', 'shipping'].includes(space.status) ? 70 : 25;
    const score = Math.round((relevance * 0.4) + (recency * 0.2) + (proofScore * 0.2) + (collaboration * 0.15) + 5);
    const reasons = [];

    if (space.linked_launch) reasons.push('Linked to a launch');
    if (filters.stack && tags.some((value) => value.toLowerCase().includes(filters.stack))) reasons.push(`Matches ${filters.stack}`);
    reasons.push(`${space.members?.length || 0} members`);

    return {
      id: space.id,
      type: 'space',
      title: space.name,
      subtitle: space.summary,
      href: `/spaces/${space.id}`,
      visibility: space.visibility,
      tags: tags.slice(0, 4),
      rank_explanation: buildRankExplanation(score, reasons, tags, getFreshnessBucket(space.updated_at || space.created_at), getSignalsBand(proofScore)),
      meta: {
        eyebrow: 'Space',
        byline: space.owner ? `by ${space.owner.name}` : null,
        stats: `${space.members?.length || 0} members`,
        updated_at: space.updated_at || space.created_at,
        collaboration_label: ['idea', 'building', 'shipping'].includes(space.status) ? 'Open project space' : null,
        status_label: space.status,
      },
    };
  });

  items.sort((left, right) => right.rank_explanation.score - left.rank_explanation.score);

  return {
    key: 'spaces',
    title: 'Spaces',
    see_all_href: buildExploreHref(filters, { type: 'spaces' }),
    empty_copy: 'No spaces match these filters yet.',
    total: items.length,
    items: items.slice(0, filters.sectionLimit),
  };
}

async function fetchQuestions(filters) {
  const where = {};
  if (filters.q) {
    where[Op.or] = [
      { title: { [Op.iLike]: `%${filters.q}%` } },
      { body: { [Op.iLike]: `%${filters.q}%` } },
    ];
  }
  if (filters.status && ['open', 'closed'].includes(filters.status)) {
    where.status = filters.status;
  }
  if (filters.collab && !where.status) {
    where.status = 'open';
  }

  const tagFilter = filters.stack || filters.tag;
  const rows = await Question.findAll({
    where,
    include: [
      { model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] },
      {
        model: QuestionTag,
        as: 'tags',
        attributes: ['id', 'tag_type', 'tag', 'slug'],
        required: Boolean(tagFilter),
        ...(tagFilter
          ? {
              where: {
                [Op.or]: [
                  { slug: { [Op.iLike]: `%${tagFilter}%` } },
                  { tag: { [Op.iLike]: `%${tagFilter}%` } },
                ],
              },
            }
          : {}),
      },
    ],
    order: filters.sort === 'newest'
      ? [['created_at', 'DESC']]
      : [['latest_activity_at', 'DESC'], ['created_at', 'DESC']],
    limit: filters.sectionLimit * 3,
  });

  const items = rows.map((question) => {
    const tags = (question.tags || []).map((item) => item.slug || item.tag);
    const relevance = getTextRelevance(filters, [question.title, question.body], tags);
    const recency = getRecencyScore(question.latest_activity_at || question.created_at);
    const proofScore = clamp((question.answer_count * 12) + (question.discussion_count * 8) + (question.participant_count * 6), 0, 100);
    const collaboration = question.status === 'open' ? 100 : 20;
    const score = Math.round((relevance * 0.4) + (recency * 0.2) + (proofScore * 0.2) + (collaboration * 0.15) + 5);
    const reasons = [];

    if (question.status === 'open') reasons.push('Open for answers');
    if (filters.stack && tags.some((value) => value.toLowerCase().includes(filters.stack))) reasons.push(`Matches ${filters.stack}`);
    if (question.answer_count > 0) reasons.push(`${question.answer_count} answers`);

    return {
      id: question.id,
      type: 'question',
      title: question.title,
      subtitle: question.body,
      href: `/questions/${question.id}`,
      visibility: 'public',
      tags: tags.slice(0, 6),
      rank_explanation: buildRankExplanation(score, reasons, tags, getFreshnessBucket(question.latest_activity_at || question.created_at), getSignalsBand(proofScore)),
      meta: {
        eyebrow: 'Question',
        byline: question.author ? `by ${question.author.name}` : null,
        stats: `${question.answer_count} answers • ${question.participant_count} participants`,
        updated_at: question.latest_activity_at || question.created_at,
        collaboration_label: question.status === 'open' ? 'Needs answers' : null,
        status_label: question.status,
      },
    };
  });

  items.sort((left, right) => right.rank_explanation.score - left.rank_explanation.score);

  return {
    key: 'questions',
    title: 'Questions',
    see_all_href: buildExploreHref(filters, { type: 'questions' }),
    empty_copy: 'No questions match these filters yet.',
    total: items.length,
    items: items.slice(0, filters.sectionLimit),
  };
}

async function fetchFreelance(filters) {
  const where = {};
  if (filters.q) {
    where[Op.or] = [
      { title: { [Op.iLike]: `%${filters.q}%` } },
      { summary: { [Op.iLike]: `%${filters.q}%` } },
      { description: { [Op.iLike]: `%${filters.q}%` } },
    ];
  }
  if (filters.status && ['open', 'in_review', 'awarded', 'completed', 'cancelled'].includes(filters.status)) {
    where.status = filters.status;
  } else if (filters.collab) {
    where.status = 'open';
  }

  const skillFilter = filters.stack || filters.tag;
  const rows = await FreelanceProject.findAll({
    where,
    include: [
      { model: User, as: 'client', attributes: ['id', 'name', 'email', 'username'] },
      {
        model: FreelanceProjectSkill,
        as: 'skills',
        attributes: ['id', 'skill', 'rank'],
        required: Boolean(skillFilter),
        ...(skillFilter ? { where: { skill: { [Op.iLike]: `%${skillFilter}%` } } } : {}),
      },
      { model: ProjectSpace, as: 'linked_space', attributes: ['id', 'name', 'slug', 'status', 'visibility'], required: false },
    ],
    order: filters.sort === 'active'
      ? [['updated_at', 'DESC'], ['created_at', 'DESC']]
      : [['created_at', 'DESC']],
    limit: filters.sectionLimit * 3,
  });

  const items = rows.map((project) => {
    const tags = (project.skills || []).map((item) => item.skill);
    const relevance = getTextRelevance(filters, [project.title, project.summary, project.description], tags);
    const recency = getRecencyScore(project.updated_at || project.created_at);
    const proofScore = clamp((project.linked_space_id ? 30 : 0) + (project.status === 'awarded' ? 40 : 0) + (project.status === 'open' ? 20 : 10), 0, 100);
    const collaboration = project.status === 'open' ? 100 : 20;
    const score = Math.round((relevance * 0.4) + (recency * 0.2) + (proofScore * 0.2) + (collaboration * 0.15) + 5);
    const reasons = [];

    if (project.status === 'open') reasons.push('Open for proposals');
    if (filters.stack && tags.some((value) => value.toLowerCase().includes(filters.stack))) reasons.push(`Matches ${filters.stack}`);
    if (project.linked_space_id) reasons.push('Linked to a workspace');

    return {
      id: project.id,
      type: 'freelance_project',
      title: project.title,
      subtitle: project.summary,
      href: `/freelance/${project.id}`,
      visibility: 'public',
      tags: tags.slice(0, 5),
      rank_explanation: buildRankExplanation(score, reasons, tags, getFreshnessBucket(project.updated_at || project.created_at), getSignalsBand(proofScore)),
      meta: {
        eyebrow: 'Freelance',
        byline: project.client ? `posted by ${project.client.name}` : null,
        stats: `${project.pricing_model} • ${project.engagement_type}`,
        updated_at: project.updated_at || project.created_at,
        collaboration_label: project.status === 'open' ? 'Open for proposals' : null,
        status_label: project.status,
      },
    };
  });

  items.sort((left, right) => right.rank_explanation.score - left.rank_explanation.score);

  return {
    key: 'freelance',
    title: 'Freelance',
    see_all_href: buildExploreHref(filters, { type: 'freelance' }),
    empty_copy: 'No freelance projects match these filters yet.',
    total: items.length,
    items: items.slice(0, filters.sectionLimit),
  };
}

function buildRailModules(filters, sections) {
  const tags = new Map();
  sections.forEach((section) => {
    section.items.forEach((item) => {
      item.tags.forEach((tag) => {
        const normalized = tag.toLowerCase();
        tags.set(normalized, (tags.get(normalized) || 0) + 1);
      });
    });
  });

  const trendingStacks = [...tags.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([label, count]) => ({
      label,
      href: `/explore?stack=${encodeURIComponent(label)}`,
      meta: `${count} signals`,
    }));

  const builders = sections.find((section) => section.key === 'builders')?.items || [];
  const launches = sections.find((section) => section.key === 'launches')?.items || [];
  const questions = sections.find((section) => section.key === 'questions')?.items || [];
  const freelance = sections.find((section) => section.key === 'freelance')?.items || [];
  const modules = [];

  if (trendingStacks.length > 0) {
    modules.push({
      key: 'trending_stacks',
      title: 'Trending stacks',
      reason: 'Based on current cross-service discovery matches.',
      items: trendingStacks,
    });
  }

  if (builders.length > 0) {
    modules.push({
      key: 'builders_to_follow',
      title: filters.userId ? 'Suggested collaborators' : 'Builders to know',
      reason: filters.userId ? 'Active builders with visible proof-of-work.' : 'Strong public builder profiles.',
      items: builders.slice(0, 4).map((item) => ({ label: item.title, href: item.href, meta: item.meta.stats })),
    });
  }

  if (launches.length > 0) {
    modules.push({
      key: 'active_launches',
      title: 'Active launches',
      reason: 'Products with fresh momentum or collaboration signals.',
      items: launches.slice(0, 4).map((item) => ({ label: item.title, href: item.href, meta: item.meta.collaboration_label || item.meta.stats })),
    });
  }

  if (questions.length > 0) {
    modules.push({
      key: 'open_questions',
      title: 'Open questions',
      reason: 'Good contribution opportunities right now.',
      items: questions.slice(0, 4).map((item) => ({ label: item.title, href: item.href, meta: item.meta.stats })),
    });
  }

  if (freelance.length > 0) {
    modules.push({
      key: 'freelance_matches',
      title: 'Freelance matches',
      reason: 'Projects that fit the current discovery filters.',
      items: freelance.slice(0, 4).map((item) => ({ label: item.title, href: item.href, meta: item.meta.status_label || item.meta.stats })),
    });
  }

  return modules;
}

async function getDiscoveryResult(query, userId) {
  const filters = normalizeFilters(query, userId);
  const sections = [];

  if (filters.types.includes('builders')) sections.push(await fetchBuilders(filters));
  if (filters.types.includes('launches')) sections.push(await fetchLaunches(filters));
  if (filters.types.includes('spaces')) sections.push(await fetchSpaces(filters));
  if (filters.types.includes('questions')) sections.push(await fetchQuestions(filters));
  if (filters.types.includes('freelance')) sections.push(await fetchFreelance(filters));

  return {
    query: filters.q,
    applied_filters: {
      q: filters.q,
      type: filters.types,
      stack: filters.stack,
      tag: filters.tag,
      status: filters.status,
      collab: filters.collab,
      sort: filters.sort,
      viewer_context: filters.userId ? 'authenticated' : 'guest',
    },
    sections,
    rail_modules: buildRailModules(filters, sections),
    featured_entities: sections
      .flatMap((section) => section.items)
      .sort((left, right) => right.rank_explanation.score - left.rank_explanation.score)
      .slice(0, 3),
    suggested_next_filters: buildRailModules(filters, sections)
      .find((module) => module.key === 'trending_stacks')
      ?.items.slice(0, 3)
      .map((item) => item.label) || [],
    guest_safe: true,
  };
}

module.exports = {
  getDiscoveryResult,
};