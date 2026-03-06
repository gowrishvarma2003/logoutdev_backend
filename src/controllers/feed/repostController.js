const { Post, Repost } = require('../../models');

/**
 * Repost a post.
 * POST /api/posts/:postId/repost
 */
async function repostPost(req, res) {
  try {
    const userId = req.user.userId;
    const originalPost = await Post.findByPk(req.params.postId);

    if (!originalPost) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    if (originalPost.user_id === userId) {
      return res.status(400).json({ error: 'You cannot repost your own post.' });
    }

    const [, created] = await Repost.findOrCreate({
      where: { post_id: originalPost.id, user_id: userId },
    });

    if (created) {
      // Create a synthetic repost entry in the posts table so it appears in feeds
      await Post.create({
        user_id: userId,
        content: originalPost.content,
        is_repost: true,
        original_post_id: originalPost.id,
      });

      await originalPost.increment('repost_count');
    }

    return res.json({
      reposted: true,
      repostCount: originalPost.repost_count + (created ? 1 : 0),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to repost.' });
  }
}

/**
 * Undo a repost.
 * DELETE /api/posts/:postId/repost
 */
async function undoRepost(req, res) {
  try {
    const userId = req.user.userId;
    const originalPost = await Post.findByPk(req.params.postId);

    if (!originalPost) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const destroyed = await Repost.destroy({
      where: { post_id: originalPost.id, user_id: userId },
    });

    if (destroyed > 0) {
      // Remove the synthetic repost Post entry
      await Post.destroy({
        where: {
          user_id: userId,
          is_repost: true,
          original_post_id: originalPost.id,
        },
      });

      await originalPost.decrement('repost_count');
    }

    return res.json({
      reposted: false,
      repostCount: originalPost.repost_count - (destroyed > 0 ? 1 : 0),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to undo repost.' });
  }
}

module.exports = { repostPost, undoRepost };
