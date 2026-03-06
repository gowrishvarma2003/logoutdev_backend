const { Post, PostLike } = require('../../models');

/**
 * Like a post.
 * POST /api/posts/:postId/like
 */
async function likePost(req, res) {
  try {
    const userId = req.user.userId;
    const post = await Post.findByPk(req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const [, created] = await PostLike.findOrCreate({
      where: { post_id: post.id, user_id: userId },
    });

    if (created) {
      await post.increment('like_count');
    }

    return res.json({ liked: true, likeCount: post.like_count + (created ? 1 : 0) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to like post.' });
  }
}

/**
 * Unlike a post.
 * DELETE /api/posts/:postId/like
 */
async function unlikePost(req, res) {
  try {
    const userId = req.user.userId;
    const post = await Post.findByPk(req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const destroyed = await PostLike.destroy({
      where: { post_id: post.id, user_id: userId },
    });

    if (destroyed > 0) {
      await post.decrement('like_count');
    }

    return res.json({ liked: false, likeCount: post.like_count - (destroyed > 0 ? 1 : 0) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to unlike post.' });
  }
}

module.exports = { likePost, unlikePost };
