const { ProjectSpaceIssue, ProjectSpaceMember, User } = require('../../models');
const {
  ensureSpaceReadable,
  getMembership,
  isMaintainerOrOwner,
} = require('../../services/spaces/spaceAccess');
const {
  ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  asTrimmedString,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');
const { parsePagination } = require('../../services/spaces/pagination');

const ISSUE_INCLUDE = [
  { model: User, as: 'author', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'assignee', attributes: ['id', 'name', 'email'] },
];

async function loadIssue(spaceId, issueId) {
  return ProjectSpaceIssue.findOne({
    where: { id: issueId, space_id: spaceId },
    include: ISSUE_INCLUDE,
  });
}

async function listIssues(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const space = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!space) return;

    const status = asTrimmedString(req.query.status || '');
    const priority = asTrimmedString(req.query.priority || '');
    const assignee = asTrimmedString(req.query.assignee || '');
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const where = { space_id: req.params.spaceId };

    if (status) {
      if (!isAllowedValue(status, ISSUE_STATUSES)) {
        return res.status(400).json({ error: 'Invalid issue status filter.' });
      }
      where.status = status;
    }

    if (priority) {
      if (!isAllowedValue(priority, ISSUE_PRIORITIES)) {
        return res.status(400).json({ error: 'Invalid issue priority filter.' });
      }
      where.priority = priority;
    }

    if (assignee) {
      if (assignee === 'me') {
        if (!requesterId) {
          return res.status(401).json({ error: 'Authentication required to filter by current assignee.' });
        }
        where.assignee_user_id = requesterId;
      } else {
        where.assignee_user_id = assignee;
      }
    }

    const { count, rows: issues } = await ProjectSpaceIssue.findAndCountAll({
      where,
      include: ISSUE_INCLUDE,
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return res.json({ issues, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch issues.' });
  }
}

async function getIssue(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const space = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!space) return;

    const issue = await loadIssue(req.params.spaceId, req.params.issueId);
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found.' });
    }

    return res.json({ issue });
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

    if (title.length < 5) {
      return res.status(400).json({ error: 'Issue title must be at least 5 characters.' });
    }

    if (body.length < 10) {
      return res.status(400).json({ error: 'Issue body must be at least 10 characters.' });
    }

    const issue = await ProjectSpaceIssue.create({
      space_id: req.params.spaceId,
      author_id: userId,
      title,
      body,
      status: 'open',
      priority: 'medium',
      assignee_user_id: null,
    });

    const hydratedIssue = await loadIssue(req.params.spaceId, issue.id);
    return res.status(201).json({ issue: hydratedIssue });
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

    const issue = await ProjectSpaceIssue.findOne({
      where: { id: issueId, space_id: spaceId },
    });
    if (!issue) {
      return res.status(404).json({ error: 'Issue not found.' });
    }

    const membership = await getMembership(spaceId, userId);
    const canManage = space.owner_id === userId || isMaintainerOrOwner(membership);
    const canReporterEdit = issue.author_id === userId && ['open', 'triaged'].includes(issue.status);

    const wantsTriage =
      req.body.status !== undefined ||
      req.body.priority !== undefined ||
      req.body.assignee_user_id !== undefined;
    const wantsContent = req.body.title !== undefined || req.body.body !== undefined;

    if (wantsTriage && !canManage) {
      return res.status(403).json({ error: 'Only owner or maintainer can manage issue status, priority, or assignment.' });
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

    if (req.body.status !== undefined) {
      const status = asTrimmedString(req.body.status);
      if (!isAllowedValue(status, ISSUE_STATUSES)) {
        return res.status(400).json({ error: 'Invalid issue status.' });
      }
      updates.status = status;
    }

    if (req.body.priority !== undefined) {
      const priority = asTrimmedString(req.body.priority);
      if (!isAllowedValue(priority, ISSUE_PRIORITIES)) {
        return res.status(400).json({ error: 'Invalid issue priority.' });
      }
      updates.priority = priority;
    }

    if (req.body.assignee_user_id !== undefined) {
      const assigneeUserId = asTrimmedString(req.body.assignee_user_id);

      if (!assigneeUserId) {
        updates.assignee_user_id = null;
      } else {
        const assigneeMembership = await ProjectSpaceMember.findOne({
          where: { space_id: spaceId, user_id: assigneeUserId },
          attributes: ['id'],
        });

        if (!assigneeMembership) {
          return res.status(400).json({ error: 'Assignee must be a current contributor in this space.' });
        }

        updates.assignee_user_id = assigneeUserId;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid issue fields were provided.' });
    }

    updates.updated_at = new Date();
    await issue.update(updates);

    const hydratedIssue = await loadIssue(spaceId, issue.id);
    return res.json({ issue: hydratedIssue });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update issue.' });
  }
}

module.exports = {
  listIssues,
  getIssue,
  createIssue,
  updateIssue,
};
