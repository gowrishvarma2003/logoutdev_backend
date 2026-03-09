const { Op } = require('sequelize');
const {
  Follow,
  FreelanceProject,
  FreelanceProjectSkill,
  FreelanceProposal,
  Launch,
  LaunchReview,
  LaunchTechStack,
  Post,
  ProjectSpace,
  ProjectSpaceDiscussion,
  ProjectSpaceMember,
  ProjectSpaceStack,
  ProjectSpaceUpdate,
  Question,
  QuestionTag,
  UserProfileSkill,
} = require('../../models');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSignalsBand(score) {
  if (score >= 70) return 'Strong';
  if (score >= 40) return 'Growing';
  return 'Early';
}

function countValues(values = []) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => {
    const key = String(value).trim().toLowerCase();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function mapTopTags(countMap, limit = 6) {
  return [...countMap.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

async function getUserProfileMetrics(userId) {
  const periodStart = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));

  const [
    followers,
    following,
    postsCount,
    postsRecent,
    ownedSpaces,
    memberships,
    discussionsCount,
    discussionsRecent,
    updatesCount,
    updatesRecent,
    publishedLaunches,
    recentPublishedLaunches,
    lookingLaunches,
    launchReviewRows,
    clientProjects,
    recentClientProjects,
    wonProposals,
    recentWonProposals,
    profileSkills,
    launchStacks,
    spaceStacks,
    questionTags,
    freelanceSkills,
  ] = await Promise.all([
    Follow.count({ where: { following_id: userId } }),
    Follow.count({ where: { follower_id: userId } }),
    Post.count({ where: { user_id: userId, reply_to_id: null } }),
    Post.count({ where: { user_id: userId, created_at: { [Op.gte]: periodStart } } }),
    ProjectSpace.count({ where: { owner_id: userId } }),
    ProjectSpaceMember.count({ where: { user_id: userId }, distinct: true, col: 'space_id' }),
    ProjectSpaceDiscussion.count({ where: { author_id: userId } }),
    ProjectSpaceDiscussion.count({ where: { author_id: userId, created_at: { [Op.gte]: periodStart } } }),
    ProjectSpaceUpdate.count({ where: { author_id: userId } }),
    ProjectSpaceUpdate.count({ where: { author_id: userId, created_at: { [Op.gte]: periodStart } } }),
    Launch.findAll({
      where: { builder_id: userId, status: 'published' },
      attributes: ['id', 'name', 'published_at', 'created_at', 'collaboration_mode'],
      order: [['published_at', 'DESC'], ['created_at', 'DESC']],
    }),
    Launch.count({
      where: {
        builder_id: userId,
        status: 'published',
        published_at: { [Op.gte]: periodStart },
      },
    }),
    Launch.count({
      where: { builder_id: userId, status: 'published', collaboration_mode: 'looking' },
    }),
    LaunchReview.findAll({
      include: [{
        model: Launch,
        as: 'launch',
        where: { builder_id: userId, status: 'published' },
        attributes: ['id', 'name'],
        required: true,
      }],
      attributes: ['id', 'launch_id', 'created_at'],
      order: [['created_at', 'DESC']],
    }),
    FreelanceProject.findAll({
      where: { client_id: userId },
      attributes: ['id', 'title', 'status', 'linked_space_id', 'created_at', 'updated_at'],
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    }),
    FreelanceProject.count({
      where: { client_id: userId, created_at: { [Op.gte]: periodStart } },
    }),
    FreelanceProposal.findAll({
      where: { freelancer_id: userId, status: 'accepted' },
      include: [{
        model: FreelanceProject,
        as: 'project',
        attributes: ['id', 'title', 'status', 'linked_space_id', 'created_at', 'updated_at'],
        required: true,
      }],
      attributes: ['id', 'project_id', 'created_at', 'reviewed_at', 'updated_at'],
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    }),
    FreelanceProposal.count({
      where: {
        freelancer_id: userId,
        status: 'accepted',
        updated_at: { [Op.gte]: periodStart },
      },
    }),
    UserProfileSkill.findAll({
      where: { user_id: userId },
      attributes: ['id', 'skill', 'rank'],
      order: [['rank', 'ASC'], ['created_at', 'ASC']],
    }),
    Launch.findAll({
      where: { builder_id: userId, status: 'published' },
      attributes: ['id'],
      include: [{
        model: LaunchTechStack,
        as: 'tech_stack',
        attributes: ['technology'],
        required: false,
      }],
    }),
    ProjectSpace.findAll({
      where: { owner_id: userId },
      attributes: ['id'],
      include: [{
        model: ProjectSpaceStack,
        as: 'stack',
        attributes: ['technology'],
        required: false,
      }],
    }),
    Question.findAll({
      where: { author_id: userId },
      attributes: ['id'],
      include: [{
        model: QuestionTag,
        as: 'tags',
        attributes: ['tag', 'slug'],
        required: false,
      }],
    }),
    FreelanceProject.findAll({
      where: { client_id: userId },
      attributes: ['id'],
      include: [{
        model: FreelanceProjectSkill,
        as: 'skills',
        attributes: ['skill'],
        required: false,
      }],
    }),
  ]);

  const launchesPublishedCount = publishedLaunches.length;
  const launchReviewsReceivedCount = launchReviewRows.length;
  const freelanceProjectsPostedCount = clientProjects.length;
  const freelanceWinsCount = wonProposals.length;
  const workspacesFromFreelanceCount = [
    ...clientProjects.filter((project) => project.linked_space_id),
    ...wonProposals.filter((proposal) => proposal.project?.linked_space_id),
  ].length;
  const acceptedCollaborationCount = Math.max(0, memberships - ownedSpaces);

  const skillCounts = countValues([
    ...profileSkills.map((skill) => skill.skill),
    ...launchStacks.flatMap((launch) => (launch.tech_stack || []).map((entry) => entry.technology)),
    ...spaceStacks.flatMap((space) => (space.stack || []).map((entry) => entry.technology)),
    ...questionTags.flatMap((question) => (question.tags || []).map((tag) => tag.slug || tag.tag)),
    ...freelanceSkills.flatMap((project) => (project.skills || []).map((skill) => skill.skill)),
  ]);
  const fitClusters = mapTopTags(skillCounts, 6);

  const shippingBehavior = clamp(
    (launchesPublishedCount * 8) + (updatesRecent * 3) + (recentWonProposals * 6),
    0,
    25
  );
  const reviewQuality = clamp(launchReviewsReceivedCount * 4, 0, 20);
  const collaborationConversion = clamp(
    (acceptedCollaborationCount * 5) + (lookingLaunches * 4) + (workspacesFromFreelanceCount * 5),
    0,
    20
  );
  const freelanceOutcomes = clamp(
    (freelanceWinsCount * 6) + (freelanceProjectsPostedCount * 3),
    0,
    20
  );
  const platformConsistency = clamp(
    (postsRecent * 2) + (discussionsRecent * 3) + (updatesRecent * 3) + (recentPublishedLaunches * 4) + (recentClientProjects * 2),
    0,
    15
  );

  const score = shippingBehavior + reviewQuality + collaborationConversion + freelanceOutcomes + platformConsistency;

  const timeline = [
    ...publishedLaunches.slice(0, 4).map((launch) => ({
      type: 'launch',
      title: `Published ${launch.name}`,
      href: `/launches/${launch.id}`,
      created_at: launch.published_at || launch.created_at,
    })),
    ...wonProposals.slice(0, 4).map((proposal) => ({
      type: 'freelance_win',
      title: `Won ${proposal.project?.title || 'a freelance project'}`,
      href: proposal.project ? `/freelance/${proposal.project.id}` : null,
      created_at: proposal.reviewed_at || proposal.updated_at || proposal.created_at,
    })),
    ...clientProjects.filter((project) => ['awarded', 'completed'].includes(project.status)).slice(0, 3).map((project) => ({
      type: 'freelance_client',
      title: `${project.status === 'completed' ? 'Completed' : 'Awarded'} ${project.title}`,
      href: `/freelance/${project.id}`,
      created_at: project.updated_at || project.created_at,
    })),
  ]
    .filter((item) => item.created_at)
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, 8);

  return {
    stats: {
      followers,
      following,
      posts_count: postsCount,
      projects_created_count: ownedSpaces,
      projects_contributed_count: memberships,
      discussions_started_count: discussionsCount,
      updates_posted_count: updatesCount,
      launches_published_count: launchesPublishedCount,
      launch_reviews_received_count: launchReviewsReceivedCount,
      freelance_projects_posted_count: freelanceProjectsPostedCount,
      freelance_wins_count: freelanceWinsCount,
      workspaces_from_freelance_count: workspacesFromFreelanceCount,
      accepted_collaborations_count: acceptedCollaborationCount,
    },
    signals: {
      score,
      band: getSignalsBand(score),
      factors: {
        shipping_behavior: shippingBehavior,
        review_quality: reviewQuality,
        collaboration_conversion: collaborationConversion,
        freelance_outcomes: freelanceOutcomes,
        platform_consistency: platformConsistency,
      },
    },
    fit_clusters: fitClusters,
    open_to_collaborate: lookingLaunches > 0,
    strongest_stacks: fitClusters.slice(0, 4),
    timeline,
    launches: publishedLaunches,
    client_projects: clientProjects,
    freelance_wins: wonProposals,
    profile_skills: profileSkills,
  };
}

module.exports = {
  getSignalsBand,
  getUserProfileMetrics,
};
