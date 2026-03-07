const { ProjectSpaceMember, ProjectSpaceRepo, ProjectSpaceRepoMember, User } = require('../../models');
const {
  getSpaceOr404,
  ensureSpaceReadable,
  getMembership,
  ensureUserExists,
  isOwner,
} = require('../../services/spaces/spaceAccess');
const {
  MEMBER_ROLES,
  asTrimmedString,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');

async function getContributors(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!readableSpace) return;

    const contributors = await ProjectSpaceMember.findAll({
      where: { space_id: req.params.spaceId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['joined_at', 'ASC']],
    });

    return res.json({ contributors });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch contributors.' });
  }
}

async function updateContributorRole(req, res) {
  try {
    const actorId = req.user.userId;
    const { spaceId, userId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    if (!isOwner(space, actorId)) {
      return res.status(403).json({ error: 'Only owner can change contributor roles.' });
    }

    if (space.owner_id === userId) {
      return res.status(400).json({ error: 'Owner role cannot be changed via this endpoint.' });
    }

    const role = asTrimmedString(req.body.role);
    if (!isAllowedValue(role, MEMBER_ROLES) || role === 'owner') {
      return res.status(400).json({ error: 'Role must be maintainer or contributor.' });
    }

    const membership = await getMembership(spaceId, userId);
    if (!membership) {
      const targetUser = await ensureUserExists(userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found.' });
      }

      const created = await ProjectSpaceMember.create({
        space_id: spaceId,
        user_id: userId,
        role,
      });

      return res.json({ contributor: created });
    }

    await membership.update({ role });
    return res.json({ contributor: membership });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update contributor role.' });
  }
}

async function removeContributor(req, res) {
  try {
    const actorId = req.user.userId;
    const { spaceId, userId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    if (!isOwner(space, actorId)) {
      return res.status(403).json({ error: 'Only owner can remove contributors.' });
    }

    if (space.owner_id === userId) {
      return res.status(400).json({ error: 'Owner cannot be removed from the project.' });
    }

    await ProjectSpaceMember.destroy({
      where: { space_id: spaceId, user_id: userId },
    });

    const repos = await ProjectSpaceRepo.findAll({
      where: { space_id: spaceId },
      attributes: ['id'],
    });
    const repoIds = repos.map((repo) => repo.id);
    if (repoIds.length > 0) {
      await ProjectSpaceRepoMember.destroy({
        where: {
          repo_id: repoIds,
          user_id: userId,
        },
      });
    }

    return res.json({ removed: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to remove contributor.' });
  }
}

module.exports = {
  getContributors,
  updateContributorRole,
  removeContributor,
};
