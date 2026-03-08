const { Op } = require('sequelize');
const { Follow, User } = require('../../models');

const USER_SUGGEST_CACHE_TTL_MS = 45 * 1000;
const userSuggestCache = new Map();

function getCache(key) {
  const hit = userSuggestCache.get(key);
  if (!hit) return null;
  if (hit.expires_at < Date.now()) {
    userSuggestCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value) {
  userSuggestCache.set(key, {
    value,
    expires_at: Date.now() + USER_SUGGEST_CACHE_TTL_MS,
  });
}

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
      include: [{ model: User, as: 'follower', attributes: ['id', 'name', 'email', 'username'] }],
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
      include: [{ model: User, as: 'followed', attributes: ['id', 'name', 'email', 'username'] }],
    });

    const following = follows.map((f) => f.followed);
    return res.json({ following });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch following list.' });
  }
}

async function suggestUsers(req, res) {
  try {
    const rawQuery = String(req.query.q || '').trim().toLowerCase();
    if (rawQuery.length < 2) {
      return res.json({ users: [] });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 8);
    const cacheKey = `${rawQuery}:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const users = await User.findAll({
      where: {
        [Op.or]: [
          { username: { [Op.iLike]: `${rawQuery}%` } },
          { name: { [Op.iLike]: `${rawQuery}%` } },
        ],
      },
      attributes: ['id', 'name', 'email', 'username', 'headline'],
      order: [['username', 'ASC']],
      limit,
    });

    const payload = {
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        headline: user.headline,
      })),
    };

    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to suggest users.' });
  }
}

module.exports = { followUser, unfollowUser, getFollowers, getFollowing, suggestUsers };
