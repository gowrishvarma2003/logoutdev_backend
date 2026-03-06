const { Op } = require('sequelize');
const {
  sequelize,
  ProjectSpaceJoinRequest,
  ProjectSpaceMember,
  User,
} = require('../../models');
const {
  getSpaceOr404,
  getMembership,
  isMaintainerOrOwner,
} = require('../../services/spaces/spaceAccess');
const {
  JOIN_REVIEW_ACTIONS,
  asTrimmedString,
  normalizeStringArray,
  normalizeHttpLinks,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');
const { parsePagination } = require('../../services/spaces/pagination');

async function createJoinRequest(req, res) {
  try {
    const userId = req.user.userId;
    const spaceId = req.params.spaceId;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    if (space.owner_id === userId) {
      return res.status(400).json({ error: 'Owner is already part of this project.' });
    }

    const existingMembership = await getMembership(spaceId, userId);
    if (existingMembership) {
      return res.status(409).json({ error: 'You are already a contributor in this project.' });
    }

    const openRequest = await ProjectSpaceJoinRequest.findOne({
      where: {
        space_id: spaceId,
        user_id: userId,
        status: { [Op.in]: ['pending', 'need-info'] },
      },
    });

    if (openRequest) {
      return res.status(409).json({ error: 'You already have an open join request.' });
    }

    const message = asTrimmedString(req.body.message);
    const rawAvailability = req.body.availability_hours;
    const availabilityHours = rawAvailability != null ? Number(rawAvailability) : null;
    const skills = normalizeStringArray(req.body.skills, 25);
    const proofLinks = normalizeHttpLinks(req.body.proof_links, 10);

    if (message.length < 10) {
      return res.status(400).json({ error: 'Join request message must be at least 10 characters.' });
    }

    if (availabilityHours !== null && (!Number.isFinite(availabilityHours) || availabilityHours < 1 || availabilityHours > 80)) {
      return res.status(400).json({ error: 'availability_hours must be a number between 1 and 80.' });
    }

    const joinRequest = await ProjectSpaceJoinRequest.create({
      space_id: spaceId,
      user_id: userId,
      message,
      skills,
      availability_hours: availabilityHours,
      proof_links: proofLinks,
      status: 'pending',
    });

    return res.status(201).json({ joinRequest });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to submit join request.' });
  }
}

async function listJoinRequests(req, res) {
  try {
    const userId = req.user.userId;
    const spaceId = req.params.spaceId;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMaintainerOrOwner(membership)) {
      return res.status(403).json({ error: 'Only owner or maintainer can view join requests.' });
    }

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const { count, rows: requests } = await ProjectSpaceJoinRequest.findAndCountAll({
      where: { space_id: spaceId },
      include: [{ model: User, as: 'applicant', attributes: ['id', 'name', 'email'] }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return res.json({ requests, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch join requests.' });
  }
}

async function reviewJoinRequest(req, res) {
  try {
    const reviewerId = req.user.userId;
    const { spaceId, requestId } = req.params;
    const action = asTrimmedString(req.body.action);

    if (!isAllowedValue(action, JOIN_REVIEW_ACTIONS)) {
      return res.status(400).json({ error: 'action must be one of: accept, reject, need-info, request-more-info.' });
    }

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, reviewerId);
    if (!isMaintainerOrOwner(membership)) {
      return res.status(403).json({ error: 'Only owner or maintainer can review join requests.' });
    }

    const joinRequest = await ProjectSpaceJoinRequest.findOne({
      where: { id: requestId, space_id: spaceId },
    });

    if (!joinRequest) {
      return res.status(404).json({ error: 'Join request not found.' });
    }

    if (joinRequest.status !== 'pending' && joinRequest.status !== 'need-info') {
      return res.status(400).json({ error: 'This join request is already finalized.' });
    }

    const statusMap = {
      accept: 'accepted',
      reject: 'rejected',
      'need-info': 'need-info',
      'request-more-info': 'need-info',
    };

    const nextStatus = statusMap[action];

    await sequelize.transaction(async (transaction) => {
      await joinRequest.update(
        {
          status: nextStatus,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          updated_at: new Date(),
        },
        { transaction }
      );

      if (nextStatus === 'accepted') {
        await ProjectSpaceMember.findOrCreate({
          where: {
            space_id: spaceId,
            user_id: joinRequest.user_id,
          },
          defaults: {
            role: 'contributor',
          },
          transaction,
        });
      }
    });

    return res.json({ joinRequest });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to review join request.' });
  }
}

module.exports = {
  createJoinRequest,
  listJoinRequests,
  reviewJoinRequest,
};
