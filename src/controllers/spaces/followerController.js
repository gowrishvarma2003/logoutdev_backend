const { ProjectSpaceFollower, User } = require('../../models');
const { getSpaceOr404, ensureSpaceReadable } = require('../../services/spaces/spaceAccess');

async function listFollowers(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!readableSpace) return;

    const followers = await ProjectSpaceFollower.findAll({
      where: { space_id: req.params.spaceId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'username', 'headline'] }],
      order: [['created_at', 'DESC']],
    });

    return res.json({ followers });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch followers.' });
  }
}

async function followSpace(req, res) {
  try {
    const userId = req.user.userId;
    const space = await getSpaceOr404(req.params.spaceId, res);
    if (!space) return;

    const [follow] = await ProjectSpaceFollower.findOrCreate({
      where: { space_id: space.id, user_id: userId },
      defaults: { space_id: space.id, user_id: userId },
    });

    return res.status(201).json({ follow });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to follow space.' });
  }
}

async function unfollowSpace(req, res) {
  try {
    const userId = req.user.userId;
    const space = await getSpaceOr404(req.params.spaceId, res);
    if (!space) return;

    await ProjectSpaceFollower.destroy({
      where: { space_id: space.id, user_id: userId },
    });

    return res.json({ removed: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to unfollow space.' });
  }
}

module.exports = {
  listFollowers,
  followSpace,
  unfollowSpace,
};
