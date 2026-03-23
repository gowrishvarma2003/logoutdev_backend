const { Op } = require('sequelize');
const {
  sequelize,
  ProjectSpaceIssue,
  ProjectSpaceIssueActivity,
  ProjectSpaceMember,
  ProjectSpaceMilestone,
  ProjectSpaceRepo,
  User,
} = require('../../models');
const {
  ensureSpaceReadable,
  getMembership,
  isMaintainerOrOwner,
} = require('../../services/spaces/spaceAccess');
const {
  ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  WORK_ITEM_TYPES,
  asTrimmedString,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');
const { parsePagination } = require('../../services/spaces/pagination');
const { logWorkActivity } = require('../../services/spaces/workActivity');

const FINAL_STATUSES = new Set(['resolved', 'closed']);
const WORK_SORTS = new Set(['updated', 'created', 'priority', 'due_date']);
const DUE_STATES = new Set(['overdue', 'due_soon', 'scheduled', 'none']);
const READINESS_VALUES = new Set(['ready', 'needs_triage']);

const ISSUE_INCLUDE = [
  { model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] },
  { model: User, as: 'assignee', attributes: ['id', 'name', 'email', 'username'], required: false },
  { model: ProjectSpaceRepo, as: 'repo', attributes: ['id', 'name', 'slug', 'visibility'], required: false },
  {
    model: ProjectSpaceMilestone,
    as: 'milestone',
    attributes: ['id', 'title', 'status', 'target_date'],
    required: false,
  },
];

async function loadIssue(spaceId, issueId) {
  return ProjectSpaceIssue.findOne({
    where: { id: issueId, space_id: spaceId },
    include: ISSUE_INCLUDE,
  });
}

async function ensureLinkedRepo(spaceId, repoId) {
  if (!repoId) return null;

  return ProjectSpaceRepo.findOne({
    where: {
      id: repoId,
      space_id: spaceId,
      archived_at: null,
    },
    attributes: ['id'],
  });
}

async function ensureMilestone(spaceId, milestoneId) {
  if (!milestoneId) return null;

  return ProjectSpaceMilestone.findOne({
    where: { id: milestoneId, space_id: spaceId },
    attributes: ['id'],
  });
}

function parseBooleanFlag(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function getTodayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function getDateOnlyDaysFromToday(days) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return now.toISOString().slice(0, 10);
}

function isFinalStatus(status) {
  return FINAL_STATUSES.has(status);
}

function getDueState(issue) {
  if (!issue.target_date) return 'none';
  if (isFinalStatus(issue.status)) return 'scheduled';

  const today = getTodayDateOnly();
  const dueSoonCutoff = getDateOnlyDaysFromToday(7);

  if (issue.target_date < today) return 'overdue';
  if (issue.target_date <= dueSoonCutoff) return 'due_soon';
  return 'scheduled';
}

function isIssueStale(issue) {
  if (isFinalStatus(issue.status)) return false;
  const updatedAt = new Date(issue.updated_at || issue.created_at || Date.now());
  const staleCutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);
  return updatedAt.getTime() < staleCutoff;
}

function getReadiness(issue) {
  if (issue.status === 'open' && !issue.assignee_user_id) {
    return 'needs_triage';
  }

  if (
    !issue.assignee_user_id
    && !issue.blocked_reason
    && (issue.good_first_task || issue.help_wanted)
    && ['open', 'triaged'].includes(issue.status)
  ) {
    return 'ready';
  }

  return null;
}

function canClaimIssue(issue, membership) {
  return Boolean(
    membership
    && !issue.assignee_user_id
    && (issue.good_first_task || issue.help_wanted)
    && ['open', 'triaged'].includes(issue.status)
  );
}

function canStartIssue(issue, membership, userId) {
  return Boolean(
    membership
    && issue.assignee_user_id === userId
    && ['open', 'triaged'].includes(issue.status)
  );
}

function canResolveIssue(issue, membership, userId) {
  return Boolean(
    membership
    && issue.assignee_user_id === userId
    && issue.status === 'in-progress'
  );
}

function buildViewerState(issue, space, membership, userId) {
  const canManage = Boolean(userId && (space.owner_id === userId || isMaintainerOrOwner(membership)));
  const canReporterEdit = Boolean(
    userId
    && issue.author_id === userId
    && ['open', 'triaged'].includes(issue.status)
  );
  const canClaim = !canManage && Boolean(userId) && canClaimIssue(issue, membership);
  const canStart = !canManage && Boolean(userId) && canStartIssue(issue, membership, userId);
  const canResolve = !canManage && Boolean(userId) && canResolveIssue(issue, membership, userId);

  return {
    can_manage: canManage,
    can_edit_content: canManage || canReporterEdit,
    can_claim: canClaim,
    can_start: canStart,
    can_resolve: canResolve,
    can_bulk_manage: canManage,
    is_claimed_by_me: Boolean(userId && issue.assignee_user_id === userId),
    is_member: Boolean(membership),
  };
}

function decorateIssue(issue, { space, membership, requesterId }) {
  const plain = typeof issue.toJSON === 'function' ? issue.toJSON() : { ...issue };
  return {
    ...plain,
    due_state: getDueState(plain),
    is_stale: isIssueStale(plain),
    readiness: getReadiness(plain),
    viewer_state: buildViewerState(plain, space, membership, requesterId),
  };
}

function summarizeIssues(issues) {
  return issues.reduce((summary, issue) => {
    const unresolved = !isFinalStatus(issue.status);

    summary.total += 1;
    if (unresolved) summary.open += 1;
    if (unresolved && !issue.assignee_user_id) summary.unassigned += 1;
    if (unresolved && issue.blocked_reason) summary.blocked += 1;
    if (issue.status === 'open' && !issue.assignee_user_id) summary.needs_triage += 1;

    const dueState = getDueState(issue);
    if (dueState === 'overdue') summary.overdue += 1;
    if (dueState === 'due_soon') summary.due_soon += 1;
    if (isIssueStale(issue)) summary.stale += 1;
    if (getReadiness(issue) === 'ready') summary.ready_for_contributor += 1;

    summary.by_status[issue.status] = (summary.by_status[issue.status] || 0) + 1;
    return summary;
  }, {
    total: 0,
    open: 0,
    unassigned: 0,
    blocked: 0,
    overdue: 0,
    due_soon: 0,
    stale: 0,
    ready_for_contributor: 0,
    needs_triage: 0,
    by_status: {
      open: 0,
      triaged: 0,
      'in-progress': 0,
      resolved: 0,
      closed: 0,
    },
  });
}

function getOrder(sort) {
  switch (sort) {
    case 'created':
      return [['created_at', 'DESC'], ['updated_at', 'DESC']];
    case 'priority':
      return [[
        sequelize.literal(`CASE "ProjectSpaceIssue"."priority"
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END`),
        'DESC',
      ], ['updated_at', 'DESC']];
    case 'due_date':
      return [[
        sequelize.literal('CASE WHEN "ProjectSpaceIssue"."target_date" IS NULL THEN 1 ELSE 0 END'),
        'ASC',
      ], ['target_date', 'ASC'], ['updated_at', 'DESC']];
    case 'updated':
    default:
      return [['updated_at', 'DESC'], ['created_at', 'DESC']];
  }
}

function buildSearchCondition(query) {
  return {
    [Op.or]: [
      { title: { [Op.iLike]: `%${query}%` } },
      { body: { [Op.iLike]: `%${query}%` } },
      { '$author.name$': { [Op.iLike]: `%${query}%` } },
      { '$author.username$': { [Op.iLike]: `%${query}%` } },
      { '$assignee.name$': { [Op.iLike]: `%${query}%` } },
      { '$assignee.username$': { [Op.iLike]: `%${query}%` } },
    ],
  };
}

function parseWorkFilters(query, requesterId) {
  const status = asTrimmedString(query.status || '');
  const priority = asTrimmedString(query.priority || '');
  const assignee = asTrimmedString(query.assignee || '');
  const type = asTrimmedString(query.type || '');
  const repoId = asTrimmedString(query.repo_id || '');
  const neededSkill = asTrimmedString(query.needed_skill || '');
  const q = asTrimmedString(query.q || '');
  const sort = asTrimmedString(query.sort || 'updated') || 'updated';
  const dueState = asTrimmedString(query.due_state || '');
  const readiness = asTrimmedString(query.readiness || '');
  const goodFirst = parseBooleanFlag(query.good_first);
  const helpWanted = parseBooleanFlag(query.help_wanted);
  const blocked = parseBooleanFlag(query.blocked);
  const stale = parseBooleanFlag(query.stale);

  if (status && !isAllowedValue(status, ISSUE_STATUSES)) {
    throw new Error('Invalid issue status filter.');
  }

  if (priority && !isAllowedValue(priority, ISSUE_PRIORITIES)) {
    throw new Error('Invalid issue priority filter.');
  }

  if (type && !isAllowedValue(type, WORK_ITEM_TYPES)) {
    throw new Error('Invalid work item type filter.');
  }

  if (sort && !WORK_SORTS.has(sort)) {
    throw new Error('Invalid work sort.');
  }

  if (dueState && !DUE_STATES.has(dueState)) {
    throw new Error('Invalid due state filter.');
  }

  if (readiness && !READINESS_VALUES.has(readiness)) {
    throw new Error('Invalid readiness filter.');
  }

  if (assignee === 'me' && !requesterId) {
    throw new Error('Authentication required to filter by current assignee.');
  }

  return {
    status: status || undefined,
    priority: priority || undefined,
    assignee: assignee || undefined,
    type: type || undefined,
    repo_id: repoId || undefined,
    needed_skill: neededSkill || undefined,
    q: q || undefined,
    sort,
    due_state: dueState || undefined,
    readiness: readiness || undefined,
    good_first: goodFirst,
    help_wanted: helpWanted,
    blocked,
    stale,
  };
}

function buildWhereClause(filters, requesterId) {
  const where = {};
  const andConditions = [];

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.priority) {
    where.priority = filters.priority;
  }

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.assignee) {
    if (filters.assignee === 'me') {
      where.assignee_user_id = requesterId;
    } else if (filters.assignee === 'unassigned') {
      where.assignee_user_id = null;
    } else {
      where.assignee_user_id = filters.assignee;
    }
  }

  if (filters.repo_id) {
    where.repo_id = filters.repo_id;
  }

  if (filters.needed_skill) {
    andConditions.push({ needed_skill: { [Op.iLike]: `%${filters.needed_skill}%` } });
  }

  if (filters.good_first !== null) {
    where.good_first_task = filters.good_first;
  }

  if (filters.help_wanted !== null) {
    where.help_wanted = filters.help_wanted;
  }

  if (filters.blocked === true) {
    andConditions.push({ blocked_reason: { [Op.ne]: null } });
  } else if (filters.blocked === false) {
    andConditions.push({ blocked_reason: null });
  }

  if (filters.q) {
    andConditions.push(buildSearchCondition(filters.q));
  }

  if (filters.due_state) {
    const today = getTodayDateOnly();
    const dueSoonCutoff = getDateOnlyDaysFromToday(7);

    if (filters.due_state === 'overdue') {
      andConditions.push({ target_date: { [Op.lt]: today } });
      andConditions.push({ status: { [Op.notIn]: [...FINAL_STATUSES] } });
    } else if (filters.due_state === 'due_soon') {
      andConditions.push({ target_date: { [Op.gte]: today, [Op.lte]: dueSoonCutoff } });
      andConditions.push({ status: { [Op.notIn]: [...FINAL_STATUSES] } });
    } else if (filters.due_state === 'scheduled') {
      andConditions.push({ target_date: { [Op.ne]: null } });
      andConditions.push({ status: { [Op.notIn]: [...FINAL_STATUSES] } });
    } else if (filters.due_state === 'none') {
      andConditions.push({ target_date: null });
    }
  }

  if (filters.stale === true) {
    andConditions.push({
      updated_at: {
        [Op.lt]: new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)),
      },
    });
    andConditions.push({ status: { [Op.notIn]: [...FINAL_STATUSES] } });
  }

  if (filters.readiness === 'ready') {
    andConditions.push({ assignee_user_id: null });
    andConditions.push({ blocked_reason: null });
    andConditions.push({ status: { [Op.in]: ['open', 'triaged'] } });
    andConditions.push({
      [Op.or]: [
        { good_first_task: true },
        { help_wanted: true },
      ],
    });
  } else if (filters.readiness === 'needs_triage') {
    andConditions.push({ status: 'open' });
    andConditions.push({ assignee_user_id: null });
  }

  if (andConditions.length > 0) {
    where[Op.and] = andConditions;
  }

  return where;
}

async function resolveManagedIssueUpdates(spaceId, body, currentIssue) {
  const updates = {};

  if (body.status !== undefined) {
    const status = asTrimmedString(body.status);
    if (!isAllowedValue(status, ISSUE_STATUSES)) {
      throw new Error('Invalid issue status.');
    }
    updates.status = status;
  }

  if (body.priority !== undefined) {
    const priority = asTrimmedString(body.priority);
    if (!isAllowedValue(priority, ISSUE_PRIORITIES)) {
      throw new Error('Invalid issue priority.');
    }
    updates.priority = priority;
  }

  if (body.type !== undefined) {
    const type = asTrimmedString(body.type);
    if (!isAllowedValue(type, WORK_ITEM_TYPES)) {
      throw new Error('Invalid work item type.');
    }
    updates.type = type;
  }

  if (body.assignee_user_id !== undefined) {
    const assigneeUserId = asTrimmedString(body.assignee_user_id);

    if (!assigneeUserId) {
      updates.assignee_user_id = null;
    } else {
      const assigneeMembership = await ProjectSpaceMember.findOne({
        where: { space_id: spaceId, user_id: assigneeUserId },
        attributes: ['id'],
      });

      if (!assigneeMembership) {
        throw new Error('Assignee must be a current contributor in this space.');
      }

      updates.assignee_user_id = assigneeUserId;
    }
  }

  if (body.repo_id !== undefined) {
    const repoId = asTrimmedString(body.repo_id);
    if (!repoId) {
      updates.repo_id = null;
    } else if (!(await ensureLinkedRepo(spaceId, repoId))) {
      throw new Error('Linked repository must belong to this space.');
    } else {
      updates.repo_id = repoId;
    }
  }

  if (body.milestone_id !== undefined) {
    const milestoneId = asTrimmedString(body.milestone_id);
    if (!milestoneId) {
      updates.milestone_id = null;
    } else if (!(await ensureMilestone(spaceId, milestoneId))) {
      throw new Error('Milestone must belong to this space.');
    } else {
      updates.milestone_id = milestoneId;
    }
  }

  if (body.good_first_task !== undefined) {
    updates.good_first_task = parseBooleanFlag(body.good_first_task) ?? false;
  }

  if (body.help_wanted !== undefined) {
    updates.help_wanted = parseBooleanFlag(body.help_wanted) ?? false;
  }

  if (body.blocked_reason !== undefined) {
    updates.blocked_reason = asTrimmedString(body.blocked_reason) || null;
  }

  if (body.close_reason !== undefined) {
    updates.close_reason = asTrimmedString(body.close_reason) || null;
  }

  if (body.estimate !== undefined) {
    updates.estimate = asTrimmedString(body.estimate) || null;
  }

  if (body.target_date !== undefined) {
    updates.target_date = asTrimmedString(body.target_date) || null;
  }

  if (body.needed_skill !== undefined) {
    updates.needed_skill = asTrimmedString(body.needed_skill) || null;
  }

  const nextStatus = updates.status || currentIssue?.status || 'open';
  const nextCloseReason = updates.close_reason !== undefined
    ? updates.close_reason
    : (currentIssue?.close_reason ?? null);

  if (nextStatus === 'closed' && !nextCloseReason) {
    throw new Error('Close reason is required when closing work.');
  }

  if (!isFinalStatus(nextStatus)) {
    updates.close_reason = null;
  }

  return updates;
}

function truncateValue(value, max = 120) {
  if (value === null || value === undefined || value === '') return null;
  const stringValue = String(value);
  return stringValue.length > max ? `${stringValue.slice(0, max - 1)}…` : stringValue;
}

function formatIssueFieldValue(issue, field) {
  switch (field) {
    case 'title':
      return truncateValue(issue.title, 120);
    case 'body':
      return truncateValue(issue.body, 160);
    case 'status':
    case 'priority':
    case 'type':
    case 'estimate':
    case 'target_date':
    case 'needed_skill':
    case 'blocked_reason':
    case 'close_reason':
      return truncateValue(issue[field], 120);
    case 'good_first_task':
    case 'help_wanted':
      return issue[field] ? 'Yes' : 'No';
    case 'assignee_user_id':
      return issue.assignee?.name || null;
    case 'repo_id':
      return issue.repo?.name || null;
    case 'milestone_id':
      return issue.milestone?.title || null;
    default:
      return truncateValue(issue[field], 120);
  }
}

function buildChangeEntries(previousIssue, nextIssue, updates) {
  const FIELD_LABELS = {
    title: 'Title',
    body: 'Description',
    status: 'Status',
    priority: 'Priority',
    type: 'Type',
    assignee_user_id: 'Assignee',
    repo_id: 'Repo',
    milestone_id: 'Milestone',
    good_first_task: 'Good first task',
    help_wanted: 'Help wanted',
    blocked_reason: 'Blocked reason',
    close_reason: 'Close reason',
    estimate: 'Estimate',
    target_date: 'Target date',
    needed_skill: 'Needed skill',
  };

  return Object.keys(updates)
    .filter((field) => field !== 'updated_at')
    .map((field) => ({
      field,
      label: FIELD_LABELS[field] || field,
      from: formatIssueFieldValue(previousIssue, field),
      to: formatIssueFieldValue(nextIssue, field),
    }))
    .filter((entry) => entry.from !== entry.to);
}

async function listIssues(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const space = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!space) return;

    let filters;
    try {
      filters = parseWorkFilters(req.query, requesterId);
    } catch (error) {
      const status = error.message.includes('Authentication required') ? 401 : 400;
      return res.status(status).json({ error: error.message });
    }

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const membership = requesterId ? await getMembership(req.params.spaceId, requesterId) : null;
    const where = {
      space_id: req.params.spaceId,
      ...buildWhereClause(filters, requesterId),
    };

    const { count, rows } = await ProjectSpaceIssue.findAndCountAll({
      where,
      include: ISSUE_INCLUDE,
      order: getOrder(filters.sort),
      limit,
      offset,
      distinct: true,
    });

    const issues = rows.map((issue) => decorateIssue(issue, {
      space,
      membership,
      requesterId,
    }));

    return res.json({ issues, total: count, page, limit, sort: filters.sort });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch issues.' });
  }
}

async function getIssue(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const { spaceId, issueId } = req.params;

    const space = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!space) return;

    const membership = requesterId ? await getMembership(spaceId, requesterId) : null;
    const issue = await loadIssue(spaceId, issueId);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found.' });
    }

    return res.json({
      issue: decorateIssue(issue, {
        space,
        membership,
        requesterId,
      }),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch issue.' });
  }
}

async function createIssue(req, res) {
  try {
    const userId = req.user.userId;
    const space = await ensureSpaceReadable(req.params.spaceId, userId, res);
    if (!space) return;

    const title = asTrimmedString(req.body.title);
    const body = asTrimmedString(req.body.body);
    const type = asTrimmedString(req.body.type || 'task') || 'task';
    const priority = asTrimmedString(req.body.priority || 'medium') || 'medium';
    const repoId = asTrimmedString(req.body.repo_id || '') || null;
    const assigneeUserId = asTrimmedString(req.body.assignee_user_id || '') || null;
    const targetDate = asTrimmedString(req.body.target_date || '') || null;
    const milestoneId = asTrimmedString(req.body.milestone_id || '') || null;

    if (title.length < 5) {
      return res.status(400).json({ error: 'Issue title must be at least 5 characters.' });
    }

    if (body.length < 10) {
      return res.status(400).json({ error: 'Issue body must be at least 10 characters.' });
    }

    if (!isAllowedValue(type, WORK_ITEM_TYPES)) {
      return res.status(400).json({ error: 'Invalid work item type.' });
    }

    if (!isAllowedValue(priority, ISSUE_PRIORITIES)) {
      return res.status(400).json({ error: 'Invalid issue priority.' });
    }

    if (repoId && !(await ensureLinkedRepo(req.params.spaceId, repoId))) {
      return res.status(400).json({ error: 'Linked repository must belong to this space.' });
    }

    if (milestoneId && !(await ensureMilestone(req.params.spaceId, milestoneId))) {
      return res.status(400).json({ error: 'Milestone must belong to this space.' });
    }

    if (assigneeUserId) {
      const assigneeMembership = await ProjectSpaceMember.findOne({
        where: { space_id: req.params.spaceId, user_id: assigneeUserId },
        attributes: ['id'],
      });

      if (!assigneeMembership) {
        return res.status(400).json({ error: 'Assignee must be a current contributor in this space.' });
      }
    }

    const issue = await ProjectSpaceIssue.create({
      space_id: req.params.spaceId,
      author_id: userId,
      title,
      body,
      type,
      status: 'open',
      priority,
      assignee_user_id: assigneeUserId,
      repo_id: repoId,
      milestone_id: milestoneId,
      good_first_task: parseBooleanFlag(req.body.good_first_task) ?? false,
      help_wanted: parseBooleanFlag(req.body.help_wanted) ?? false,
      blocked_reason: asTrimmedString(req.body.blocked_reason) || null,
      close_reason: null,
      estimate: asTrimmedString(req.body.estimate) || null,
      target_date: targetDate || null,
      needed_skill: asTrimmedString(req.body.needed_skill) || null,
      updated_at: new Date(),
    });

    await logWorkActivity({
      spaceId: req.params.spaceId,
      issueId: issue.id,
      actorUserId: userId,
      eventType: 'work_created',
      payload: {
        title,
        status: 'open',
        priority,
      },
      createdAt: issue.created_at,
    });

    const membership = await getMembership(req.params.spaceId, userId);
    const hydratedIssue = await loadIssue(req.params.spaceId, issue.id);
    return res.status(201).json({
      issue: decorateIssue(hydratedIssue, {
        space,
        membership,
        requesterId: userId,
      }),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create issue.' });
  }
}

async function updateIssue(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, issueId } = req.params;

    const space = await ensureSpaceReadable(spaceId, userId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    const issue = await loadIssue(spaceId, issueId);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found.' });
    }

    const canManage = space.owner_id === userId || isMaintainerOrOwner(membership);
    const canReporterEdit = issue.author_id === userId && ['open', 'triaged'].includes(issue.status);
    const requestedFields = Object.keys(req.body);
    const wantsContent = requestedFields.some((field) => ['title', 'body'].includes(field));
    const wantsManagedFields = requestedFields.some((field) => !['title', 'body'].includes(field));

    if (wantsManagedFields && !canManage) {
      const requestedAssignee = req.body.assignee_user_id !== undefined
        ? asTrimmedString(req.body.assignee_user_id)
        : undefined;
      const requestedStatus = req.body.status !== undefined
        ? asTrimmedString(req.body.status)
        : undefined;
      const selfClaimOnly = requestedFields.every((field) => ['assignee_user_id', 'status'].includes(field));
      const canClaim = canClaimIssue(issue, membership);
      const canStart = canStartIssue(issue, membership, userId);
      const canResolve = canResolveIssue(issue, membership, userId);

      if (
        !selfClaimOnly
        || (
          requestedAssignee !== undefined
          && requestedAssignee !== userId
        )
        || (
          requestedStatus !== undefined
          && requestedStatus !== 'in-progress'
          && requestedStatus !== 'triaged'
          && requestedStatus !== 'resolved'
        )
        || (
          requestedAssignee !== undefined
          && requestedAssignee === userId
          && !canClaim
        )
        || (
          requestedStatus === 'in-progress'
          && !canStart
        )
        || (
          requestedStatus === 'resolved'
          && !canResolve
        )
      ) {
        return res.status(403).json({ error: 'Only owner or maintainer can manage issue status, priority, or assignment.' });
      }
    }

    if (wantsContent && !canManage && !canReporterEdit) {
      return res.status(403).json({ error: 'Only the reporter can edit open issues they created.' });
    }

    const updates = {};

    if (req.body.title !== undefined) {
      const title = asTrimmedString(req.body.title);
      if (title.length < 5) {
        return res.status(400).json({ error: 'Issue title must be at least 5 characters.' });
      }
      updates.title = title;
    }

    if (req.body.body !== undefined) {
      const body = asTrimmedString(req.body.body);
      if (body.length < 10) {
        return res.status(400).json({ error: 'Issue body must be at least 10 characters.' });
      }
      updates.body = body;
    }

    try {
      if (canManage) {
        Object.assign(updates, await resolveManagedIssueUpdates(spaceId, req.body, issue));
      } else if (requestedFields.some((field) => ['assignee_user_id', 'status'].includes(field))) {
        const requestedAssignee = req.body.assignee_user_id !== undefined
          ? asTrimmedString(req.body.assignee_user_id)
          : undefined;
        const requestedStatus = req.body.status !== undefined
          ? asTrimmedString(req.body.status)
          : undefined;

        if (requestedAssignee === userId && canClaimIssue(issue, membership)) {
          updates.assignee_user_id = userId;
          if (issue.status === 'open' && requestedStatus !== 'in-progress') {
            updates.status = 'triaged';
          }
        }

        if (requestedStatus === 'in-progress' && canStartIssue({ ...issue.toJSON(), assignee_user_id: updates.assignee_user_id || issue.assignee_user_id }, membership, userId)) {
          updates.status = 'in-progress';
          updates.assignee_user_id = updates.assignee_user_id || issue.assignee_user_id || userId;
        }

        if (requestedStatus === 'resolved' && canResolveIssue(issue, membership, userId)) {
          updates.status = 'resolved';
        }
      }
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Invalid issue update.' });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid issue fields were provided.' });
    }

    const previousIssue = issue.toJSON();
    updates.updated_at = new Date();
    await issue.update(updates);

    const hydratedIssue = await loadIssue(spaceId, issue.id);
    const nextIssue = hydratedIssue.toJSON();
    const changes = buildChangeEntries(previousIssue, nextIssue, updates);

    if (changes.length > 0) {
      await logWorkActivity({
        spaceId,
        issueId: issue.id,
        actorUserId: userId,
        eventType: 'work_updated',
        payload: {
          changes,
          source: canManage ? 'edit' : 'self_service',
        },
      });
    }

    return res.json({
      issue: decorateIssue(hydratedIssue, {
        space,
        membership,
        requesterId: userId,
      }),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update issue.' });
  }
}

async function bulkUpdateWork(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId } = req.params;

    const space = await ensureSpaceReadable(spaceId, userId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    const canManage = space.owner_id === userId || isMaintainerOrOwner(membership);
    if (!canManage) {
      return res.status(403).json({ error: 'Only owner or maintainer can bulk manage work.' });
    }

    const issueIds = Array.isArray(req.body.issue_ids)
      ? [...new Set(req.body.issue_ids.map((value) => asTrimmedString(value)).filter(Boolean))]
      : [];
    if (issueIds.length === 0 || issueIds.length > 50) {
      return res.status(400).json({ error: 'Bulk update requires between 1 and 50 work items.' });
    }

    const changesPayload = req.body.changes && typeof req.body.changes === 'object' ? req.body.changes : null;
    if (!changesPayload) {
      return res.status(400).json({ error: 'Bulk update changes payload is required.' });
    }

    let updates;
    try {
      updates = await resolveManagedIssueUpdates(spaceId, changesPayload, null);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Invalid bulk update payload.' });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid work fields were provided for bulk update.' });
    }

    const issues = await ProjectSpaceIssue.findAll({
      where: { id: issueIds, space_id: spaceId },
      include: ISSUE_INCLUDE,
      order: [['updated_at', 'DESC']],
    });
    if (issues.length !== issueIds.length) {
      return res.status(400).json({ error: 'One or more work items were not found in this space.' });
    }

    const updatedIssues = [];
    for (const issue of issues) {
      const previousIssue = issue.toJSON();
      const issueUpdates = {
        ...updates,
        updated_at: new Date(),
      };

      const nextStatus = issueUpdates.status || issue.status;
      if (!isFinalStatus(nextStatus)) {
        issueUpdates.close_reason = null;
      }

      // eslint-disable-next-line no-await-in-loop
      await issue.update(issueUpdates);
      // eslint-disable-next-line no-await-in-loop
      const hydratedIssue = await loadIssue(spaceId, issue.id);
      const nextIssue = hydratedIssue.toJSON();
      const changes = buildChangeEntries(previousIssue, nextIssue, issueUpdates);

      if (changes.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await logWorkActivity({
          spaceId,
          issueId: issue.id,
          actorUserId: userId,
          eventType: 'work_updated',
          payload: {
            changes,
            source: 'bulk',
          },
        });
      }

      updatedIssues.push(decorateIssue(hydratedIssue, {
        space,
        membership,
        requesterId: userId,
      }));
    }

    return res.json({ issues: updatedIssues, updated: updatedIssues.length });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to bulk update work.' });
  }
}

async function getWorkActivity(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const { spaceId, issueId } = req.params;

    const readableSpace = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!readableSpace) return;

    const issue = await ProjectSpaceIssue.findOne({
      where: { id: issueId, space_id: spaceId },
      attributes: ['id'],
    });
    if (!issue) {
      return res.status(404).json({ error: 'Work item not found.' });
    }

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const { count, rows: activity } = await ProjectSpaceIssueActivity.findAndCountAll({
      where: { issue_id: issue.id, space_id: spaceId },
      include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email', 'username'] }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return res.json({ activity, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch work activity.' });
  }
}

async function getWorkSummary(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const { spaceId } = req.params;

    const readableSpace = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!readableSpace) return;

    let filters;
    try {
      filters = parseWorkFilters(req.query, requesterId);
    } catch (error) {
      const status = error.message.includes('Authentication required') ? 401 : 400;
      return res.status(status).json({ error: error.message });
    }

    const where = {
      space_id: spaceId,
      ...buildWhereClause(filters, requesterId),
    };

    const issues = await ProjectSpaceIssue.findAll({
      where,
      attributes: [
        'id',
        'status',
        'assignee_user_id',
        'blocked_reason',
        'good_first_task',
        'help_wanted',
        'target_date',
        'updated_at',
      ],
    });

    return res.json({ summary: summarizeIssues(issues.map((issue) => issue.toJSON())) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch work summary.' });
  }
}

module.exports = {
  listIssues,
  getIssue,
  createIssue,
  updateIssue,
  bulkUpdateWork,
  getWorkActivity,
  getWorkSummary,
  listWork: listIssues,
  getWork: getIssue,
  createWork: createIssue,
  updateWork: updateIssue,
  bulkUpdateIssues: bulkUpdateWork,
  getIssueActivity: getWorkActivity,
  getIssueSummary: getWorkSummary,
};
