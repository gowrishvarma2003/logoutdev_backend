const { ProjectSpaceUpdate, ProjectSpaceRepo, ProjectSpaceIssue, User } = require('../../models');
const {
  getSpaceOr404,
  ensureSpaceReadable,
  getMembership,
  isMember,
  isMaintainerOrOwner,
} = require('../../services/spaces/spaceAccess');
const {
  UPDATE_TYPES,
  asTrimmedString,
  normalizeHttpLinks,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');
const { parsePagination } = require('../../services/spaces/pagination');
const { logWorkActivity } = require('../../services/spaces/workActivity');

const UPDATE_INCLUDE = [
  { model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] },
  { model: ProjectSpaceRepo, as: 'repo', attributes: ['id', 'name', 'slug', 'visibility'], required: false },
  { model: ProjectSpaceIssue, as: 'work_item', attributes: ['id', 'title', 'status'], required: false },
];

async function loadUpdate(spaceId, updateId) {
  return ProjectSpaceUpdate.findOne({
    where: { id: updateId, space_id: spaceId },
    include: UPDATE_INCLUDE,
  });
}

async function createUpdate(req, res) {
  try {
    const userId = req.user.userId;
    const spaceId = req.params.spaceId;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMember(membership)) {
      return res.status(403).json({ error: 'Only project contributors can post updates.' });
    }

    const type = asTrimmedString(req.body.type || 'devlog');
    const title = asTrimmedString(req.body.title);
    const content = asTrimmedString(req.body.content);
    const whatShipped = asTrimmedString(req.body.what_shipped) || null;
    const nextUp = asTrimmedString(req.body.next_up) || null;
    const blockers = asTrimmedString(req.body.blockers) || null;
    const evidenceLinks = normalizeHttpLinks(req.body.evidence_links, 20);
    const repoId = asTrimmedString(req.body.repo_id || '') || null;
    const workItemId = asTrimmedString(req.body.work_item_id || '') || null;

    if (!isAllowedValue(type, UPDATE_TYPES)) {
      return res.status(400).json({ error: 'Invalid update type.' });
    }

    if (title.length < 5) {
      return res.status(400).json({ error: 'Update title must be at least 5 characters.' });
    }

    if (content.length < 10) {
      return res.status(400).json({ error: 'Update content must be at least 10 characters.' });
    }

    if (repoId) {
      const repo = await ProjectSpaceRepo.findOne({
        where: { id: repoId, space_id: spaceId, archived_at: null },
        attributes: ['id'],
      });
      if (!repo) {
        return res.status(400).json({ error: 'Linked repository must belong to this space.' });
      }
    }

    if (workItemId) {
      const workItem = await ProjectSpaceIssue.findOne({
        where: { id: workItemId, space_id: spaceId },
        attributes: ['id'],
      });
      if (!workItem) {
        return res.status(400).json({ error: 'Linked work item must belong to this space.' });
      }
    }

    const update = await ProjectSpaceUpdate.create({
      space_id: spaceId,
      author_id: userId,
      type,
      title,
      content,
      what_shipped: whatShipped,
      next_up: nextUp,
      blockers,
      repo_id: repoId,
      work_item_id: workItemId,
      evidence_links: evidenceLinks,
    });

    if (workItemId) {
      await logWorkActivity({
        spaceId,
        issueId: workItemId,
        actorUserId: userId,
        eventType: 'progress_update_added',
        payload: {
          update_id: update.id,
          title,
          type,
        },
        createdAt: update.created_at,
      });
    }

    const hydrated = await loadUpdate(spaceId, update.id);
    return res.status(201).json({ update: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create progress update.' });
  }
}

async function listUpdates(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!readableSpace) return;

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const workItemId = asTrimmedString(req.query.work_item_id || '') || null;

    const where = { space_id: req.params.spaceId };
    if (workItemId) {
      where.work_item_id = workItemId;
    }

    const { count, rows: updates } = await ProjectSpaceUpdate.findAndCountAll({
      where,
      include: UPDATE_INCLUDE,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return res.json({ updates, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch updates.' });
  }
}

async function updateUpdate(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, updateId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMember(membership)) {
      return res.status(403).json({ error: 'Only project contributors can edit updates.' });
    }

    const updateRecord = await ProjectSpaceUpdate.findOne({
      where: { id: updateId, space_id: spaceId },
    });

    if (!updateRecord) {
      return res.status(404).json({ error: 'Update not found.' });
    }

    const canEdit = updateRecord.author_id === userId || isMaintainerOrOwner(membership);
    if (!canEdit) {
      return res.status(403).json({ error: 'Only the author, owner, or maintainer can edit this update.' });
    }

    const updates = {};

    if (req.body.type !== undefined) {
      const type = asTrimmedString(req.body.type);
      if (!isAllowedValue(type, UPDATE_TYPES)) {
        return res.status(400).json({ error: 'Invalid update type.' });
      }
      updates.type = type;
    }

    if (req.body.title !== undefined) {
      const title = asTrimmedString(req.body.title);
      if (title.length < 5) {
        return res.status(400).json({ error: 'Update title must be at least 5 characters.' });
      }
      updates.title = title;
    }

    if (req.body.content !== undefined) {
      const content = asTrimmedString(req.body.content);
      if (content.length < 10) {
        return res.status(400).json({ error: 'Update content must be at least 10 characters.' });
      }
      updates.content = content;
    }

    if (req.body.what_shipped !== undefined) {
      updates.what_shipped = asTrimmedString(req.body.what_shipped) || null;
    }

    if (req.body.next_up !== undefined) {
      updates.next_up = asTrimmedString(req.body.next_up) || null;
    }

    if (req.body.blockers !== undefined) {
      updates.blockers = asTrimmedString(req.body.blockers) || null;
    }

    if (req.body.repo_id !== undefined) {
      const repoId = asTrimmedString(req.body.repo_id);
      if (!repoId) {
        updates.repo_id = null;
      } else {
        const repo = await ProjectSpaceRepo.findOne({
          where: { id: repoId, space_id: spaceId, archived_at: null },
          attributes: ['id'],
        });
        if (!repo) {
          return res.status(400).json({ error: 'Linked repository must belong to this space.' });
        }
        updates.repo_id = repoId;
      }
    }

    if (req.body.work_item_id !== undefined) {
      const workItemId = asTrimmedString(req.body.work_item_id);
      if (!workItemId) {
        updates.work_item_id = null;
      } else {
        const workItem = await ProjectSpaceIssue.findOne({
          where: { id: workItemId, space_id: spaceId },
          attributes: ['id'],
        });
        if (!workItem) {
          return res.status(400).json({ error: 'Linked work item must belong to this space.' });
        }
        updates.work_item_id = workItemId;
      }
    }

    if (req.body.evidence_links !== undefined) {
      updates.evidence_links = normalizeHttpLinks(req.body.evidence_links, 20);
    }

    updates.updated_at = new Date();
    await updateRecord.update(updates);

    const linkedWorkItemId = updates.work_item_id !== undefined ? updates.work_item_id : updateRecord.work_item_id;
    if (linkedWorkItemId) {
      await logWorkActivity({
        spaceId,
        issueId: linkedWorkItemId,
        actorUserId: userId,
        eventType: 'progress_update_updated',
        payload: {
          update_id: updateRecord.id,
          title: updates.title || updateRecord.title,
          type: updates.type || updateRecord.type,
        },
      });
    }

    const hydrated = await loadUpdate(spaceId, updateRecord.id);
    return res.json({ update: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update progress update.' });
  }
}

async function deleteUpdate(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, updateId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMember(membership)) {
      return res.status(403).json({ error: 'Only project contributors can delete updates.' });
    }

    const updateRecord = await ProjectSpaceUpdate.findOne({
      where: { id: updateId, space_id: spaceId },
    });

    if (!updateRecord) {
      return res.status(404).json({ error: 'Update not found.' });
    }

    const canDelete = updateRecord.author_id === userId || isMaintainerOrOwner(membership);
    if (!canDelete) {
      return res.status(403).json({ error: 'Only the author, owner, or maintainer can delete this update.' });
    }

    await ProjectSpaceUpdate.destroy({ where: { id: updateId, space_id: spaceId } });

    return res.json({ deleted: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete update.' });
  }
}

module.exports = {
  createUpdate,
  listUpdates,
  updateUpdate,
  deleteUpdate,
};
