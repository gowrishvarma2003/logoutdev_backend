const { Op, fn, col, literal } = require('sequelize');
const {
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  ProjectSpaceIssue,
  ProjectSpaceStack,
  PullRequest,
  RepoDiscussion,
  RepoFork,
  RepoStar,
  RepoWatch,
  User,
  UserProfileSkill,
} = require('../../models');
const {
  buildSpaceViewerPermissions,
} = require('../spaces/spaceAccess');
const { getAccessContext } = require('../spaces/repoAccess');
const { isAllowedValue, REPO_VISIBILITIES } = require('../spaces/spaceValidation');

const ACTIVE_SPACE_STATUSES = ['idea', 'building', 'shipping'];
const OPEN_WORK_STATUSES = ['open', 'triaged', 'in-progress'];
const VALID_SCOPES = ['all', 'mine', 'shared', 'starred', 'public', 'recommended'];
const MAX_RECOMMENDATION_CANDIDATES = 500;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeToken(value) {
  return asTrimmedString(value).toLowerCase();
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function hasText(value) {
  return asTrimmedString(value).length > 0;
}

function boolFromQueryValue(value) {
  if (value === true || value === false) return value;
  const normalized = normalizeToken(value);
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return null;
}

function daysSince(dateValue) {
  if (!dateValue) return Infinity;
  const timestamp = new Date(dateValue).getTime();
  if (!Number.isFinite(timestamp)) return Infinity;
  return (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
}

function getFreshnessBucket(dateValue, activityCount = 0) {
  const days = daysSince(dateValue);
  if (days <= 7 || activityCount >= 5) return 'hot';
  if (days <= 30 || activityCount >= 2) return 'active';
  return 'steady';
}

function recencyPoints(dateValue, maxPoints) {
  const days = daysSince(dateValue);
  if (days <= 7) return maxPoints;
  if (days <= 30) return Math.round(maxPoints * 0.75);
  if (days <= 90) return Math.round(maxPoints * 0.45);
  if (days <= 180) return Math.round(maxPoints * 0.25);
  return Math.round(maxPoints * 0.1);
}

function logPoints(count, maxPoints, scale = 8) {
  const numeric = Math.max(Number(count) || 0, 0);
  if (numeric <= 0) return 0;
  return clamp(Math.round((Math.log2(numeric + 1) / Math.log2(scale + 1)) * maxPoints), 1, maxPoints);
}

function collectRepoTags(repo) {
  const space = repo.space || {};
  return uniqueStrings([
    repo.language,
    ...(repo.languages || []).map((language) => language.name),
    ...((space.stack || []).map((item) => item.technology)),
    ...((Array.isArray(space.needed_skills) ? space.needed_skills : [])),
    ...((Array.isArray(space.open_roles) ? space.open_roles : [])),
  ]).map((value) => String(value));
}

function findStackMatch(repoTags, viewerSkills, filters = {}) {
  const normalizedTags = repoTags.map((tag) => normalizeToken(tag));
  const explicit = normalizeToken(filters.stack || filters.tag);
  if (explicit) {
    const tag = repoTags.find((value) => normalizeToken(value).includes(explicit));
    if (tag) return tag;
  }

  return viewerSkills.find((skill) => normalizedTags.some((tag) => tag.includes(normalizeToken(skill))));
}

function scoreRepositoryRecommendation({ repo, metrics = {}, viewerSignals = {}, filters = {} }) {
  const space = repo.space || null;
  const repoTags = collectRepoTags(repo);
  const viewerSkills = viewerSignals.skills || [];
  const matchedStack = findStackMatch(repoTags, viewerSkills, filters);
  const activeSpace = Boolean(space && ACTIVE_SPACE_STATUSES.includes(space.status));
  const publicAttachedSpace = Boolean(space && repo.space_id && space.visibility === 'public');
  const openRolesCount = Array.isArray(space?.open_roles) ? space.open_roles.length : 0;
  const neededSkillsCount = Array.isArray(space?.needed_skills) ? space.needed_skills.length : 0;
  const contributionReady = hasText(space?.contribution_guide);
  const activityCount = (metrics.open_pull_request_count || 0)
    + (metrics.open_issue_count || 0)
    + (metrics.discussion_count || 0);

  const collaborationFit = clamp(
    (repo.visibility === 'public' ? 3 : 0)
      + (publicAttachedSpace ? 8 : 0)
      + (activeSpace ? 6 : 0)
      + (openRolesCount > 0 ? 4 : 0)
      + (neededSkillsCount > 0 ? 3 : 0)
      + (contributionReady ? 5 : 0)
      + ((metrics.good_first_task_count || 0) > 0 ? 4 : 0)
      + ((metrics.help_wanted_count || 0) > 0 ? 3 : 0)
      + (space?.working_in_public ? 2 : 0)
      + (hasText(space?.current_focus) ? 2 : 0),
    0,
    35
  );

  const explicitStack = normalizeToken(filters.stack || filters.tag);
  const explicitStackMatched = Boolean(
    explicitStack && repoTags.some((tag) => normalizeToken(tag).includes(explicitStack))
  );
  const viewerSkillMatched = Boolean(matchedStack && !explicitStackMatched);
  const stackFit = clamp(
    (explicitStackMatched ? 15 : 0)
      + (viewerSkillMatched ? 10 : 0)
      + (repo.language ? 3 : 0)
      + (repoTags.length > 1 ? 4 : 0)
      + (neededSkillsCount > 0 ? 3 : 0),
    0,
    25
  );

  const freshnessActivity = clamp(
    recencyPoints(repo.updated_at || repo.created_at, 8)
      + logPoints(metrics.open_pull_request_count || 0, 3, 5)
      + logPoints(metrics.open_issue_count || 0, 3, 8)
      + logPoints(metrics.discussion_count || 0, 2, 6),
    0,
    15
  );

  const socialProof = clamp(
    logPoints(metrics.star_count || 0, 5, 24)
      + logPoints(metrics.fork_count || 0, 4, 12)
      + logPoints(metrics.watcher_count || 0, 3, 12)
      + logPoints(metrics.collaborator_count || 0, 3, 8),
    0,
    15
  );

  const completenessTrust = clamp(
    (hasText(repo.description) ? 3 : 0)
      + (publicAttachedSpace ? 2 : 0)
      + (repo.owner?.username || repo.owner?.name ? 2 : 0)
      + (contributionReady ? 2 : 0)
      + (repo.default_branch ? 1 : 0),
    0,
    10
  );

  const signalBreakdown = {
    collaboration_fit: collaborationFit,
    stack_fit: stackFit,
    freshness_activity: freshnessActivity,
    social_proof: socialProof,
    completeness_trust: completenessTrust,
  };

  const reasons = [];
  if (matchedStack) reasons.push(`Matches ${matchedStack}`);
  if ((metrics.good_first_task_count || 0) > 0) reasons.push('Good first tasks');
  if ((metrics.help_wanted_count || 0) > 0) reasons.push('Help wanted');
  if (activeSpace) reasons.push('Active project space');
  if (contributionReady) reasons.push('Contribution ready');
  if (openRolesCount > 0) reasons.push('Looking for collaborators');
  if (daysSince(repo.updated_at || repo.created_at) <= 7) reasons.push('Fresh activity');
  if ((metrics.star_count || 0) > 0) reasons.push('Community traction');

  const score = Object.values(signalBreakdown).reduce((sum, value) => sum + value, 0);

  return {
    score,
    reasons: uniqueStrings(reasons).slice(0, 3),
    matched_stacks: matchedStack ? [matchedStack] : [],
    freshness_bucket: getFreshnessBucket(repo.updated_at || repo.created_at, activityCount),
    signal_breakdown: signalBreakdown,
    source: 'logoutdev',
  };
}

function isRecommendationCandidate(repo, requesterId = null) {
  return Boolean(
    repo
    && repo.visibility === 'public'
    && !repo.archived_at
    && (!requesterId || repo.owner_id !== requesterId)
  );
}

function buildAttachedSpace(repo) {
  if (!repo.space) return null;
  return {
    id: repo.space.id,
    name: repo.space.name,
    slug: repo.space.slug,
    visibility: repo.space.visibility,
  };
}

function buildCollaborationHome(repo, access) {
  if (!repo.space || !repo.space_id) {
    return {
      type: 'none',
      can_contribute: false,
      can_start_discussion: false,
    };
  }

  const viewerPermissions = buildSpaceViewerPermissions(repo.space, access.membership, access.user_id);

  return {
    type: 'space',
    space_id: repo.space.id,
    href: `/spaces/${repo.space.id}/discussions`,
    can_contribute: viewerPermissions.can_reply || viewerPermissions.can_manage_discussions,
    can_start_discussion: viewerPermissions.can_create_discussion,
  };
}

function serializeRepoSummary(repo, access, metrics = {}, recommendation = null) {
  const payload = {
    ...repo.toJSON(),
    my_role: access.my_role,
    effective_role: access.effective_role,
    inherited_role: access.inherited_role,
    direct_role: access.direct_role,
    is_outside_collaborator: access.is_outside_collaborator,
    permissions: access.permissions,
    can_read: access.permissions.can_read,
    can_push: access.permissions.can_push,
    can_open_pr: access.permissions.can_open_pr,
    can_review: access.permissions.can_review,
    can_merge: access.permissions.can_merge,
    can_manage_rules: access.permissions.can_manage_rules,
    can_manage_access: access.permissions.can_manage_access,
    can_archive: access.permissions.can_archive,
    can_delete: access.permissions.can_delete,
    can_manage_general: access.permissions.can_manage_general,
    can_manage_releases: access.permissions.can_manage_releases,
    can_manage_branches: access.permissions.can_manage_branches,
    can_manage_default_branch: access.permissions.can_manage_default_branch,
    can_comment: access.permissions.can_comment,
    attached_space: buildAttachedSpace(repo),
    collaboration_home: buildCollaborationHome(repo, access),
    is_attached: Boolean(repo.space_id),
    collaborator_count: metrics.collaborator_count || 0,
    star_count: metrics.star_count || 0,
    watcher_count: metrics.watcher_count || 0,
    fork_count: metrics.fork_count || 0,
    is_starred: Boolean(metrics.is_starred),
    is_watching: Boolean(metrics.watch_level),
    watch_level: metrics.watch_level || null,
    forked_from: metrics.forked_from || null,
  };

  if (recommendation) {
    payload.recommendation = recommendation;
  }

  return payload;
}

async function countByRepo(model, repoIds, columnName = 'repo_id', extraWhere = {}) {
  if (!repoIds.length) return new Map();

  const rows = await model.findAll({
    where: {
      ...extraWhere,
      [columnName]: { [Op.in]: repoIds },
    },
    attributes: [
      [col(columnName), 'repo_key'],
      [fn('COUNT', col(columnName)), 'count'],
    ],
    group: [columnName],
    raw: true,
  });

  return new Map(rows.map((row) => [row.repo_key, Number(row.count) || 0]));
}

async function loadForkOrigins(repoIds) {
  if (!repoIds.length) return new Map();

  const rows = await RepoFork.findAll({
    where: { forked_repo_id: { [Op.in]: repoIds } },
    include: [
      {
        model: ProjectSpaceRepo,
        as: 'source_repo',
        required: false,
        include: [
          { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
        ],
      },
    ],
  });

  return new Map(rows.map((fork) => [
    fork.forked_repo_id,
    fork.source_repo
      ? {
          id: fork.source_repo.id,
          name: fork.source_repo.name,
          slug: fork.source_repo.slug,
          owner: fork.source_repo.owner
            ? {
                id: fork.source_repo.owner.id,
                name: fork.source_repo.owner.name,
                username: fork.source_repo.owner.username,
              }
            : null,
        }
      : null,
  ]));
}

async function loadViewerRepoState(repoIds, requesterId) {
  if (!requesterId || !repoIds.length) {
    return { starred: new Set(), watches: new Map() };
  }

  const [stars, watches] = await Promise.all([
    RepoStar.findAll({
      where: { repo_id: { [Op.in]: repoIds }, user_id: requesterId },
      attributes: ['repo_id'],
      raw: true,
    }),
    RepoWatch.findAll({
      where: { repo_id: { [Op.in]: repoIds }, user_id: requesterId },
      attributes: ['repo_id', 'level'],
      raw: true,
    }),
  ]);

  return {
    starred: new Set(stars.map((star) => star.repo_id)),
    watches: new Map(watches.map((watch) => [watch.repo_id, watch.level])),
  };
}

async function loadRepoMetrics(repoIds, requesterId = null) {
  const [
    starCounts,
    watcherCounts,
    forkCounts,
    collaboratorCounts,
    openPullRequestCounts,
    openIssueCounts,
    goodFirstTaskCounts,
    helpWantedCounts,
    discussionCounts,
    viewerState,
    forkOrigins,
  ] = await Promise.all([
    countByRepo(RepoStar, repoIds),
    countByRepo(RepoWatch, repoIds),
    countByRepo(RepoFork, repoIds, 'source_repo_id'),
    countByRepo(ProjectSpaceRepoMember, repoIds, 'repo_id', { status: 'accepted' }),
    countByRepo(PullRequest, repoIds, 'repo_id', { status: 'open' }),
    countByRepo(ProjectSpaceIssue, repoIds, 'repo_id', { status: { [Op.in]: OPEN_WORK_STATUSES } }),
    countByRepo(ProjectSpaceIssue, repoIds, 'repo_id', {
      status: { [Op.in]: OPEN_WORK_STATUSES },
      good_first_task: true,
    }),
    countByRepo(ProjectSpaceIssue, repoIds, 'repo_id', {
      status: { [Op.in]: OPEN_WORK_STATUSES },
      help_wanted: true,
    }),
    countByRepo(RepoDiscussion, repoIds),
    loadViewerRepoState(repoIds, requesterId),
    loadForkOrigins(repoIds),
  ]);

  return new Map(repoIds.map((repoId) => [
    repoId,
    {
      star_count: starCounts.get(repoId) || 0,
      watcher_count: watcherCounts.get(repoId) || 0,
      fork_count: forkCounts.get(repoId) || 0,
      collaborator_count: collaboratorCounts.get(repoId) || 0,
      open_pull_request_count: openPullRequestCounts.get(repoId) || 0,
      open_issue_count: openIssueCounts.get(repoId) || 0,
      good_first_task_count: goodFirstTaskCounts.get(repoId) || 0,
      help_wanted_count: helpWantedCounts.get(repoId) || 0,
      discussion_count: discussionCounts.get(repoId) || 0,
      is_starred: viewerState.starred.has(repoId),
      watch_level: viewerState.watches.get(repoId) || null,
      forked_from: forkOrigins.get(repoId) || null,
    },
  ]));
}

async function getReadableWhere(requesterId) {
  if (!requesterId) {
    return { visibility: 'public' };
  }

  const [directMemberships, spaceMemberships, ownedSpaces] = await Promise.all([
    ProjectSpaceRepoMember.findAll({
      where: { user_id: requesterId, status: 'accepted' },
      attributes: ['repo_id'],
      raw: true,
    }),
    ProjectSpaceMember.findAll({
      where: { user_id: requesterId, role: { [Op.in]: ['owner', 'maintainer'] } },
      attributes: ['space_id'],
      raw: true,
    }),
    ProjectSpace.findAll({
      where: { owner_id: requesterId },
      attributes: ['id'],
      raw: true,
    }),
  ]);

  const readableBranches = [
    { visibility: 'public' },
    { owner_id: requesterId },
  ];
  const directRepoIds = directMemberships.map((row) => row.repo_id);
  const inheritedSpaceIds = uniqueStrings([
    ...spaceMemberships.map((row) => row.space_id),
    ...ownedSpaces.map((row) => row.id),
  ]);

  if (directRepoIds.length) {
    readableBranches.push({ id: { [Op.in]: directRepoIds } });
  }

  if (inheritedSpaceIds.length) {
    readableBranches.push({ space_id: { [Op.in]: inheritedSpaceIds } });
  }

  return { [Op.or]: readableBranches };
}

function buildIncludes({ includeStack = false, stackFilter = '' } = {}) {
  return [
    {
      model: ProjectSpace,
      as: 'space',
      required: false,
      include: includeStack
        ? [
            {
              model: ProjectSpaceStack,
              as: 'stack',
              attributes: ['id', 'technology', 'category', 'maturity'],
              required: false,
            },
          ]
        : [],
    },
    { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
  ];
}

function buildCommonWhere(baseWhere, filters = {}) {
  const and = [{ archived_at: null }, baseWhere].filter(Boolean);
  const visibility = normalizeToken(filters.visibility);
  const q = normalizeToken(filters.q);
  const stack = normalizeToken(filters.stack || filters.language);
  const attached = boolFromQueryValue(filters.attached);

  if (visibility && isAllowedValue(visibility, REPO_VISIBILITIES)) {
    and.push({ visibility });
  }

  if (attached === true) {
    and.push({ space_id: { [Op.ne]: null } });
  } else if (attached === false) {
    and.push({ space_id: null });
  }

  if (q) {
    const pattern = `%${q}%`;
    and.push({
      [Op.or]: [
        { name: { [Op.iLike]: pattern } },
        { slug: { [Op.iLike]: pattern } },
        { description: { [Op.iLike]: pattern } },
        { '$owner.username$': { [Op.iLike]: pattern } },
        { '$owner.name$': { [Op.iLike]: pattern } },
      ],
    });
  }

  if (stack) {
    const pattern = `%${stack}%`;
    and.push({
      [Op.or]: [
        { language: { [Op.iLike]: pattern } },
        { '$space.stack.technology$': { [Op.iLike]: pattern } },
      ],
    });
  }

  return { [Op.and]: and };
}

function buildOrder(sort) {
  if (sort === 'stars') {
    return [
      [literal('(SELECT COUNT(*) FROM repo_stars WHERE repo_stars.repo_id = "ProjectSpaceRepo"."id")'), 'DESC'],
      ['updated_at', 'DESC'],
    ];
  }

  if (sort === 'newest') {
    return [['created_at', 'DESC'], ['updated_at', 'DESC']];
  }

  return [['updated_at', 'DESC'], ['created_at', 'DESC']];
}

async function loadViewerSignals(requesterId) {
  if (!requesterId) return { skills: [] };

  const skills = await UserProfileSkill.findAll({
    where: { user_id: requesterId },
    attributes: ['skill'],
    order: [['rank', 'ASC'], ['created_at', 'ASC']],
    limit: 12,
    raw: true,
  });

  return {
    skills: skills.map((row) => row.skill).filter(Boolean),
  };
}

async function serializeRows(rows, requesterId, recommendationByRepoId = new Map()) {
  const repoIds = rows.map((repo) => repo.id);
  const metricsByRepoId = await loadRepoMetrics(repoIds, requesterId);
  const accessEntries = await Promise.all(rows.map(async (repo) => [repo.id, await getAccessContext(repo, requesterId)]));
  const accessByRepoId = new Map(accessEntries);

  return rows
    .map((repo) => {
      const access = accessByRepoId.get(repo.id);
      if (!access?.permissions.can_read) return null;
      return serializeRepoSummary(
        repo,
        access,
        metricsByRepoId.get(repo.id) || {},
        recommendationByRepoId.get(repo.id) || null
      );
    })
    .filter(Boolean);
}

async function listRecommendedRepositories({ requesterId, filters, page, limit, offset }) {
  const visibility = normalizeToken(filters.visibility);
  if (visibility && visibility !== 'public') {
    return { repos: [], total: 0, page, limit };
  }

  const baseWhere = {
    visibility: 'public',
    ...(requesterId ? { owner_id: { [Op.ne]: requesterId } } : {}),
    id: { [Op.notIn]: literal('(SELECT "forked_repo_id" FROM "repo_forks")') },
  };
  const where = buildCommonWhere(baseWhere, { ...filters, visibility: 'public' });
  const rows = await ProjectSpaceRepo.findAll({
    where,
    include: buildIncludes({ includeStack: true, stackFilter: filters.stack }),
    order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    limit: MAX_RECOMMENDATION_CANDIDATES,
    subQuery: false,
  });
  const repoById = new Map(rows.map((repo) => [repo.id, repo]));
  const uniqueRows = Array.from(repoById.values());
  const metricsByRepoId = await loadRepoMetrics(uniqueRows.map((repo) => repo.id), requesterId);
  const viewerSignals = await loadViewerSignals(requesterId);
  const scored = uniqueRows
    .filter((repo) => isRecommendationCandidate(repo, requesterId))
    .map((repo) => {
      const recommendation = scoreRepositoryRecommendation({
        repo,
        metrics: metricsByRepoId.get(repo.id) || {},
        viewerSignals,
        filters,
      });
      return { repo, recommendation };
    })
    .sort((left, right) => {
      if (right.recommendation.score !== left.recommendation.score) {
        return right.recommendation.score - left.recommendation.score;
      }
      return new Date(right.repo.updated_at).getTime() - new Date(left.repo.updated_at).getTime();
    });

  const pageItems = scored.slice(offset, offset + limit);
  const recommendationByRepoId = new Map(pageItems.map((item) => [item.repo.id, item.recommendation]));

  return {
    repos: await serializeRows(pageItems.map((item) => item.repo), requesterId, recommendationByRepoId),
    total: scored.length,
    page,
    limit,
  };
}

async function listRepositorySummaries({
  requesterId = null,
  scope = 'all',
  visibility = '',
  attached,
  q = '',
  stack = '',
  language = '',
  sort = 'updated',
  page = 1,
  limit = 20,
  offset = 0,
} = {}) {
  const normalizedScope = VALID_SCOPES.includes(scope) ? scope : 'all';
  const filters = { visibility, attached, q, stack, language };

  if (normalizedScope === 'recommended') {
    return listRecommendedRepositories({ requesterId, filters, page, limit, offset });
  }

  let baseWhere = await getReadableWhere(requesterId);

  if (normalizedScope === 'mine') {
    if (!requesterId) {
      return { repos: [], total: 0, page, limit };
    }
    baseWhere = { owner_id: requesterId };
  } else if (normalizedScope === 'shared') {
    if (!requesterId) {
      return { repos: [], total: 0, page, limit };
    }
    const memberships = await ProjectSpaceRepoMember.findAll({
      where: { user_id: requesterId, status: 'accepted' },
      attributes: ['repo_id'],
      raw: true,
    });
    const repoIds = memberships.map((row) => row.repo_id);
    if (!repoIds.length) {
      return { repos: [], total: 0, page, limit };
    }
    baseWhere = {
      [Op.and]: [
        baseWhere,
        { owner_id: { [Op.ne]: requesterId } },
        { id: { [Op.in]: repoIds } },
      ],
    };
  } else if (normalizedScope === 'starred') {
    if (!requesterId) {
      return { repos: [], total: 0, page, limit };
    }
    const stars = await RepoStar.findAll({
      where: { user_id: requesterId },
      attributes: ['repo_id'],
      raw: true,
    });
    const repoIds = stars.map((row) => row.repo_id);
    if (!repoIds.length) {
      return { repos: [], total: 0, page, limit };
    }
    baseWhere = {
      [Op.and]: [
        baseWhere,
        { id: { [Op.in]: repoIds } },
      ],
    };
  } else if (normalizedScope === 'public') {
    baseWhere = { visibility: 'public', id: { [Op.notIn]: literal('(SELECT "forked_repo_id" FROM "repo_forks")') } };
  }

  const includeStack = Boolean(stack || language);
  const { rows, count } = await ProjectSpaceRepo.findAndCountAll({
    where: buildCommonWhere(baseWhere, filters),
    include: buildIncludes({ includeStack, stackFilter: stack || language }),
    order: buildOrder(sort),
    limit,
    offset,
    distinct: true,
    subQuery: false,
  });

  return {
    repos: await serializeRows(rows, requesterId),
    total: count,
    page,
    limit,
  };
}

module.exports = {
  VALID_SCOPES,
  isRecommendationCandidate,
  listRepositorySummaries,
  scoreRepositoryRecommendation,
};
