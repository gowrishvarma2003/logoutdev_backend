const { Op } = require('sequelize');
const {
  FreelanceProject,
  FreelanceProjectSkill,
  Launch,
  LaunchTechStack,
  Post,
  ProjectSpace,
  ProjectSpaceStack,
  ProjectSpaceUpdate,
  Question,
  QuestionTag,
  User,
  UserProfileSkill,
} = require('../../models');
const { buildEntityRef } = require('../notifications/notificationService');
const { getUserProfileMetrics } = require('../profiles/profileMetrics');
const { getMembership } = require('../spaces/spaceAccess');

const LINKED_ENTITY_TYPES = ['launch', 'space', 'question', 'freelance_project'];

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()))];
}

function tagWhere(field, tags = []) {
  if (!tags.length) return undefined;
  return {
    [Op.or]: tags.map((tag) => ({ [field]: { [Op.iLike]: `%${tag}%` } })),
  };
}

async function canViewSpace(space, viewerId) {
  if (!space) return false;
  if (space.visibility === 'public') return true;
  if (!viewerId) return false;
  if (space.owner_id === viewerId) return true;
  const membership = await getMembership(space.id, viewerId);
  return Boolean(membership);
}

function withReason(entity, reason) {
  return entity ? { ...entity, reason } : null;
}

function buildNextStep({ title, description, href, auth_required = false, priority = 50 }) {
  return { title, description, href, auth_required, priority };
}

async function buildTrustContext(userId, label = 'Builder') {
  if (!userId) return null;
  const user = await User.findByPk(userId, {
    attributes: ['id', 'name', 'username', 'headline'],
    include: [{
      model: UserProfileSkill,
      as: 'profile_skills',
      attributes: ['skill'],
      required: false,
    }],
  });
  if (!user) return null;

  const metrics = await getUserProfileMetrics(userId);

  return {
    label,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      headline: user.headline,
      href: `/profile/${user.username || user.id}`,
    },
    proof_score: metrics.signals.score,
    proof_band: metrics.signals.band,
    open_to_collaborate: metrics.open_to_collaborate,
    strongest_stacks: metrics.strongest_stacks,
    primary_stats: [
      `${metrics.stats.launches_published_count} launches`,
      `${metrics.stats.projects_created_count + metrics.stats.projects_contributed_count} spaces`,
      `${metrics.stats.freelance_wins_count} wins`,
    ],
    secondary_stats: [
      `${metrics.stats.launch_reviews_received_count} reviews`,
      `${metrics.stats.accepted_collaborations_count} collaborations`,
    ],
  };
}

async function resolveLinkedEntity(type, id, viewerId = null) {
  if (!LINKED_ENTITY_TYPES.includes(type) || !id) return null;

  if (type === 'launch') {
    const launch = await Launch.findByPk(id, {
      include: [{ model: LaunchTechStack, as: 'tech_stack', attributes: ['technology'], required: false }],
    });
    if (!launch) return null;
    if (launch.status !== 'published' && launch.builder_id !== viewerId) return null;
    return buildEntityRef({
      type,
      id: launch.id,
      title: launch.name,
      subtitle: launch.tagline,
      href: `/launches/${launch.id}`,
      visibility: 'public',
      tags: (launch.tech_stack || []).map((item) => item.technology),
    });
  }

  if (type === 'space') {
    const space = await ProjectSpace.findByPk(id, {
      include: [{ model: ProjectSpaceStack, as: 'stack', attributes: ['technology'], required: false }],
    });
    if (!space || !(await canViewSpace(space, viewerId))) return null;
    return buildEntityRef({
      type,
      id: space.id,
      title: space.name,
      subtitle: space.summary,
      href: `/spaces/${space.id}`,
      visibility: space.visibility,
      tags: (space.stack || []).map((item) => item.technology),
    });
  }

  if (type === 'question') {
    const question = await Question.findByPk(id, {
      include: [{ model: QuestionTag, as: 'tags', attributes: ['tag', 'slug'], required: false }],
    });
    if (!question) return null;
    return buildEntityRef({
      type,
      id: question.id,
      title: question.title,
      subtitle: question.body,
      href: `/questions/${question.id}`,
      visibility: 'public',
      tags: (question.tags || []).map((tag) => tag.slug || tag.tag),
    });
  }

  const project = await FreelanceProject.findByPk(id, {
    include: [{ model: FreelanceProjectSkill, as: 'skills', attributes: ['skill'], required: false }],
  });
  if (!project) return null;
  return buildEntityRef({
    type,
    id: project.id,
    title: project.title,
    subtitle: project.summary,
    href: `/freelance/${project.id}`,
    visibility: 'public',
    tags: (project.skills || []).map((skill) => skill.skill),
  });
}

async function getRecentPostsForEntity(type, id, limit = 4) {
  return Post.findAll({
    where: { linked_entity_type: type, linked_entity_id: id, reply_to_id: null },
    include: [{ model: User, as: 'author', attributes: ['id', 'name', 'username'], required: false }],
    order: [['created_at', 'DESC']],
    limit,
  });
}

async function getLaunchGraph(launch, viewerId = null) {
  const stackTags = uniqueStrings((launch.tech_stack || []).map((item) => item.technology.toLowerCase()));
  const [trust_context, relatedQuestions, builderPosts, recentUpdates] = await Promise.all([
    buildTrustContext(launch.builder_id, 'Builder'),
    Question.findAll({
      where: { status: 'open' },
      include: [{
        model: QuestionTag,
        as: 'tags',
        attributes: ['tag', 'slug'],
        where: tagWhere('slug', stackTags),
        required: stackTags.length > 0,
      }],
      order: [['latest_activity_at', 'DESC']],
      limit: 3,
    }),
    getRecentPostsForEntity('launch', launch.id, 3),
    launch.linked_space_id
      ? ProjectSpaceUpdate.findAll({
          where: { space_id: launch.linked_space_id },
          include: [{ model: User, as: 'author', attributes: ['id', 'name', 'username'], required: false }],
          order: [['created_at', 'DESC']],
          limit: 3,
        })
      : [],
  ]);

  let linked_space_health = null;
  if (launch.linked_space_id) {
    const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
    const [recent_updates, active_contributors] = await Promise.all([
      ProjectSpaceUpdate.count({ where: { space_id: launch.linked_space_id, created_at: { [Op.gte]: sevenDaysAgo } } }),
      ProjectSpaceUpdate.count({
        where: { space_id: launch.linked_space_id, created_at: { [Op.gte]: sevenDaysAgo } },
        distinct: true,
        col: 'author_id',
      }),
    ]);
    linked_space_health = { recent_updates, active_contributors };
  }

  return {
    trust_context,
    related_entities: [
      withReason(launch.linked_space ? buildEntityRef({
        type: 'space',
        id: launch.linked_space.id,
        title: launch.linked_space.name || 'Linked workspace',
        subtitle: launch.linked_space.status,
        href: launch.linked_space.visibility === 'public' ? `/spaces/${launch.linked_space.id}` : null,
        visibility: launch.linked_space.visibility,
      }) : null, 'Linked workspace'),
      ...relatedQuestions.map((question) => withReason(buildEntityRef({
        type: 'question',
        id: question.id,
        title: question.title,
        subtitle: question.body,
        href: `/questions/${question.id}`,
        visibility: 'public',
        tags: (question.tags || []).map((tag) => tag.slug || tag.tag),
      }), 'Question matches the launch stack')),
    ].filter(Boolean).slice(0, 6),
    next_steps: [
      buildNextStep({
        title: launch.launch_phase === 'beta'
          ? 'Request beta access'
          : launch.collaboration_mode === 'looking' && launch.linked_space_id
            ? 'Collaborate on this launch'
            : 'Review this launch',
        description: launch.launch_phase === 'beta'
          ? 'Register for the beta before the product goes fully public.'
          : launch.collaboration_mode === 'looking' && launch.linked_space_id
          ? 'Move from the product page into the team workspace.'
          : 'Leave feedback and help the builder improve it.',
        href: launch.launch_phase === 'beta'
          ? `/launches/${launch.id}#beta`
          : launch.collaboration_mode === 'looking' && launch.linked_space_id
            ? `/launches/${launch.id}/collaborate`
            : `/launches/${launch.id}#reviews`,
        auth_required: true,
        priority: 100,
      }),
      buildNextStep({
        title: launch.linked_space?.visibility === 'public' ? 'Open linked space' : 'Track public updates',
        description: launch.linked_space?.visibility === 'public'
          ? 'See contributors, build health, and recent progress.'
          : 'Use launch activity and reviews to follow progress.',
        href: launch.linked_space?.visibility === 'public' ? `/spaces/${launch.linked_space.id}` : `/launches/${launch.id}#feedback`,
        priority: 90,
      }),
      buildNextStep({
        title: 'Share an update',
        description: 'Post this launch to your feed with the launch attached.',
        href: `/feed?shareType=launch&shareId=${launch.id}&shareTitle=${encodeURIComponent(launch.name)}&shareSubtitle=${encodeURIComponent(launch.tagline || '')}&shareHref=${encodeURIComponent(`/launches/${launch.id}`)}`,
        auth_required: true,
        priority: 80,
      }),
    ],
    builder_posts: builderPosts.map((post) => post.toJSON()),
    linked_space_health,
    recent_updates: recentUpdates.map((update) => update.toJSON()),
  };
}

async function getSpaceGraph(space, viewerId = null) {
  const stackTags = uniqueStrings((space.stack || []).map((item) => item.technology.toLowerCase()));
  const [trust_context, relatedQuestions, recentPosts, freelanceOrigin] = await Promise.all([
    buildTrustContext(space.owner_id, 'Space owner'),
    Question.findAll({
      where: { status: 'open' },
      include: [{
        model: QuestionTag,
        as: 'tags',
        attributes: ['tag', 'slug'],
        where: tagWhere('slug', stackTags),
        required: stackTags.length > 0,
      }],
      order: [['latest_activity_at', 'DESC']],
      limit: 4,
    }),
    getRecentPostsForEntity('space', space.id, 4),
    FreelanceProject.findOne({
      where: { linked_space_id: space.id },
      attributes: ['id', 'title', 'status'],
      order: [['updated_at', 'DESC']],
    }),
  ]);

  const recommendedContributors = await User.findAll({
    attributes: ['id', 'name', 'username', 'headline'],
    include: [{
      model: UserProfileSkill,
      as: 'profile_skills',
      attributes: ['skill'],
      required: stackTags.length > 0,
      where: tagWhere('skill', stackTags),
    }],
    limit: 4,
  }).catch(() => []);

  return {
    trust_context,
    related_entities: [
      withReason(space.linked_launch ? buildEntityRef({
        type: 'launch',
        id: space.linked_launch.id,
        title: space.linked_launch.name,
        subtitle: space.linked_launch.tagline,
        href: `/launches/${space.linked_launch.id}`,
        visibility: 'public',
      }) : null, 'Public launch linked to this space'),
      withReason(freelanceOrigin ? buildEntityRef({
        type: 'freelance_project',
        id: freelanceOrigin.id,
        title: freelanceOrigin.title,
        subtitle: freelanceOrigin.status,
        href: `/freelance/${freelanceOrigin.id}`,
        visibility: 'public',
      }) : null, 'Awarded freelance project created this workspace'),
      ...relatedQuestions.map((question) => withReason(buildEntityRef({
        type: 'question',
        id: question.id,
        title: question.title,
        subtitle: question.body,
        href: `/questions/${question.id}`,
        visibility: 'public',
        tags: (question.tags || []).map((tag) => tag.slug || tag.tag),
      }), 'Question matches this workspace stack')),
      ...recommendedContributors.map((user) => withReason(buildEntityRef({
        type: 'builder',
        id: user.id,
        title: user.name,
        subtitle: user.headline,
        href: `/profile/${user.username || user.id}`,
        visibility: 'public',
        tags: (user.profile_skills || []).map((skill) => skill.skill),
      }), 'Recommended contributor for this stack')),
    ].filter(Boolean).slice(0, 6),
    next_steps: [
      buildNextStep({
        title: viewerId ? 'Join or manage this space' : 'Sign in to join this space',
        description: viewerId ? 'Move from reading into active collaboration.' : 'Authentication is required to request access.',
        href: viewerId ? `/spaces/${space.id}/join` : '/login',
        auth_required: !viewerId,
        priority: 100,
      }),
      buildNextStep({
        title: 'Browse related questions',
        description: 'Answer stack-matching questions and pull people toward the project.',
        href: stackTags[0] ? `/explore?type=questions&stack=${encodeURIComponent(stackTags[0])}` : '/questions',
        priority: 90,
      }),
      buildNextStep({
        title: 'Share an update',
        description: 'Post workspace momentum to your feed with the space attached.',
        href: `/feed?shareType=space&shareId=${space.id}&shareTitle=${encodeURIComponent(space.name)}&shareSubtitle=${encodeURIComponent(space.summary || '')}&shareHref=${encodeURIComponent(`/spaces/${space.id}`)}`,
        auth_required: true,
        priority: 80,
      }),
    ],
    recent_posts: recentPosts.map((post) => post.toJSON()),
  };
}

async function getFreelanceGraph(project, viewerId = null) {
  const skillTags = uniqueStrings((project.skills || []).map((skill) => skill.skill.toLowerCase()));
  const [trust_context, relatedLaunches, relatedSpaces, acceptedWorkspace] = await Promise.all([
    buildTrustContext(project.client_id, 'Client'),
    Launch.findAll({
      where: { status: 'published' },
      include: [{
        model: LaunchTechStack,
        as: 'tech_stack',
        attributes: ['technology'],
        where: tagWhere('technology', skillTags),
        required: skillTags.length > 0,
      }],
      order: [['published_at', 'DESC']],
      limit: 3,
    }),
    ProjectSpace.findAll({
      where: { visibility: 'public' },
      include: [{
        model: ProjectSpaceStack,
        as: 'stack',
        attributes: ['technology'],
        where: tagWhere('technology', skillTags),
        required: skillTags.length > 0,
      }],
      order: [['updated_at', 'DESC']],
      limit: 3,
    }),
    project.linked_space_id ? ProjectSpace.findByPk(project.linked_space_id, { attributes: ['id', 'name', 'visibility', 'status'] }) : null,
  ]);

  return {
    trust_context,
    related_entities: [
      withReason(acceptedWorkspace ? buildEntityRef({
        type: 'space',
        id: acceptedWorkspace.id,
        title: acceptedWorkspace.name,
        subtitle: acceptedWorkspace.status,
        href: acceptedWorkspace.visibility === 'public' ? `/spaces/${acceptedWorkspace.id}` : null,
        visibility: acceptedWorkspace.visibility,
      }) : null, 'Workspace created from this freelance award'),
      ...relatedLaunches.map((launch) => withReason(buildEntityRef({
        type: 'launch',
        id: launch.id,
        title: launch.name,
        subtitle: launch.tagline,
        href: `/launches/${launch.id}`,
        visibility: 'public',
      }), 'Launch uses a matching stack')),
      ...relatedSpaces.map((space) => withReason(buildEntityRef({
        type: 'space',
        id: space.id,
        title: space.name,
        subtitle: space.summary,
        href: `/spaces/${space.id}`,
        visibility: space.visibility,
      }), 'Workspace needs a similar stack')),
    ].filter(Boolean).slice(0, 6),
    next_steps: [
      buildNextStep({
        title: project.status === 'open' ? 'Submit a proposal' : 'Track proposal progress',
        description: project.status === 'open'
          ? 'Move from browsing into a concrete proposal.'
          : 'See where this project sits in the award workflow.',
        href: project.status === 'open' ? `/freelance/${project.id}#apply` : `/freelance/${project.id}`,
        auth_required: true,
        priority: 100,
      }),
      buildNextStep({
        title: project.linked_space_id ? 'Open the workspace outcome' : 'Explore related workspaces',
        description: project.linked_space_id
          ? 'This project already has a linked workspace.'
          : 'See public spaces related to this project stack.',
        href: project.linked_space_id ? `/spaces/${project.linked_space_id}` : (relatedSpaces[0] ? `/spaces/${relatedSpaces[0].id}` : '/spaces'),
        priority: 90,
      }),
      buildNextStep({
        title: 'Share an update',
        description: 'Push this opportunity or its outcome to the feed.',
        href: `/feed?shareType=freelance_project&shareId=${project.id}&shareTitle=${encodeURIComponent(project.title)}&shareSubtitle=${encodeURIComponent(project.summary || '')}&shareHref=${encodeURIComponent(`/freelance/${project.id}`)}`,
        auth_required: true,
        priority: 80,
      }),
    ],
  };
}

async function getQuestionGraph(question) {
  const tags = uniqueStrings((question.tags || []).map((tag) => (tag.slug || tag.tag).toLowerCase()));
  const [trust_context, relatedSpaces, relatedLaunches] = await Promise.all([
    buildTrustContext(question.author_id, 'Asker'),
    ProjectSpace.findAll({
      where: { visibility: 'public' },
      include: [{
        model: ProjectSpaceStack,
        as: 'stack',
        attributes: ['technology'],
        where: tagWhere('technology', tags),
        required: tags.length > 0,
      }],
      order: [['updated_at', 'DESC']],
      limit: 3,
    }),
    Launch.findAll({
      where: { status: 'published' },
      include: [{
        model: LaunchTechStack,
        as: 'tech_stack',
        attributes: ['technology'],
        where: tagWhere('technology', tags),
        required: tags.length > 0,
      }],
      order: [['published_at', 'DESC']],
      limit: 3,
    }),
  ]);

  return {
    trust_context,
    related_entities: [
      ...relatedSpaces.map((space) => withReason(buildEntityRef({
        type: 'space',
        id: space.id,
        title: space.name,
        subtitle: space.summary,
        href: `/spaces/${space.id}`,
        visibility: space.visibility,
      }), 'Relevant workspace for this question')),
      ...relatedLaunches.map((launch) => withReason(buildEntityRef({
        type: 'launch',
        id: launch.id,
        title: launch.name,
        subtitle: launch.tagline,
        href: `/launches/${launch.id}`,
        visibility: 'public',
      }), 'Launch uses a matching stack')),
    ].slice(0, 6),
    next_steps: [
      buildNextStep({
        title: 'Answer then collaborate',
        description: 'Contribute to the question first, then move into related work.',
        href: `/questions/${question.id}`,
        auth_required: true,
        priority: 100,
      }),
      buildNextStep({
        title: relatedSpaces[0] ? 'Open a related space' : 'Explore related launches',
        description: relatedSpaces[0]
          ? 'This question maps directly to an active workspace.'
          : 'See products shipping in the same stack.',
        href: relatedSpaces[0] ? `/spaces/${relatedSpaces[0].id}` : (relatedLaunches[0] ? `/launches/${relatedLaunches[0].id}` : '/explore'),
        priority: 90,
      }),
      buildNextStep({
        title: 'Share this question',
        description: 'Pull more builders into the discussion through the feed.',
        href: `/feed?shareType=question&shareId=${question.id}&shareTitle=${encodeURIComponent(question.title)}&shareSubtitle=${encodeURIComponent(question.body || '')}&shareHref=${encodeURIComponent(`/questions/${question.id}`)}`,
        auth_required: true,
        priority: 80,
      }),
    ],
  };
}

async function getProfileGraph(userId) {
  const metrics = await getUserProfileMetrics(userId);
  const tags = metrics.fit_clusters;

  const [launches, spaces, projects] = await Promise.all([
    Launch.findAll({
      where: { status: 'published' },
      include: [{
        model: LaunchTechStack,
        as: 'tech_stack',
        attributes: ['technology'],
        where: tagWhere('technology', tags),
        required: tags.length > 0,
      }],
      order: [['published_at', 'DESC']],
      limit: 2,
    }),
    ProjectSpace.findAll({
      where: { visibility: 'public' },
      include: [{
        model: ProjectSpaceStack,
        as: 'stack',
        attributes: ['technology'],
        where: tagWhere('technology', tags),
        required: tags.length > 0,
      }],
      order: [['updated_at', 'DESC']],
      limit: 2,
    }),
    FreelanceProject.findAll({
      where: { status: 'open' },
      include: [{
        model: FreelanceProjectSkill,
        as: 'skills',
        attributes: ['skill'],
        where: tagWhere('skill', tags),
        required: tags.length > 0,
      }],
      order: [['updated_at', 'DESC']],
      limit: 2,
    }),
  ]);

  return [
    ...launches.map((launch) => withReason(buildEntityRef({
      type: 'launch',
      id: launch.id,
      title: launch.name,
      subtitle: launch.tagline,
      href: `/launches/${launch.id}`,
      visibility: 'public',
    }), 'Strong fit with this builder profile')),
    ...spaces.map((space) => withReason(buildEntityRef({
      type: 'space',
      id: space.id,
      title: space.name,
      subtitle: space.summary,
      href: `/spaces/${space.id}`,
      visibility: space.visibility,
    }), 'Active workspace matching this profile')),
    ...projects.map((project) => withReason(buildEntityRef({
      type: 'freelance_project',
      id: project.id,
      title: project.title,
      subtitle: project.summary,
      href: `/freelance/${project.id}`,
      visibility: 'public',
    }), 'Freelance opportunity aligned with this profile')),
  ].filter(Boolean).slice(0, 6);
}

module.exports = {
  LINKED_ENTITY_TYPES,
  buildTrustContext,
  getFreelanceGraph,
  getLaunchGraph,
  getProfileGraph,
  getQuestionGraph,
  getSpaceGraph,
  resolveLinkedEntity,
};
