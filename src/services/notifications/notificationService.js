const { Op, literal } = require('sequelize');
const {
  User,
  UserNotification,
  Post,
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceUpdate,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  ProjectSpaceJoinRequest,
  Launch,
  LaunchUpvote,
  LaunchReview,
  FreelanceProject,
  FreelanceProposal,
  Question,
  QuestionAnswer,
  QuestionTag,
  UserProfileSkill,
} = require('../../models');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const GROUP_WINDOW_MS = 1000 * 60 * 60 * 6;

function clampLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function trimText(value, max = 200) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function buildEntityRef({
  type,
  id,
  title,
  href,
  subtitle = null,
  visibility = null,
  tags = [],
}) {
  return {
    type,
    id,
    title: trimText(title, 140) || 'Untitled',
    href: trimText(href, 240),
    subtitle: trimText(subtitle, 160),
    visibility: visibility || null,
    tags: Array.isArray(tags) ? tags.slice(0, 8) : [],
  };
}

function getPriorityOrder(priority) {
  if (priority === 'action') return 0;
  if (priority === 'important') return 1;
  return 2;
}

function getNotificationOrder() {
  return [
    [literal('CASE WHEN read_at IS NULL THEN 0 ELSE 1 END'), 'ASC'],
    [literal("CASE priority WHEN 'action' THEN 0 WHEN 'important' THEN 1 ELSE 2 END"), 'ASC'],
    ['created_at', 'DESC'],
  ];
}

function getTabWhere(tab) {
  if (tab === 'needs-action') {
    return { priority: 'action' };
  }

  if (tab === 'unread') {
    return { read_at: null };
  }

  return {};
}

async function canAccessSpace(spaceId, userId) {
  const space = await ProjectSpace.findByPk(spaceId, {
    attributes: ['id', 'owner_id', 'visibility'],
  });
  if (!space) return false;
  if (space.visibility === 'public') return true;
  if (space.owner_id === userId) return true;

  const membership = await ProjectSpaceMember.findOne({
    where: { space_id: space.id, user_id: userId },
    attributes: ['id'],
  });

  return Boolean(membership);
}

async function canAccessRepo(repoId, userId) {
  const repo = await ProjectSpaceRepo.findByPk(repoId, {
    attributes: ['id', 'space_id'],
  });
  if (!repo) return false;
  if (await canAccessSpace(repo.space_id, userId)) return true;

  const repoMembership = await ProjectSpaceRepoMember.findOne({
    where: { repo_id: repo.id, user_id: userId },
    attributes: ['id'],
  });

  return Boolean(repoMembership);
}

async function canOpenNotification(notification, userId) {
  if (!notification.action_url) return false;

  switch (notification.entity_type) {
    case 'space':
    case 'join_request':
    case 'space_discussion':
      return canAccessSpace(notification.entity_id, userId);
    case 'repo':
      return canAccessRepo(notification.entity_id, userId);
    case 'launch': {
      const launch = await Launch.findByPk(notification.entity_id, {
        attributes: ['id', 'builder_id', 'status'],
      });
      return Boolean(launch && (launch.status === 'published' || launch.builder_id === userId));
    }
    case 'freelance_project':
      return Boolean(await FreelanceProject.findByPk(notification.entity_id, { attributes: ['id'] }));
    case 'question':
      return Boolean(await Question.findByPk(notification.entity_id, { attributes: ['id'] }));
    case 'post':
      return Boolean(await Post.findByPk(notification.entity_id, { attributes: ['id'] }));
    default:
      return true;
  }
}

async function serializeNotification(notification, userId) {
  const canOpen = await canOpenNotification(notification, userId);

  return {
    id: notification.id,
    actor: notification.actor
      ? {
          id: notification.actor.id,
          name: notification.actor.name,
          email: notification.actor.email,
          username: notification.actor.username,
          headline: notification.actor.headline,
        }
      : null,
    verb: notification.preview_text,
    preview_text: notification.preview_text,
    event_type: notification.event_type,
    category: notification.category,
    priority: notification.priority,
    entity_ref: notification.entity_snapshot,
    secondary_entity_ref: notification.secondary_snapshot,
    action_url: canOpen ? notification.action_url : null,
    can_open: canOpen,
    group_count: notification.group_count || 1,
    created_at: notification.created_at,
    read_at: notification.read_at,
  };
}

async function emitUserNotification(input, options = {}) {
  const {
    recipientUserId,
    actorUserId = null,
    eventType,
    category,
    priority = 'activity',
    entityType,
    entityId,
    entitySnapshot,
    secondaryEntityType = null,
    secondaryEntityId = null,
    secondarySnapshot = null,
    actionUrl = null,
    previewText = null,
    groupKey = null,
    dedupeKey,
    createdAt = new Date(),
  } = input;

  if (!recipientUserId || !eventType || !category || !entityType || !entityId || !dedupeKey) {
    throw new Error('emitUserNotification requires recipient, event, category, entity, and dedupe key.');
  }

  if (recipientUserId === actorUserId) {
    return null;
  }

  const transaction = options.transaction;
  const exactMatch = await UserNotification.findOne({
    where: { dedupe_key: dedupeKey },
    transaction,
  });

  if (exactMatch) {
    return exactMatch;
  }

  if (groupKey) {
    const existingGroup = await UserNotification.findOne({
      where: {
        recipient_user_id: recipientUserId,
        group_key: groupKey,
        read_at: null,
        created_at: { [Op.gte]: new Date(createdAt.getTime() - GROUP_WINDOW_MS) },
      },
      order: [['created_at', 'DESC']],
      transaction,
    });

    if (existingGroup) {
      await existingGroup.update(
        {
          actor_user_id: actorUserId,
          preview_text: previewText,
          action_url: actionUrl,
          entity_snapshot: entitySnapshot,
          secondary_entity_type: secondaryEntityType,
          secondary_entity_id: secondaryEntityId,
          secondary_snapshot: secondarySnapshot,
          created_at: createdAt,
          group_count: Math.max(1, Number(existingGroup.group_count || 1)) + 1,
        },
        { transaction }
      );

      return existingGroup;
    }
  }

  return UserNotification.create(
    {
      recipient_user_id: recipientUserId,
      actor_user_id: actorUserId,
      event_type: eventType,
      category,
      priority,
      entity_type: entityType,
      entity_id: entityId,
      entity_snapshot: entitySnapshot,
      secondary_entity_type: secondaryEntityType,
      secondary_entity_id: secondaryEntityId,
      secondary_snapshot: secondarySnapshot,
      action_url: actionUrl,
      preview_text: previewText,
      group_key: groupKey,
      dedupe_key: dedupeKey,
      created_at: createdAt,
    },
    { transaction }
  );
}

async function emitUserNotifications(inputs, options = {}) {
  const created = [];

  for (const input of inputs) {
    // eslint-disable-next-line no-await-in-loop
    const notification = await emitUserNotification(input, options);
    if (notification) created.push(notification);
  }

  return created;
}

async function listNotificationsForUser(userId, { tab = 'all', cursor = null, limit } = {}) {
  const pageSize = clampLimit(limit);
  const where = {
    recipient_user_id: userId,
    ...getTabWhere(tab),
  };

  if (cursor) {
    where.created_at = { [Op.lt]: new Date(cursor) };
  }

  const rows = await UserNotification.findAll({
    where,
    include: [{
      model: User,
      as: 'actor',
      attributes: ['id', 'name', 'email', 'username', 'headline'],
      required: false,
    }],
    order: getNotificationOrder(),
    limit: pageSize,
  });

  const items = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    items.push(await serializeNotification(row, userId));
  }

  return {
    items,
    next_cursor: rows.length === pageSize ? rows[rows.length - 1].created_at.toISOString() : null,
  };
}

async function getNotificationSummary(userId) {
  const [unreadCount, needsActionCount, rows] = await Promise.all([
    UserNotification.count({
      where: { recipient_user_id: userId, read_at: null },
    }),
    UserNotification.count({
      where: { recipient_user_id: userId, read_at: null, priority: 'action' },
    }),
    UserNotification.findAll({
      where: { recipient_user_id: userId },
      include: [{
        model: User,
        as: 'actor',
        attributes: ['id', 'name', 'email', 'username', 'headline'],
        required: false,
      }],
      order: getNotificationOrder(),
      limit: 5,
    }),
  ]);

  const recent = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    recent.push(await serializeNotification(row, userId));
  }

  return {
    unread_count: unreadCount,
    needs_action_count: needsActionCount,
    recent,
  };
}

async function markNotificationRead(userId, notificationId) {
  const notification = await UserNotification.findOne({
    where: { id: notificationId, recipient_user_id: userId },
  });
  if (!notification) return null;

  if (!notification.read_at) {
    await notification.update({ read_at: new Date() });
  }

  return notification;
}

async function markAllNotificationsRead(userId, tab = 'all') {
  const where = {
    recipient_user_id: userId,
    read_at: null,
    ...getTabWhere(tab),
  };

  const [updatedCount] = await UserNotification.update(
    { read_at: new Date() },
    { where }
  );

  return updatedCount;
}

async function buildLaunchReviewSuggestion(userId) {
  const upvotes = await LaunchUpvote.findAll({
    where: { user_id: userId },
    include: [{
      model: Launch,
      as: 'launch',
      attributes: ['id', 'name', 'status', 'builder_id'],
      where: { status: 'published' },
      required: true,
    }],
    order: [['created_at', 'DESC']],
    limit: 10,
  });

  for (const upvote of upvotes) {
    const launch = upvote.launch;
    if (!launch || launch.builder_id === userId) continue;

    // eslint-disable-next-line no-await-in-loop
    const existingReview = await LaunchReview.findOne({
      where: { launch_id: launch.id, author_id: userId },
      attributes: ['id'],
    });
    if (existingReview) continue;

    return {
      type: 'review_launch_you_upvoted',
      title: `Review ${launch.name}`,
      description: 'You upvoted this launch. Leave feedback while your context is still fresh.',
      primary_cta: { label: 'Write review', href: `/launches/${launch.id}#reviews` },
      entity_ref: buildEntityRef({
        type: 'launch',
        id: launch.id,
        title: launch.name,
        href: `/launches/${launch.id}`,
      }),
    };
  }

  return null;
}

async function buildQuestionSuggestion(userId) {
  const skills = await UserProfileSkill.findAll({
    where: { user_id: userId },
    attributes: ['skill'],
    order: [['rank', 'ASC']],
    limit: 5,
  });

  const tags = skills.map((item) => String(item.skill || '').trim()).filter(Boolean);
  if (!tags.length) return null;

  const questions = await Question.findAll({
    where: {
      author_id: { [Op.ne]: userId },
      status: 'open',
    },
    include: [{
      model: QuestionTag,
      as: 'tags',
      attributes: ['tag'],
      where: { tag: { [Op.in]: tags } },
      required: true,
    }],
    order: [['latest_activity_at', 'DESC']],
    limit: 10,
  });

  for (const question of questions) {
    // eslint-disable-next-line no-await-in-loop
    const myAnswer = await QuestionAnswer.findOne({
      where: { question_id: question.id, author_id: userId },
      attributes: ['id'],
    });
    if (myAnswer) continue;

    return {
      type: 'answer_question_in_stack',
      title: 'Answer a question in your stack',
      description: question.title,
      primary_cta: { label: 'Answer question', href: `/questions/${question.id}` },
      entity_ref: buildEntityRef({
        type: 'question',
        id: question.id,
        title: question.title,
        href: `/questions/${question.id}`,
        tags: question.tags.map((tag) => tag.tag),
      }),
    };
  }

  return null;
}

async function buildJoinRequestSuggestion(userId) {
  const joinRequest = await ProjectSpaceJoinRequest.findOne({
    where: {
      user_id: userId,
      status: { [Op.in]: ['pending', 'need-info'] },
    },
    include: [{
      model: ProjectSpace,
      as: 'space',
      attributes: ['id', 'name', 'visibility'],
      required: false,
    }],
    order: [['updated_at', 'DESC']],
  });

  if (!joinRequest || !joinRequest.space) return null;

  const label = joinRequest.status === 'need-info' ? 'Respond now' : 'Check status';
  const description = joinRequest.status === 'need-info'
    ? 'A maintainer asked for more context on your join request.'
    : 'Your join request is still open. Follow up if the project is still a fit.';

  return {
    type: 'follow_up_join_request',
    title: `Follow up on ${joinRequest.space.name}`,
    description,
    primary_cta: {
      label,
      href: `/spaces/${joinRequest.space_id}/join`,
    },
    entity_ref: buildEntityRef({
      type: 'space',
      id: joinRequest.space_id,
      title: joinRequest.space.name,
      href: `/spaces/${joinRequest.space_id}`,
      visibility: joinRequest.space.visibility,
    }),
  };
}

async function buildSpaceUpdateSuggestion(userId) {
  const candidateSpaces = await ProjectSpace.findAll({
    where: {
      owner_id: userId,
      status: { [Op.notIn]: ['archived', 'paused'] },
    },
    attributes: ['id', 'name', 'visibility'],
    order: [['updated_at', 'DESC']],
    limit: 8,
  });

  const staleCutoff = new Date(Date.now() - (1000 * 60 * 60 * 24 * 14));

  for (const space of candidateSpaces) {
    // eslint-disable-next-line no-await-in-loop
    const latestUpdate = await ProjectSpaceUpdate.findOne({
      where: { space_id: space.id },
      attributes: ['created_at'],
      order: [['created_at', 'DESC']],
    });

    if (latestUpdate && new Date(latestUpdate.created_at) >= staleCutoff) {
      continue;
    }

    return {
      type: 'update_stale_space',
      title: `Update ${space.name}`,
      description: 'This space has no recent progress update. Share a quick status note to keep people engaged.',
      primary_cta: {
        label: 'Post update',
        href: `/spaces/${space.id}/updates`,
      },
      entity_ref: buildEntityRef({
        type: 'space',
        id: space.id,
        title: space.name,
        href: `/spaces/${space.id}`,
        visibility: space.visibility,
      }),
    };
  }

  return null;
}

async function buildProposalSuggestion(userId) {
  const projects = await FreelanceProject.findAll({
    where: {
      client_id: userId,
      status: { [Op.in]: ['open', 'in_review'] },
    },
    attributes: ['id', 'title', 'status'],
    order: [['updated_at', 'DESC']],
    limit: 8,
  });

  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop
    const pendingProposalCount = await FreelanceProposal.count({
      where: {
        project_id: project.id,
        status: { [Op.in]: ['submitted', 'shortlisted'] },
      },
    });

    if (pendingProposalCount === 0) continue;

    return {
      type: 'review_freelance_proposals',
      title: `Review proposals for ${project.title}`,
      description: `${pendingProposalCount} proposal${pendingProposalCount === 1 ? '' : 's'} waiting for review.`,
      primary_cta: {
        label: 'Open inbox',
        href: `/freelance/${project.id}/proposals`,
      },
      entity_ref: buildEntityRef({
        type: 'freelance_project',
        id: project.id,
        title: project.title,
        href: `/freelance/${project.id}`,
      }),
    };
  }

  return null;
}

async function buildAwardedWorkspaceSuggestion(userId) {
  const acceptedProposal = await FreelanceProposal.findOne({
    where: { freelancer_id: userId, status: 'accepted' },
    include: [{
      model: FreelanceProject,
      as: 'project',
      attributes: ['id', 'title', 'linked_space_id'],
      required: true,
      where: {
        linked_space_id: { [Op.ne]: null },
      },
    }],
    order: [['updated_at', 'DESC']],
  });

  if (!acceptedProposal || !acceptedProposal.project?.linked_space_id) return null;

  return {
    type: 'open_awarded_workspace',
    title: `Open workspace for ${acceptedProposal.project.title}`,
    description: 'Your proposal was accepted. Continue the work inside the linked space.',
    primary_cta: {
      label: 'Open workspace',
      href: `/spaces/${acceptedProposal.project.linked_space_id}`,
    },
    entity_ref: buildEntityRef({
      type: 'space',
      id: acceptedProposal.project.linked_space_id,
      title: acceptedProposal.project.title,
      href: `/spaces/${acceptedProposal.project.linked_space_id}`,
    }),
  };
}

async function buildSuggestedActions(userId) {
  const [launchAction, questionAction, joinRequestAction, spaceUpdateAction, proposalAction, workspaceAction] = await Promise.all([
    buildLaunchReviewSuggestion(userId),
    buildQuestionSuggestion(userId),
    buildJoinRequestSuggestion(userId),
    buildSpaceUpdateSuggestion(userId),
    buildProposalSuggestion(userId),
    buildAwardedWorkspaceSuggestion(userId),
  ]);

  return [
    launchAction,
    questionAction,
    joinRequestAction,
    spaceUpdateAction,
    proposalAction,
    workspaceAction,
  ].filter(Boolean);
}

module.exports = {
  buildEntityRef,
  buildSuggestedActions,
  emitUserNotification,
  emitUserNotifications,
  getNotificationSummary,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
};
