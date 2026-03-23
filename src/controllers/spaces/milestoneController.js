const {
  ProjectSpaceMilestone,
  User,
} = require('../../models');
const {
  ensureSpaceReadable,
  getMembership,
  getSpaceOr404,
  isMaintainerOrOwner,
} = require('../../services/spaces/spaceAccess');
const { asTrimmedString } = require('../../services/spaces/spaceValidation');

const MILESTONE_STATUSES = new Set(['planned', 'active', 'completed', 'archived']);

async function listMilestones(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const { spaceId } = req.params;

    const readableSpace = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!readableSpace) return;

    const milestones = await ProjectSpaceMilestone.findAll({
      where: { space_id: spaceId },
      include: [{ model: User, as: 'creator', attributes: ['id', 'name', 'email', 'username'] }],
      order: [['position', 'ASC'], ['target_date', 'ASC'], ['created_at', 'ASC']],
    });

    return res.json({ milestones });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch milestones.' });
  }
}

async function createMilestone(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!(space.owner_id === userId || isMaintainerOrOwner(membership))) {
      return res.status(403).json({ error: 'Only owner or maintainer can create milestones.' });
    }

    const title = asTrimmedString(req.body.title);
    const description = asTrimmedString(req.body.description) || null;
    const status = asTrimmedString(req.body.status || 'planned') || 'planned';
    const targetDate = asTrimmedString(req.body.target_date || '') || null;

    if (title.length < 3 || title.length > 180) {
      return res.status(400).json({ error: 'Milestone title must be between 3 and 180 characters.' });
    }

    if (!MILESTONE_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid milestone status.' });
    }

    const position = await ProjectSpaceMilestone.count({ where: { space_id: spaceId } });

    const milestone = await ProjectSpaceMilestone.create({
      space_id: spaceId,
      created_by: userId,
      title,
      description,
      status,
      target_date: targetDate,
      position,
      updated_at: new Date(),
    });

    const hydrated = await ProjectSpaceMilestone.findByPk(milestone.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'name', 'email', 'username'] }],
    });

    return res.status(201).json({ milestone: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create milestone.' });
  }
}

async function updateMilestone(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, milestoneId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!(space.owner_id === userId || isMaintainerOrOwner(membership))) {
      return res.status(403).json({ error: 'Only owner or maintainer can update milestones.' });
    }

    const milestone = await ProjectSpaceMilestone.findOne({
      where: { id: milestoneId, space_id: spaceId },
    });
    if (!milestone) {
      return res.status(404).json({ error: 'Milestone not found.' });
    }

    const updates = {};

    if (req.body.title !== undefined) {
      const title = asTrimmedString(req.body.title);
      if (title.length < 3 || title.length > 180) {
        return res.status(400).json({ error: 'Milestone title must be between 3 and 180 characters.' });
      }
      updates.title = title;
    }

    if (req.body.description !== undefined) {
      updates.description = asTrimmedString(req.body.description) || null;
    }

    if (req.body.status !== undefined) {
      const status = asTrimmedString(req.body.status);
      if (!MILESTONE_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Invalid milestone status.' });
      }
      updates.status = status;
    }

    if (req.body.target_date !== undefined) {
      updates.target_date = asTrimmedString(req.body.target_date) || null;
    }

    if (req.body.position !== undefined) {
      const position = Number.parseInt(req.body.position, 10);
      if (Number.isNaN(position) || position < 0) {
        return res.status(400).json({ error: 'Milestone position must be a positive integer.' });
      }
      updates.position = position;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid milestone fields were provided.' });
    }

    updates.updated_at = new Date();
    await milestone.update(updates);

    const hydrated = await ProjectSpaceMilestone.findByPk(milestone.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'name', 'email', 'username'] }],
    });

    return res.json({ milestone: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update milestone.' });
  }
}

module.exports = {
  listMilestones,
  createMilestone,
  updateMilestone,
};
