const { Op } = require('sequelize');
const {
  Launch,
  LaunchUpvote,
  LaunchReview,
  ProjectSpace,
  ProjectSpaceJoinRequest,
  ProjectSpaceMember,
} = require('../../models');

async function getLaunchOr404(launchId, res, extra = {}) {
  const launch = await Launch.findByPk(launchId, extra);
  if (!launch) {
    res.status(404).json({ error: 'Launch not found.' });
    return null;
  }
  return launch;
}

function isLaunchOwner(launch, userId) {
  return Boolean(launch && userId && launch.builder_id === userId);
}

async function getLinkedSpaceMembership(spaceId, userId) {
  if (!spaceId || !userId) return null;
  return ProjectSpaceMember.findOne({ where: { space_id: spaceId, user_id: userId } });
}

async function canUserLinkSpace(spaceId, userId) {
  if (!spaceId || !userId) return false;

  const space = await ProjectSpace.findByPk(spaceId, { attributes: ['id', 'owner_id'] });
  if (!space) return false;
  if (space.owner_id === userId) return true;

  const membership = await getLinkedSpaceMembership(spaceId, userId);
  return Boolean(membership && ['owner', 'maintainer'].includes(membership.role));
}

function buildLinkedSpaceSummary(space) {
  if (!space) return null;
  if (space.visibility === 'private') {
    return {
      id: space.id,
      visibility: space.visibility,
      status: space.status,
      name: null,
      slug: null,
    };
  }

  return {
    id: space.id,
    name: space.name,
    slug: space.slug,
    visibility: space.visibility,
    status: space.status,
  };
}

async function buildLaunchViewerState(launch, userId) {
  const viewerState = {
    is_owner: isLaunchOwner(launch, userId),
    is_upvoted_by_me: false,
    my_review_id: null,
    can_request_collaboration: false,
    can_edit: false,
    can_publish: false,
  };

  if (!userId) {
    return viewerState;
  }

  if (viewerState.is_owner) {
    viewerState.can_edit = true;
    viewerState.can_publish = launch.status !== 'published';
    return viewerState;
  }

  const [upvote, review, membership, pendingJoin] = await Promise.all([
    LaunchUpvote.findOne({ where: { launch_id: launch.id, user_id: userId }, attributes: ['id'] }),
    LaunchReview.findOne({ where: { launch_id: launch.id, author_id: userId }, attributes: ['id'] }),
    launch.linked_space_id ? ProjectSpaceMember.findOne({ where: { space_id: launch.linked_space_id, user_id: userId }, attributes: ['id'] }) : null,
    launch.linked_space_id
      ? ProjectSpaceJoinRequest.findOne({
          where: {
            space_id: launch.linked_space_id,
            user_id: userId,
            status: { [Op.in]: ['pending', 'need-info'] },
          },
          attributes: ['id'],
        })
      : null,
  ]);

  viewerState.is_upvoted_by_me = Boolean(upvote);
  viewerState.my_review_id = review?.id || null;
  viewerState.can_request_collaboration = Boolean(
    launch.status === 'published'
      && launch.collaboration_mode === 'looking'
      && launch.linked_space_id
      && !membership
      && !pendingJoin
  );

  return viewerState;
}

module.exports = {
  getLaunchOr404,
  isLaunchOwner,
  getLinkedSpaceMembership,
  canUserLinkSpace,
  buildLinkedSpaceSummary,
  buildLaunchViewerState,
};