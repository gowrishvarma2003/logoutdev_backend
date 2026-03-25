const {
  Launch,
  LaunchBetaRegistration,
  LaunchFeedbackItem,
  LaunchFeedbackComment,
} = require('../../models');
const { parsePagination } = require('../../services/spaces/pagination');
const { asTrimmedString } = require('../../services/spaces/spaceValidation');
const { getLaunchOr404, isLaunchOwner } = require('../../services/launches/launchAccess');
const {
  validateFeedbackInput,
  validateFeedbackCommentInput,
} = require('../../services/launches/launchValidation');
const { getFeedbackInclude, refreshLaunchCounts } = require('../../services/launches/launchQueries');
const { canCreateFeedback, canViewFeedbackItem } = require('../../services/launches/launchPhase');
const {
  buildEntityRef,
  emitUserNotification,
  emitUserNotifications,
} = require('../../services/notifications/notificationService');

async function listLaunchFeedback(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    if (launch.status !== 'published' && !isLaunchOwner(launch, req.user?.userId || null)) {
      return res.status(404).json({ error: 'Launch not found.' });
    }

    const type = asTrimmedString(req.query.type);
    const status = asTrimmedString(req.query.status);
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const viewerId = req.user?.userId || null;
    const isOwner = isLaunchOwner(launch, viewerId);
    const registration = viewerId
      ? await LaunchBetaRegistration.findOne({
        where: { launch_id: launch.id, user_id: viewerId },
        attributes: ['status'],
      })
      : null;
    const isApprovedBetaUser = registration?.status === 'approved';

    const rows = await LaunchFeedbackItem.findAll({
      where: { launch_id: launch.id },
      include: getFeedbackInclude(),
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    });

    const filtered = rows.filter((item) => {
      if (type && item.type !== type) return false;
      if (status && item.status !== status) return false;
      return canViewFeedbackItem({
        item,
        launchPhase: launch.launch_phase,
        viewerId,
        isOwner,
        isApprovedBetaUser,
      });
    });

    return res.json({
      feedback: filtered.slice(offset, offset + limit),
      total: filtered.length,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch launch feedback.' });
  }
}

async function createLaunchFeedback(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    if (launch.status !== 'published') {
      return res.status(400).json({ error: 'Only published launches can receive feedback.' });
    }
    if (isLaunchOwner(launch, req.user.userId)) {
      return res.status(400).json({ error: 'Builders cannot create feedback items on their own launch.' });
    }

    const registration = launch.launch_phase === 'beta'
      ? await LaunchBetaRegistration.findOne({
        where: { launch_id: launch.id, user_id: req.user.userId },
        attributes: ['status'],
      })
      : null;
    const isApprovedBetaUser = registration?.status === 'approved';

    if (!canCreateFeedback({
      launchPhase: launch.launch_phase,
      isOwner: false,
      isApprovedBetaUser,
    })) {
      return res.status(403).json({ error: launch.launch_phase === 'beta' ? 'Only approved beta users can post beta feedback.' : 'Feedback is not available.' });
    }

    const validation = validateFeedbackInput(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const feedback = await LaunchFeedbackItem.create({
      launch_id: launch.id,
      author_id: req.user.userId,
      visibility_scope: launch.launch_phase === 'beta' ? 'beta' : 'public',
      ...validation.data,
    });

    await refreshLaunchCounts(launch.id);
    const hydrated = await LaunchFeedbackItem.findByPk(feedback.id, { include: getFeedbackInclude() });

    await emitUserNotification({
      recipientUserId: launch.builder_id,
      actorUserId: req.user.userId,
      eventType: 'launch_feedback_added',
      category: 'launch',
      priority: 'important',
      entityType: 'launch',
      entityId: launch.id,
      entitySnapshot: buildEntityRef({
        type: 'launch',
        id: launch.id,
        title: launch.name,
        href: `/launches/${launch.id}`,
      }),
      secondaryEntityType: 'launch_feedback',
      secondaryEntityId: feedback.id,
      secondarySnapshot: {
        type: 'launch_feedback',
        id: feedback.id,
        title: feedback.title,
        href: `/launches/${launch.id}#feedback`,
        subtitle: feedback.body,
        visibility: null,
        tags: [],
      },
      actionUrl: `/launches/${launch.id}#feedback`,
      previewText: 'left launch feedback',
      dedupeKey: `launch_feedback_added:${feedback.id}:${launch.builder_id}`,
      createdAt: feedback.created_at,
    });

    return res.status(201).json({ feedback: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create launch feedback.' });
  }
}

async function updateLaunchFeedback(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    const feedback = await LaunchFeedbackItem.findOne({
      where: { id: req.params.feedbackId, launch_id: launch.id },
      include: getFeedbackInclude(),
    });
    if (!feedback) {
      return res.status(404).json({ error: 'Feedback item not found.' });
    }

    const actorId = req.user.userId;
    const isOwner = isLaunchOwner(launch, actorId);
    const isAuthor = feedback.author_id === actorId;

    if (!isOwner && !isAuthor) {
      return res.status(403).json({ error: 'You cannot edit this feedback item.' });
    }

    const validation = validateFeedbackInput(req.body, { partial: true });
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const updates = { ...validation.data };
    delete updates.visibility_scope;
    if (updates.status !== undefined && !isOwner) {
      return res.status(403).json({ error: 'Only the builder can change feedback status.' });
    }
    if ((updates.type !== undefined || updates.title !== undefined || updates.body !== undefined) && !isAuthor) {
      return res.status(403).json({ error: 'Only the feedback author can edit feedback content.' });
    }

    updates.updated_at = new Date();
    await feedback.update(updates);

    const hydrated = await LaunchFeedbackItem.findByPk(feedback.id, { include: getFeedbackInclude() });
    return res.json({ feedback: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update launch feedback.' });
  }
}

async function deleteLaunchFeedback(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    const feedback = await LaunchFeedbackItem.findOne({
      where: { id: req.params.feedbackId, launch_id: launch.id },
      include: getFeedbackInclude(),
    });
    if (!feedback) {
      return res.status(404).json({ error: 'Feedback item not found.' });
    }

    if (feedback.author_id !== req.user.userId) {
      return res.status(403).json({ error: 'Only the feedback author can delete this item.' });
    }

    await LaunchFeedbackComment.destroy({ where: { feedback_id: feedback.id } });
    await feedback.destroy();
    await refreshLaunchCounts(launch.id);

    return res.json({ deleted: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete launch feedback.' });
  }
}

async function createLaunchFeedbackComment(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    const feedback = await LaunchFeedbackItem.findOne({
      where: { id: req.params.feedbackId, launch_id: launch.id },
      include: getFeedbackInclude(),
    });
    if (!feedback) {
      return res.status(404).json({ error: 'Feedback item not found.' });
    }

    const viewerId = req.user.userId;
    const isOwner = isLaunchOwner(launch, viewerId);
    const registration = launch.launch_phase === 'beta'
      ? await LaunchBetaRegistration.findOne({
        where: { launch_id: launch.id, user_id: viewerId },
        attributes: ['status'],
      })
      : null;
    const isApprovedBetaUser = registration?.status === 'approved';

    if (!canViewFeedbackItem({
      item: feedback,
      launchPhase: launch.launch_phase,
      viewerId,
      isOwner,
      isApprovedBetaUser,
    })) {
      return res.status(403).json({ error: 'You do not have access to comment on this feedback item.' });
    }

    const validation = validateFeedbackCommentInput(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const comment = await LaunchFeedbackComment.create({
      feedback_id: feedback.id,
      author_id: req.user.userId,
      body: validation.data.body,
    });

    const hydrated = await LaunchFeedbackComment.findByPk(comment.id, {
      include: [{ association: 'author', attributes: ['id', 'name', 'username', 'headline'], required: false }],
    });

    const recipientIds = [...new Set([feedback.author_id, launch.builder_id].filter(Boolean))];

    await emitUserNotifications(
      recipientIds.map((recipientUserId) => ({
        recipientUserId,
        actorUserId: req.user.userId,
        eventType: 'launch_feedback_commented',
        category: 'launch',
        priority: 'important',
        entityType: 'launch',
        entityId: launch.id,
        entitySnapshot: buildEntityRef({
          type: 'launch',
          id: launch.id,
          title: launch.name,
          href: `/launches/${launch.id}`,
        }),
        secondaryEntityType: 'launch_feedback',
        secondaryEntityId: feedback.id,
        secondarySnapshot: {
          type: 'launch_feedback',
          id: feedback.id,
          title: feedback.title,
          href: `/launches/${launch.id}#feedback`,
          subtitle: validation.data.body,
          visibility: null,
          tags: [],
        },
        actionUrl: `/launches/${launch.id}#feedback`,
        previewText: 'commented on launch feedback',
        groupKey: `launch_feedback_comment:${feedback.id}:${recipientUserId}`,
        dedupeKey: `launch_feedback_commented:${comment.id}:${recipientUserId}`,
        createdAt: comment.created_at,
      }))
    );

    return res.status(201).json({ comment: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create feedback comment.' });
  }
}

module.exports = {
  listLaunchFeedback,
  createLaunchFeedback,
  updateLaunchFeedback,
  deleteLaunchFeedback,
  createLaunchFeedbackComment,
};
