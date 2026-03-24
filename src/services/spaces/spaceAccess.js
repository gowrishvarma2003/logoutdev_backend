const {
  ProjectSpace,
  ProjectSpaceMember,
  User,
} = require('../../models');

const PUBLIC_SPACE_DISCUSSION_CATEGORIES = ['idea', 'question'];
const CONTRIBUTOR_DISCUSSION_CATEGORIES = ['idea', 'decision', 'question', 'blocked', 'retrospective'];
const MAINTAINER_DISCUSSION_CATEGORIES = [...CONTRIBUTOR_DISCUSSION_CATEGORIES, 'announcement'];

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

function getAllowedDiscussionCategories(space, membership, userId) {
  if (!space || !userId) return [];
  if (isOwner(space, userId) || isMaintainerOrOwner(membership)) {
    return MAINTAINER_DISCUSSION_CATEGORIES;
  }
  if (isMember(membership)) {
    return CONTRIBUTOR_DISCUSSION_CATEGORIES;
  }
  if (space.visibility === 'public') {
    return PUBLIC_SPACE_DISCUSSION_CATEGORIES;
  }
  return [];
}

function buildSpaceViewerPermissions(space, membership, userId) {
  const canRead = Boolean(
    space
    && (
      space.visibility === 'public'
      || isOwner(space, userId)
      || isMember(membership)
    )
  );
  const allowedDiscussionCategories = canRead
    ? getAllowedDiscussionCategories(space, membership, userId)
    : [];
  const canManageDiscussions = Boolean(space && (isOwner(space, userId) || isMaintainerOrOwner(membership)));

  return {
    can_read: canRead,
    can_reply: allowedDiscussionCategories.length > 0,
    can_create_discussion: allowedDiscussionCategories.length > 0,
    allowed_discussion_categories: allowedDiscussionCategories,
    can_manage_discussions: canManageDiscussions,
  };
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
  getAllowedDiscussionCategories,
  buildSpaceViewerPermissions,
  ensureSpaceReadable,
};
