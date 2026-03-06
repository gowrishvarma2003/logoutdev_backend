const { Op } = require('sequelize');
const {
  ProjectSpaceDiscussion,
  ProjectSpaceDiscussionReply,
  ProjectSpaceJoinRequest,
  ProjectSpaceUpdate,
  User,
} = require('../../models');
const { ensureSpaceReadable } = require('../../services/spaces/spaceAccess');

async function getHealth(req, res) {
  try {
    const { spaceId } = req.params;
    const requesterId = req.user?.userId || null;

    const readableSpace = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!readableSpace) return;

    const now = new Date();
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(now.getDate() - 14);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const [
      recentUpdatesCount,
      activeContributorsCount,
      pendingRequestsCount,
      recentRequestReviewCount,
      recentThreadCount,
      recentReplyCount,
      recentBlockersCount,
      resolvedBlockersCount,
    ] = await Promise.all([
      ProjectSpaceUpdate.count({
        where: {
          space_id: spaceId,
          created_at: { [Op.gte]: sevenDaysAgo },
        },
      }),
      ProjectSpaceUpdate.count({
        distinct: true,
        col: 'author_id',
        where: {
          space_id: spaceId,
          created_at: { [Op.gte]: fourteenDaysAgo },
        },
      }),
      ProjectSpaceJoinRequest.count({
        where: {
          space_id: spaceId,
          status: 'pending',
        },
      }),
      ProjectSpaceJoinRequest.count({
        where: {
          space_id: spaceId,
          reviewed_at: { [Op.gte]: thirtyDaysAgo },
          status: { [Op.in]: ['accepted', 'rejected'] },
        },
      }),
      ProjectSpaceDiscussion.count({
        where: {
          space_id: spaceId,
          created_at: { [Op.gte]: thirtyDaysAgo },
        },
      }),
      ProjectSpaceDiscussionReply.count({
        include: [
          {
            model: ProjectSpaceDiscussion,
            as: 'thread',
            where: { space_id: spaceId },
            attributes: [],
          },
        ],
        where: {
          created_at: { [Op.gte]: thirtyDaysAgo },
        },
      }),
      ProjectSpaceUpdate.count({
        where: {
          space_id: spaceId,
          type: 'blocker',
          created_at: { [Op.gte]: thirtyDaysAgo },
        },
      }),
      ProjectSpaceDiscussion.count({
        where: {
          space_id: spaceId,
          category: 'blocked',
          status: 'resolved',
          updated_at: { [Op.gte]: thirtyDaysAgo },
        },
      }),
    ]);

    const updateScore = Math.min(recentUpdatesCount * 10, 30);
    const contributorScore = Math.min(activeContributorsCount * 8, 24);
    const responsivenessScore = recentThreadCount > 0
      ? Math.min(Math.round((recentReplyCount / recentThreadCount) * 6), 20)
      : 8;
    const requestScore = pendingRequestsCount === 0
      ? 14
      : Math.max(2, Math.min(recentRequestReviewCount * 3, 14));
    const blockerScore = recentBlockersCount === 0
      ? 12
      : Math.min(Math.round((resolvedBlockersCount / recentBlockersCount) * 12), 12);

    const total = Math.min(updateScore + contributorScore + responsivenessScore + requestScore + blockerScore, 100);

    let band = 'Needs Attention';
    if (total >= 75) band = 'Excellent';
    else if (total >= 50) band = 'Healthy';

    return res.json({
      health: {
        score: total,
        band,
        factors: {
          updateScore,
          contributorScore,
          responsivenessScore,
          requestScore,
          blockerScore,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to compute collaboration health.' });
  }
}

async function getDecisions(req, res) {
  try {
    const { spaceId } = req.params;
    const requesterId = req.user?.userId || null;

    const readableSpace = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!readableSpace) return;

    const decisions = await ProjectSpaceDiscussion.findAll({
      where: {
        space_id: spaceId,
        [Op.or]: [
          { category: 'decision' },
          { decision_summary: { [Op.ne]: null } },
        ],
      },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email'] }],
      order: [['updated_at', 'DESC']],
    });

    return res.json({ decisions });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch decision ledger.' });
  }
}

module.exports = {
  getHealth,
  getDecisions,
};
