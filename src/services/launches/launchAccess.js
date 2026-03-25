const { Op } = require('sequelize');
const {
  Launch,
  LaunchBetaRegistration,
  LaunchFeedbackComment,
  LaunchUpvote,
  LaunchReview,
  ProjectSpace,
  ProjectSpaceJoinRequest,
  ProjectSpaceMember,
  User,
} = require('../../models');
const { buildBetaSummary } = require('./launchPhase');

function isMissingLaunchBetaRegistrationTable(error) {
  return error?.original?.code === '42P01'
    || error?.parent?.code === '42P01'
    || error?.message?.includes('launch_beta_registrations');
}

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
    beta_registration_status: null,
    can_request_beta: false,
    can_access_beta: false,
    can_moderate_beta: false,
    is_early_supporter: false,
    can_submit_feedback: false,
    can_submit_review: false,
  };

  if (!userId) {
    return viewerState;
  }

  if (viewerState.is_owner) {
    viewerState.can_edit = true;
    viewerState.can_publish = launch.status !== 'published';
    viewerState.can_moderate_beta = launch.status === 'published' && launch.launch_phase === 'beta';
    viewerState.can_access_beta = launch.launch_phase === 'beta' && launch.status === 'published';
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

  let registration = null;
  try {
    registration = await LaunchBetaRegistration.findOne({
      where: { launch_id: launch.id, user_id: userId },
      attributes: ['id', 'status'],
    });
  } catch (error) {
    if (!isMissingLaunchBetaRegistrationTable(error)) {
      throw error;
    }
  }

  viewerState.is_upvoted_by_me = Boolean(upvote);
  viewerState.my_review_id = review?.id || null;
  viewerState.beta_registration_status = registration?.status || null;
  viewerState.can_access_beta = launch.status === 'published'
    && launch.launch_phase === 'beta'
    && registration?.status === 'approved';
  viewerState.can_request_beta = launch.status === 'published'
    && launch.launch_phase === 'beta'
    && !['pending', 'approved'].includes(registration?.status || '');
  viewerState.is_early_supporter = launch.launch_phase === 'live' && registration?.status === 'approved';
  viewerState.can_submit_feedback = launch.status === 'published'
    && launch.launch_phase === 'live'
    && !viewerState.is_owner;
  viewerState.can_submit_review = launch.status === 'published'
    && launch.launch_phase === 'live'
    && !viewerState.is_owner;

  if (launch.launch_phase === 'beta') {
    viewerState.can_submit_feedback = launch.status === 'published' && registration?.status === 'approved';
    viewerState.can_submit_review = false;
  }

  viewerState.can_request_collaboration = Boolean(
    launch.status === 'published'
      && launch.collaboration_mode === 'looking'
      && launch.linked_space_id
      && !membership
      && !pendingJoin
  );

  return viewerState;
}

async function getLaunchBetaSummary(launchId, capacity = null) {
  let registrations = [];
  try {
    registrations = await LaunchBetaRegistration.findAll({
      where: { launch_id: launchId },
      attributes: ['status'],
    });
  } catch (error) {
    if (!isMissingLaunchBetaRegistrationTable(error)) {
      throw error;
    }
  }

  const approvedCount = registrations.filter((registration) => registration.status === 'approved').length;
  const pendingCount = registrations.filter((registration) => registration.status === 'pending').length;

  return buildBetaSummary({
    capacity,
    approvedCount,
    pendingCount,
  });
}

async function getLaunchEarlySupporters(launchId, limit = 6) {
  let approved = [];
  try {
    approved = await LaunchBetaRegistration.findAll({
      where: { launch_id: launchId, status: 'approved' },
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'username', 'headline'],
        required: false,
      }],
      order: [['reviewed_at', 'ASC'], ['created_at', 'ASC']],
    });
  } catch (error) {
    if (!isMissingLaunchBetaRegistrationTable(error)) {
      throw error;
    }
  }

  return {
    total: approved.length,
    users: approved.slice(0, limit).map((registration) => ({
      id: registration.user?.id || registration.user_id,
      name: registration.user?.name || 'Supporter',
      username: registration.user?.username || null,
      headline: registration.user?.headline || null,
      joined_at: registration.reviewed_at || registration.created_at,
    })),
  };
}

async function canViewerSeePrivateBetaFeedback(feedbackItem, userId) {
  if (!feedbackItem || !userId) return false;
  if (feedbackItem.author_id === userId) return true;

  const commentCount = await LaunchFeedbackComment.count({
    where: {
      feedback_id: feedbackItem.id,
      author_id: userId,
    },
  });

  return commentCount > 0;
}

module.exports = {
  getLaunchOr404,
  isLaunchOwner,
  getLinkedSpaceMembership,
  canUserLinkSpace,
  buildLinkedSpaceSummary,
  buildLaunchViewerState,
  getLaunchBetaSummary,
  getLaunchEarlySupporters,
  canViewerSeePrivateBetaFeedback,
};
