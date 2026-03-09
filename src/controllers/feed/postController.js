const { Op } = require('sequelize');
const {
  sequelize,
  Post,
  PostHashtag,
  PostLike,
  Repost,
  Follow,
  User,
  HashtagRelation,
} = require('../../models');
const {
  upsertPostEntities,
  removePostEntities,
  getPostEntityIncludes,
  attachHashtagUsageCounts,
  serializePostEntities,
} = require('../../services/feed/postEntities');
const {
  buildEntityRef,
  emitUserNotification,
} = require('../../services/notifications/notificationService');
const {
  LINKED_ENTITY_TYPES,
  resolveLinkedEntity,
} = require('../../services/workGraph/workGraphService');

const MAX_CONTENT_LENGTH = 500;
const AUTHOR_ATTRIBUTES = ['id', 'name', 'email', 'username'];

function normalizeTag(value) {
  return String(value || '').trim().replace(/^#+/, '').toLowerCase().slice(0, 100);
}

function getBaseIncludes() {
  return [
    { model: User, as: 'author', attributes: AUTHOR_ATTRIBUTES },
    ...getPostEntityIncludes(),
  ];
}

async function enrichPosts(posts, userId) {
  const postIds = posts.map((post) => post.id);
  let likedSet = new Set();
  let repostedSet = new Set();

  if (postIds.length > 0 && userId) {
    const [likes, reposts] = await Promise.all([
      PostLike.findAll({
        where: { post_id: { [Op.in]: postIds }, user_id: userId },
        attributes: ['post_id'],
      }),
      Repost.findAll({
        where: { post_id: { [Op.in]: postIds }, user_id: userId },
        attributes: ['post_id'],
      }),
    ]);

    likedSet = new Set(likes.map((item) => item.post_id));
    repostedSet = new Set(reposts.map((item) => item.post_id));
  }

  const serialized = posts.map((post) => serializePostEntities({
    ...post.toJSON(),
    is_liked_by_me: likedSet.has(post.id),
    is_reposted_by_me: repostedSet.has(post.id),
  }));

  const enrichedWithHashtags = await attachHashtagUsageCounts(serialized);
  const linkedEntities = await Promise.all(
    enrichedWithHashtags.map((post) => (
      post.linked_entity_type && post.linked_entity_id
        ? resolveLinkedEntity(post.linked_entity_type, post.linked_entity_id, userId)
        : null
    ))
  );

  return enrichedWithHashtags.map((post, index) => ({
    ...post,
    linked_entity: linkedEntities[index],
  }));
}

async function createPost(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const { content } = req.body;
    const userId = req.user.userId;
    const linkedEntityType = typeof req.body.linked_entity_type === 'string'
      ? req.body.linked_entity_type.trim()
      : null;
    const linkedEntityId = typeof req.body.linked_entity_id === 'string'
      ? req.body.linked_entity_id.trim()
      : null;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Post content is required.' });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      await transaction.rollback();
      return res.status(400).json({
        error: `Post content must not exceed ${MAX_CONTENT_LENGTH} characters.`,
      });
    }

    if (linkedEntityType || linkedEntityId) {
      if (!LINKED_ENTITY_TYPES.includes(linkedEntityType) || !linkedEntityId) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Invalid linked entity.' });
      }

      const linkedEntity = await resolveLinkedEntity(linkedEntityType, linkedEntityId, userId);
      if (!linkedEntity) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Linked entity not found or not accessible.' });
      }
    }

    const post = await Post.create({
      user_id: userId,
      content: content.trim(),
      linked_entity_type: linkedEntityType,
      linked_entity_id: linkedEntityId,
    }, { transaction });

    await upsertPostEntities({
      post,
      authorId: userId,
      content: post.content,
      transaction,
    });

    const createdPost = await Post.findByPk(post.id, {
      include: getBaseIncludes(),
      transaction,
    });

    await transaction.commit();

    const [enrichedPost] = await enrichPosts([createdPost], userId);
    return res.status(201).json({ post: enrichedPost });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to create post.' });
  }
}

async function getFeed(req, res) {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const cursor = req.query.cursor || null;

    const follows = await Follow.findAll({
      where: { follower_id: userId },
      attributes: ['following_id'],
    });
    const followingIds = follows.map((f) => f.following_id);
    const feedUserIds = [...new Set([userId, ...followingIds])];

    const whereClause = {
      user_id: { [Op.in]: feedUserIds },
      reply_to_id: null,
    };

    if (cursor) {
      whereClause.created_at = { [Op.lt]: new Date(cursor) };
    }

    const posts = await Post.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit,
      include: getBaseIncludes(),
      distinct: true,
    });

    const enrichedPosts = await enrichPosts(posts, userId);
    const nextCursor =
      posts.length === limit ? posts[posts.length - 1].created_at.toISOString() : null;

    return res.json({ posts: enrichedPosts, nextCursor });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch feed.' });
  }
}

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
      include: getBaseIncludes(),
      distinct: true,
    });

    const enrichedPosts = await enrichPosts(posts, userId);
    const nextCursor =
      posts.length === limit ? posts[posts.length - 1].created_at.toISOString() : null;

    return res.json({ posts: enrichedPosts, nextCursor });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch explore feed.' });
  }
}

async function getPost(req, res) {
  try {
    const userId = req.user.userId;
    const post = await Post.findByPk(req.params.postId, {
      include: getBaseIncludes(),
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const [enrichedPost] = await enrichPosts([post], userId);
    return res.json({ post: enrichedPost });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch post.' });
  }
}

async function deletePost(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const userId = req.user.userId;
    const post = await Post.findByPk(req.params.postId, { transaction });

    if (!post) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Post not found.' });
    }

    if (post.user_id !== userId) {
      await transaction.rollback();
      return res.status(403).json({ error: 'You do not have permission to delete this post.' });
    }

    await removePostEntities({ post, transaction });

    if (post.reply_to_id) {
      const parent = await Post.findByPk(post.reply_to_id, { transaction });
      if (parent) {
        await parent.decrement('reply_count', { by: 1, transaction });
      }
    }

    await post.destroy({ transaction });
    await transaction.commit();
    return res.json({ message: 'Post deleted successfully.' });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to delete post.' });
  }
}

async function createReply(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const { content } = req.body;
    const userId = req.user.userId;
    const parentId = req.params.postId;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Reply content is required.' });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      await transaction.rollback();
      return res.status(400).json({
        error: `Reply content must not exceed ${MAX_CONTENT_LENGTH} characters.`,
      });
    }

    const parent = await Post.findByPk(parentId, { transaction });
    if (!parent) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Parent post not found.' });
    }

    const reply = await Post.create({
      user_id: userId,
      content: content.trim(),
      reply_to_id: parentId,
    }, { transaction });

    await upsertPostEntities({
      post: reply,
      authorId: userId,
      content: reply.content,
      transaction,
    });

    await parent.increment('reply_count', { by: 1, transaction });

    await emitUserNotification({
      recipientUserId: parent.user_id,
      actorUserId: userId,
      eventType: 'post_replied',
      category: 'social',
      priority: 'important',
      entityType: 'post',
      entityId: parent.id,
      entitySnapshot: buildEntityRef({
        type: 'post',
        id: parent.id,
        title: parent.content,
        href: `/post/${parent.id}`,
      }),
      secondaryEntityType: 'post',
      secondaryEntityId: reply.id,
      secondarySnapshot: buildEntityRef({
        type: 'post',
        id: reply.id,
        title: reply.content,
        href: `/post/${parent.id}`,
      }),
      actionUrl: `/post/${parent.id}`,
      previewText: 'replied to your post',
      groupKey: `post:reply:${parent.id}:${parent.user_id}`,
      dedupeKey: `post_replied:${reply.id}:${parent.user_id}`,
      createdAt: reply.created_at,
    }, { transaction });

    const createdReply = await Post.findByPk(reply.id, {
      include: getBaseIncludes(),
      transaction,
    });

    await transaction.commit();

    const [enrichedReply] = await enrichPosts([createdReply], userId);
    return res.status(201).json({ reply: enrichedReply });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to create reply.' });
  }
}

async function getReplies(req, res) {
  try {
    const userId = req.user.userId;
    const replies = await Post.findAll({
      where: { reply_to_id: req.params.postId },
      order: [['created_at', 'ASC']],
      include: getBaseIncludes(),
    });

    const enrichedReplies = await enrichPosts(replies, userId);
    return res.json({ replies: enrichedReplies });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch replies.' });
  }
}

async function getPostsByHashtag(req, res) {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const cursor = req.query.cursor || null;
    const tag = normalizeTag(req.query.tag);

    if (!tag) {
      return res.status(400).json({ error: 'Hashtag is required.' });
    }

    const hashtagWhere = { normalized_tag: tag };
    const include = [{
      model: Post,
      as: 'post',
      attributes: ['id', 'created_at'],
      where: { reply_to_id: null },
      required: true,
    }];

    if (cursor) {
      include[0].where.created_at = { [Op.lt]: new Date(cursor) };
    }

    const hashtagRows = await PostHashtag.findAll({
      where: hashtagWhere,
      include,
      order: [[{ model: Post, as: 'post' }, 'created_at', 'DESC']],
      limit,
    });

    const postIds = hashtagRows.map((row) => row.post_id);
    const posts = postIds.length > 0
      ? await Post.findAll({
          where: { id: { [Op.in]: postIds } },
          include: getBaseIncludes(),
          order: [['created_at', 'DESC']],
        })
      : [];

    const relatedTags = await HashtagRelation.findAll({
      where: { tag },
      order: [['cooccurrence_count', 'DESC'], ['last_seen_at', 'DESC']],
      limit: 5,
    });

    const enrichedPosts = await enrichPosts(posts, userId);
    const nextCursor =
      hashtagRows.length === limit
        ? hashtagRows[hashtagRows.length - 1].post.created_at.toISOString()
        : null;

    return res.json({
      tag,
      posts: enrichedPosts,
      nextCursor,
      related_tags: relatedTags.map((row) => ({
        tag: row.related_tag,
        normalized_tag: row.related_tag,
        cooccurrence_count: row.cooccurrence_count,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch posts for hashtag.' });
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
  getPostsByHashtag,
};
