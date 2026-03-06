const {
  ProjectSpace,
  ProjectSpaceMember,
  User,
} = require('../../models');

async function getSpaceOr404(spaceId, res) {
  const space = await ProjectSpace.findByPk(spaceId);
  if (!space) {
    res.status(404).json({ error: 'Project space not found.' });
    return null;
  }
  return space;
}

async function getMembership(spaceId, userId) {
  return ProjectSpaceMember.findOne({
    where: { space_id: spaceId, user_id: userId },
  });
}

async function ensureUserExists(userId) {
  return User.findByPk(userId);
}

function isOwner(space, userId) {
  return Boolean(space && space.owner_id === userId);
}

function isMaintainerOrOwner(membership) {
  return Boolean(membership && (membership.role === 'owner' || membership.role === 'maintainer'));
}

function isMember(membership) {
  return Boolean(membership);
}

async function ensureSpaceReadable(spaceId, userId, res) {
  const space = await getSpaceOr404(spaceId, res);
  if (!space) return null;

  if (space.visibility === 'public') {
    return space;
  }

  if (!userId) {
    res.status(403).json({ error: 'This project space is private.' });
    return null;
  }

  if (space.owner_id === userId) {
    return space;
  }

  const membership = await getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: 'You do not have access to this private project space.' });
    return null;
  }

  return space;
}

module.exports = {
  getSpaceOr404,
  getMembership,
  ensureUserExists,
  isOwner,
  isMaintainerOrOwner,
  isMember,
  ensureSpaceReadable,
};
