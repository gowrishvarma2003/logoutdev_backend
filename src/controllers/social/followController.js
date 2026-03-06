const { Follow, User } = require('../../models');

/**
 * Follow a user.
 * POST /api/users/:userId/follow
 */
async function followUser(req, res) {
  try {
    const followerId = req.user.userId;
    const followingId = req.params.userId;

    if (followerId === followingId) {
      return res.status(400).json({ error: 'You cannot follow yourself.' });
    }

    const targetUser = await User.findByPk(followingId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await Follow.findOrCreate({
      where: { follower_id: followerId, following_id: followingId },
    });

    return res.json({ following: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to follow user.' });
  }
}

/**
 * Unfollow a user.
 * DELETE /api/users/:userId/follow
 */
async function unfollowUser(req, res) {
  try {
    const followerId = req.user.userId;
    const followingId = req.params.userId;

    await Follow.destroy({
      where: { follower_id: followerId, following_id: followingId },
    });

    return res.json({ following: false });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to unfollow user.' });
  }
}

/**
 * Get followers of a user.
 * GET /api/users/:userId/followers
 */
async function getFollowers(req, res) {
  try {
    const follows = await Follow.findAll({
      where: { following_id: req.params.userId },
      include: [{ model: User, as: 'follower', attributes: ['id', 'name', 'email'] }],
    });

    const followers = follows.map((f) => f.follower);
    return res.json({ followers });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch followers.' });
  }
}

/**
 * Get users a user is following.
 * GET /api/users/:userId/following
 */
async function getFollowing(req, res) {
  try {
    const follows = await Follow.findAll({
      where: { follower_id: req.params.userId },
      include: [{ model: User, as: 'followed', attributes: ['id', 'name', 'email'] }],
    });

    const following = follows.map((f) => f.followed);
    return res.json({ following });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch following list.' });
  }
}

module.exports = { followUser, unfollowUser, getFollowers, getFollowing };
