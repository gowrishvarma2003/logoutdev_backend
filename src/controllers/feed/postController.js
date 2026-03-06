const { Op } = require('sequelize');
const { Post, PostHashtag, PostLike, Repost, Follow, User } = require('../../models');

const HASHTAG_REGEX = /#([a-zA-Z0-9_]+)/g;
const MAX_CONTENT_LENGTH = 500;

/**
 * Extract unique lowercase hashtags from post content.
 */
function extractHashtags(content) {
  const tags = [];
  let match;
  const seen = new Set();

  while ((match = HASHTAG_REGEX.exec(content)) !== null) {
    const tag = match[1].toLowerCase();
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Create a new post.
 * POST /api/posts
 */
async function createPost(req, res) {
  try {
    const { content } = req.body;
    const userId = req.user.userId;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Post content is required.' });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({
        error: `Post content must not exceed ${MAX_CONTENT_LENGTH} characters.`,
      });
    }

    const post = await Post.create({
      user_id: userId,
      content: content.trim(),
    });

    const tags = extractHashtags(post.content);
    if (tags.length > 0) {
      await PostHashtag.bulkCreate(
        tags.map((tag) => ({ post_id: post.id, tag })),
        { ignoreDuplicates: true }
      );
    }

    return res.status(201).json({ post });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create post.' });
  }
}

/**
 * Get the personalised feed (posts from followed users + own posts).
 * GET /api/posts/feed?cursor=&limit=
 */
async function getFeed(req, res) {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const cursor = req.query.cursor || null;

    // Resolve followed user IDs
    const follows = await Follow.findAll({
      where: { follower_id: userId },
      attributes: ['following_id'],
    });
    const followingIds = follows.map((f) => f.following_id);
    const feedUserIds = [...new Set([userId, ...followingIds])];

    const whereClause = {
      user_id: { [Op.in]: feedUserIds },
      reply_to_id: null, // exclude replies from main feed
    };

    if (cursor) {
      whereClause.created_at = { [Op.lt]: new Date(cursor) };
    }

    const posts = await Post.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit,
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email'] }],
    });

    // Attach viewer-specific flags
    const postIds = posts.map((p) => p.id);
    const [likes, reposts] = await Promise.all([
      PostLike.findAll({ where: { post_id: { [Op.in]: postIds }, user_id: userId }, attributes: ['post_id'] }),
      Repost.findAll({ where: { post_id: { [Op.in]: postIds }, user_id: userId }, attributes: ['post_id'] }),
    ]);

    const likedSet = new Set(likes.map((l) => l.post_id));
    const repostedSet = new Set(reposts.map((r) => r.post_id));

    const enrichedPosts = posts.map((p) => ({
      ...p.toJSON(),
      is_liked_by_me: likedSet.has(p.id),
      is_reposted_by_me: repostedSet.has(p.id),
    }));

    const nextCursor =
      posts.length === limit ? posts[posts.length - 1].created_at.toISOString() : null;

    return res.json({ posts: enrichedPosts, nextCursor });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch feed.' });
  }
}

/**
 * Get the explore feed (all posts, no follow filter).
 * GET /api/posts/explore?cursor=&limit=
 */
async function getExplore(req, res) {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const cursor = req.query.cursor || null;

    const whereClause = { reply_to_id: null };

    if (cursor) {
      whereClause.created_at = { [Op.lt]: new Date(cursor) };
    }

    const posts = await Post.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit,
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email'] }],
    });

    const postIds = posts.map((p) => p.id);
    const [likes, reposts] = await Promise.all([
      PostLike.findAll({ where: { post_id: { [Op.in]: postIds }, user_id: userId }, attributes: ['post_id'] }),
      Repost.findAll({ where: { post_id: { [Op.in]: postIds }, user_id: userId }, attributes: ['post_id'] }),
    ]);

    const likedSet = new Set(likes.map((l) => l.post_id));
    const repostedSet = new Set(reposts.map((r) => r.post_id));

    const enrichedPosts = posts.map((p) => ({
      ...p.toJSON(),
      is_liked_by_me: likedSet.has(p.id),
      is_reposted_by_me: repostedSet.has(p.id),
    }));

    const nextCursor =
      posts.length === limit ? posts[posts.length - 1].created_at.toISOString() : null;

    return res.json({ posts: enrichedPosts, nextCursor });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch explore feed.' });
  }
}

/**
 * Get a single post by ID.
 * GET /api/posts/:postId
 */
async function getPost(req, res) {
  try {
    const userId = req.user.userId;
    const post = await Post.findByPk(req.params.postId, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'email'] },
        { model: PostHashtag, as: 'hashtags', attributes: ['tag'] },
      ],
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const [like, repost] = await Promise.all([
      PostLike.findOne({ where: { post_id: post.id, user_id: userId } }),
      Repost.findOne({ where: { post_id: post.id, user_id: userId } }),
    ]);

    return res.json({
      post: {
        ...post.toJSON(),
        is_liked_by_me: !!like,
        is_reposted_by_me: !!repost,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch post.' });
  }
}

/**
 * Delete a post (owner only).
 * DELETE /api/posts/:postId
 */
async function deletePost(req, res) {
  try {
    const userId = req.user.userId;
    const post = await Post.findByPk(req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    if (post.user_id !== userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this post.' });
    }

    await post.destroy();
    return res.json({ message: 'Post deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete post.' });
  }
}

/**
 * Create a reply to a post.
 * POST /api/posts/:postId/replies
 */
async function createReply(req, res) {
  try {
    const { content } = req.body;
    const userId = req.user.userId;
    const parentId = req.params.postId;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Reply content is required.' });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({
        error: `Reply content must not exceed ${MAX_CONTENT_LENGTH} characters.`,
      });
    }

    const parent = await Post.findByPk(parentId);
    if (!parent) {
      return res.status(404).json({ error: 'Parent post not found.' });
    }

    const reply = await Post.create({
      user_id: userId,
      content: content.trim(),
      reply_to_id: parentId,
    });

    await parent.increment('reply_count');

    return res.status(201).json({ reply });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create reply.' });
  }
}

/**
 * Get replies for a post.
 * GET /api/posts/:postId/replies
 */
async function getReplies(req, res) {
  try {
    const replies = await Post.findAll({
      where: { reply_to_id: req.params.postId },
      order: [['created_at', 'ASC']],
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email'] }],
    });

    return res.json({ replies });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch replies.' });
  }
}

module.exports = {
  createPost,
  getFeed,
  getExplore,
  getPost,
  deletePost,
  createReply,
  getReplies,
};
