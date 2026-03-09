const { Op } = require('sequelize');
const { Launch, ProjectSpace, ProjectSpaceJoinRequest, ProjectSpaceMember } = require('../../models');
const { getLaunchOr404, isLaunchOwner } = require('../../services/launches/launchAccess');
const { validateCollaborationRequestInput } = require('../../services/launches/launchValidation');
const {
  buildEntityRef,
  emitUserNotifications,
} = require('../../services/notifications/notificationService');

async function createLaunchCollaborationRequest(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    if (launch.status !== 'published') {
      return res.status(404).json({ error: 'Launch not found.' });
    }
    if (isLaunchOwner(launch, req.user.userId)) {
      return res.status(400).json({ error: 'Builders cannot request collaboration on their own launch.' });
    }
    if (!launch.linked_space_id || launch.collaboration_mode !== 'looking') {
      return res.status(400).json({ error: 'This launch is not accepting collaboration requests.' });
    }

    const existingMembership = await ProjectSpaceMember.findOne({
      where: { space_id: launch.linked_space_id, user_id: req.user.userId },
      attributes: ['id'],
    });
    if (existingMembership) {
      return res.status(409).json({ error: 'You are already part of the linked space.' });
    }

    const openRequest = await ProjectSpaceJoinRequest.findOne({
      where: {
        space_id: launch.linked_space_id,
        user_id: req.user.userId,
        status: { [Op.in]: ['pending', 'need-info'] },
      },
      attributes: ['id'],
    });
    if (openRequest) {
      return res.status(409).json({ error: 'You already have an open collaboration request for this launch.' });
    }

    const validation = validateCollaborationRequestInput(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const joinRequest = await ProjectSpaceJoinRequest.create({
      space_id: launch.linked_space_id,
      user_id: req.user.userId,
      ...validation.data,
      status: 'pending',
    });

    const space = await ProjectSpace.findByPk(launch.linked_space_id, {
      attributes: ['id', 'name', 'visibility', 'owner_id'],
    });

    const reviewerMemberships = await ProjectSpaceMember.findAll({
      where: {
        space_id: launch.linked_space_id,
        role: { [Op.in]: ['owner', 'maintainer'] },
      },
      attributes: ['user_id'],
    });

    const recipientIds = [...new Set([
      space?.owner_id,
      ...reviewerMemberships.map((member) => member.user_id),
    ].filter(Boolean))];

    await emitUserNotifications(
      recipientIds.map((recipientUserId) => ({
        recipientUserId,
        actorUserId: req.user.userId,
        eventType: 'join_request_submitted',
        category: 'space',
        priority: 'action',
        entityType: 'space',
        entityId: launch.linked_space_id,
        entitySnapshot: buildEntityRef({
          type: 'space',
          id: launch.linked_space_id,
          title: space?.name || launch.name,
          href: `/spaces/${launch.linked_space_id}`,
          visibility: space?.visibility || null,
        }),
        secondaryEntityType: 'join_request',
        secondaryEntityId: joinRequest.id,
        secondarySnapshot: {
          type: 'join_request',
          id: joinRequest.id,
          title: 'Join request pending',
          href: `/spaces/${launch.linked_space_id}/manage`,
          subtitle: validation.data.message,
          visibility: null,
          tags: validation.data.skills,
        },
        actionUrl: `/spaces/${launch.linked_space_id}/manage`,
        previewText: 'sent a join request to your space',
        dedupeKey: `join_request_submitted:${joinRequest.id}:${recipientUserId}`,
        createdAt: joinRequest.created_at,
      }))
    );

    return res.status(201).json({ joinRequest });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create collaboration request.' });
  }
}

module.exports = {
  createLaunchCollaborationRequest,
};
