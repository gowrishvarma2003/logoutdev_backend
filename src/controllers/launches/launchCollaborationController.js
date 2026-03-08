const { Op } = require('sequelize');
const { Launch, ProjectSpaceJoinRequest, ProjectSpaceMember } = require('../../models');
const { getLaunchOr404, isLaunchOwner } = require('../../services/launches/launchAccess');
const { validateCollaborationRequestInput } = require('../../services/launches/launchValidation');

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

    return res.status(201).json({ joinRequest });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create collaboration request.' });
  }
}

module.exports = {
  createLaunchCollaborationRequest,
};