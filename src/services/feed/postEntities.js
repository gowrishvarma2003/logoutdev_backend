const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Post,
  PostHashtag,
  PostMention,
  HashtagCatalog,
  HashtagRelation,
  NotificationOutbox,
} = require('../../models');
const {
  normalizeUsername,
  isValidUsername,
} = require('../profiles/profileValidation');
const {
  buildEntityRef,
  emitUserNotification,
} = require('../notifications/notificationService');

const RECENT_WINDOW_DAYS = 30;
const MAX_HASHTAGS = 8;
const MAX_MENTIONS = 10;
const HASHTAG_REGEX = /(^|[^a-zA-Z0-9_])#([a-zA-Z0-9_]{1,100})/g;
const MENTION_REGEX = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{1,50})/g;

function getRecentCutoff(now = new Date()) {
  return new Date(now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function parsePostEntities(content) {
  const hashtags = [];
  const mentions = [];
  const seenHashtags = new Set();
  const seenMentions = new Set();

  let match;
  HASHTAG_REGEX.lastIndex = 0;
  while ((match = HASHTAG_REGEX.exec(content)) !== null) {
    const rawTag = String(match[2] || '').trim();
    const normalizedTag = rawTag.toLowerCase();
    if (!normalizedTag || seenHashtags.has(normalizedTag)) continue;
    seenHashtags.add(normalizedTag);
    hashtags.push({
      tag: normalizedTag,
      normalized_tag: normalizedTag,
      start_index: match.index + match[1].length,
      end_index: match.index + match[0].length,
    });
    if (hashtags.length >= MAX_HASHTAGS) break;
  }

  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    const normalized = normalizeUsername(match[2]);
    if (!normalized || !isValidUsername(normalized) || seenMentions.has(normalized)) continue;
    seenMentions.add(normalized);
    mentions.push({
      username: normalized,
      start_index: match.index + match[1].length,
      end_index: match.index + match[0].length,
    });
    if (mentions.length >= MAX_MENTIONS) break;
  }

  return { hashtags, mentions };
}

function buildHashtagPairs(tags) {
  const normalized = [...new Set(tags.map((tag) => tag.normalized_tag))].sort();
  const pairs = [];

  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      pairs.push([normalized[i], normalized[j]]);
    }
  }

  return pairs;
}

async function resolveMentions(parsedMentions, transaction) {
  if (!parsedMentions.length) return [];

  const usernames = parsedMentions.map((mention) => mention.username);
  const users = await User.findAll({
    where: { username: { [Op.in]: usernames } },
    attributes: ['id', 'username', 'name'],
    transaction,
  });

  const byUsername = new Map(users.map((user) => [user.username, user]));

  return parsedMentions
    .map((mention) => {
      const user = byUsername.get(mention.username);
      if (!user) return null;
      return {
        mentioned_user_id: user.id,
        username_snapshot: user.username,
        display_name: user.name,
        start_index: mention.start_index,
        end_index: mention.end_index,
      };
    })
    .filter(Boolean);
}

async function upsertPostEntities({
  post,
  authorId,
  content,
  transaction,
}) {
  const parsed = parsePostEntities(content);
  const resolvedMentions = await resolveMentions(parsed.mentions, transaction);
  const recentCutoff = getRecentCutoff(post.created_at ? new Date(post.created_at) : new Date());

  if (parsed.hashtags.length > 0) {
    await PostHashtag.destroy({ where: { post_id: post.id }, transaction });
    await PostHashtag.bulkCreate(
      parsed.hashtags.map((tag) => ({
        post_id: post.id,
        tag: tag.tag,
        normalized_tag: tag.normalized_tag,
        start_index: tag.start_index,
        end_index: tag.end_index,
      })),
      { transaction }
    );
  } else {
    await PostHashtag.destroy({ where: { post_id: post.id }, transaction });
  }

  await PostMention.destroy({ where: { post_id: post.id }, transaction });
  if (resolvedMentions.length > 0) {
    await PostMention.bulkCreate(
      resolvedMentions.map((mention) => ({
        post_id: post.id,
        mentioned_user_id: mention.mentioned_user_id,
        username_snapshot: mention.username_snapshot,
        start_index: mention.start_index,
        end_index: mention.end_index,
      })),
      { transaction }
    );
  }

  for (const tag of parsed.hashtags) {
    const existingCatalog = await HashtagCatalog.findOne({
      where: { normalized_tag: tag.normalized_tag },
      transaction,
    });

    const authorAlreadyUsed = await PostHashtag.findOne({
      where: {
        normalized_tag: tag.normalized_tag,
        post_id: { [Op.ne]: post.id },
      },
      include: [{
        model: Post,
        as: 'post',
        attributes: ['id'],
        where: { user_id: authorId },
        required: true,
      }],
      transaction,
    });

    if (!existingCatalog) {
      await HashtagCatalog.create({
        normalized_tag: tag.normalized_tag,
        display_tag: tag.tag,
        usage_count: 1,
        recent_post_count: post.created_at >= recentCutoff ? 1 : 0,
        unique_author_count: authorAlreadyUsed ? 0 : 1,
        last_used_at: post.created_at,
      }, { transaction });
    } else {
      existingCatalog.display_tag = tag.tag;
      existingCatalog.usage_count += 1;
      if (post.created_at >= recentCutoff) {
        existingCatalog.recent_post_count += 1;
      }
      if (!authorAlreadyUsed) {
        existingCatalog.unique_author_count += 1;
      }
      existingCatalog.last_used_at =
        !existingCatalog.last_used_at || existingCatalog.last_used_at < post.created_at
          ? post.created_at
          : existingCatalog.last_used_at;
      await existingCatalog.save({ transaction });
    }
  }

  const pairs = buildHashtagPairs(parsed.hashtags);
  for (const [tag, relatedTag] of pairs) {
    for (const [left, right] of [[tag, relatedTag], [relatedTag, tag]]) {
      const existing = await HashtagRelation.findOne({
        where: { tag: left, related_tag: right },
        transaction,
      });

      if (!existing) {
        await HashtagRelation.create({
          tag: left,
          related_tag: right,
          cooccurrence_count: 1,
          last_seen_at: post.created_at,
        }, { transaction });
      } else {
        existing.cooccurrence_count += 1;
        existing.last_seen_at =
          !existing.last_seen_at || existing.last_seen_at < post.created_at
            ? post.created_at
            : existing.last_seen_at;
        await existing.save({ transaction });
      }
    }
  }

  for (const mention of resolvedMentions) {
    if (mention.mentioned_user_id === authorId) continue;
    await NotificationOutbox.findOrCreate({
      where: { dedupe_key: `mention_created:${post.id}:${mention.mentioned_user_id}` },
      defaults: {
        event_type: 'mention_created',
        actor_user_id: authorId,
        recipient_user_id: mention.mentioned_user_id,
        post_id: post.id,
        payload: {
          post_id: post.id,
          actor_user_id: authorId,
          recipient_user_id: mention.mentioned_user_id,
          username: mention.username_snapshot,
        },
        created_at: post.created_at,
      },
      transaction,
    });

    await emitUserNotification({
      recipientUserId: mention.mentioned_user_id,
      actorUserId: authorId,
      eventType: 'mention_created',
      category: 'social',
      priority: 'important',
      entityType: 'post',
      entityId: post.id,
      entitySnapshot: buildEntityRef({
        type: 'post',
        id: post.id,
        title: content,
        href: `/post/${post.id}`,
      }),
      actionUrl: `/post/${post.id}`,
      previewText: 'mentioned you in a post',
      groupKey: `post:mention:${post.id}:${mention.mentioned_user_id}`,
      dedupeKey: `mention_created:${post.id}:${mention.mentioned_user_id}`,
      createdAt: post.created_at,
    }, { transaction });
  }

  return { hashtags: parsed.hashtags, mentions: resolvedMentions };
}

async function removePostEntities({ post, transaction }) {
  const hashtags = await PostHashtag.findAll({
    where: { post_id: post.id },
    transaction,
  });
  const mentions = await PostMention.findAll({
    where: { post_id: post.id },
    transaction,
  });
  const pairs = buildHashtagPairs(hashtags.map((tag) => ({
    normalized_tag: tag.normalized_tag || tag.tag,
  })));
  const recentCutoff = getRecentCutoff(post.created_at ? new Date(post.created_at) : new Date());

  for (const hashtag of hashtags) {
    const normalizedTag = hashtag.normalized_tag || hashtag.tag;
    const catalog = await HashtagCatalog.findOne({
      where: { normalized_tag: normalizedTag },
      transaction,
    });
    if (!catalog) continue;

    const authorStillUses = await PostHashtag.findOne({
      where: {
        normalized_tag: normalizedTag,
        post_id: { [Op.ne]: post.id },
      },
      include: [{
        model: Post,
        as: 'post',
        attributes: ['id'],
        where: { user_id: post.user_id },
        required: true,
      }],
      transaction,
    });

    catalog.usage_count = Math.max(0, catalog.usage_count - 1);
    if (post.created_at >= recentCutoff) {
      catalog.recent_post_count = Math.max(0, catalog.recent_post_count - 1);
    }
    if (!authorStillUses) {
      catalog.unique_author_count = Math.max(0, catalog.unique_author_count - 1);
    }

    const latestRemaining = await PostHashtag.findOne({
      where: {
        normalized_tag: normalizedTag,
        post_id: { [Op.ne]: post.id },
      },
      include: [{
        model: Post,
        as: 'post',
        attributes: ['created_at'],
        required: true,
      }],
      order: [[{ model: Post, as: 'post' }, 'created_at', 'DESC']],
      transaction,
    });

    catalog.last_used_at = latestRemaining?.post?.created_at || null;

    if (catalog.usage_count === 0) {
      await catalog.destroy({ transaction });
    } else {
      await catalog.save({ transaction });
    }
  }

  for (const [tag, relatedTag] of pairs) {
    for (const [left, right] of [[tag, relatedTag], [relatedTag, tag]]) {
      const relation = await HashtagRelation.findOne({
        where: { tag: left, related_tag: right },
        transaction,
      });
      if (!relation) continue;

      relation.cooccurrence_count = Math.max(0, relation.cooccurrence_count - 1);
      if (relation.cooccurrence_count === 0) {
        await relation.destroy({ transaction });
      } else {
        await relation.save({ transaction });
      }
    }
  }

  await PostHashtag.destroy({ where: { post_id: post.id }, transaction });
  await PostMention.destroy({ where: { post_id: post.id }, transaction });

  if (mentions.length > 0) {
    await NotificationOutbox.destroy({
      where: {
        post_id: post.id,
        event_type: 'mention_created',
      },
      transaction,
    });
  }
}

async function rebuildFeedEntityAggregates() {
  const transaction = await sequelize.transaction();
  try {
    const posts = await Post.findAll({
      attributes: ['id', 'user_id', 'content', 'created_at'],
      order: [['created_at', 'ASC']],
      transaction,
    });

    await PostHashtag.destroy({ where: {}, truncate: true, transaction });
    await PostMention.destroy({ where: {}, truncate: true, transaction });
    await HashtagCatalog.destroy({ where: {}, truncate: true, transaction });
    await HashtagRelation.destroy({ where: {}, truncate: true, transaction });
    await NotificationOutbox.destroy({
      where: { event_type: 'mention_created' },
      transaction,
    });

    for (const post of posts) {
      // eslint-disable-next-line no-await-in-loop
      await upsertPostEntities({
        post,
        authorId: post.user_id,
        content: post.content,
        transaction,
      });
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function shouldRebuildFeedEntityAggregates() {
  const [
    postCount,
    hashtagCount,
    mentionCount,
    catalogCount,
    relationCount,
    invalidHashtagCount,
    hashtagCandidate,
    mentionCandidate,
  ] = await Promise.all([
    Post.count(),
    PostHashtag.count(),
    PostMention.count(),
    HashtagCatalog.count(),
    HashtagRelation.count(),
    PostHashtag.count({
      where: {
        [Op.or]: [
          { normalized_tag: '' },
          { normalized_tag: null },
        ],
      },
    }),
    Post.findOne({
      where: { content: { [Op.iLike]: '%#%' } },
      attributes: ['id'],
    }),
    Post.findOne({
      where: { content: { [Op.iLike]: '%@%' } },
      attributes: ['id'],
    }),
  ]);

  if (postCount === 0) {
    return false;
  }

  if (invalidHashtagCount > 0) {
    return true;
  }

  if (hashtagCandidate && (catalogCount === 0 || (hashtagCount > 1 && relationCount === 0))) {
    return true;
  }

  if (mentionCandidate && mentionCount === 0) {
    return true;
  }

  if (!hashtagCandidate && (hashtagCount > 0 || catalogCount > 0 || relationCount > 0)) {
    return true;
  }

  return false;
}

async function ensureFeedEntityAggregates() {
  if (await shouldRebuildFeedEntityAggregates()) {
    await rebuildFeedEntityAggregates();
  }
}

function getPostEntityIncludes() {
  return [
    {
      model: PostHashtag,
      as: 'hashtags',
      attributes: ['id', 'tag', 'normalized_tag', 'start_index', 'end_index'],
      required: false,
    },
    {
      model: PostMention,
      as: 'mentions',
      attributes: ['id', 'mentioned_user_id', 'username_snapshot', 'start_index', 'end_index'],
      required: false,
      include: [{
        model: User,
        as: 'mentioned_user',
        attributes: ['id', 'username', 'name'],
        required: false,
      }],
    },
  ];
}

async function attachHashtagUsageCounts(posts) {
  const tags = [...new Set(
    posts.flatMap((post) => (post.hashtags || []).map((tag) => tag.normalized_tag || tag.tag))
  )];

  if (!tags.length) return posts;

  const catalogRows = await HashtagCatalog.findAll({
    where: { normalized_tag: { [Op.in]: tags } },
    attributes: ['normalized_tag', 'usage_count'],
  });
  const usageMap = new Map(catalogRows.map((row) => [row.normalized_tag, row.usage_count]));

  return posts.map((post) => ({
    ...post,
    hashtags: (post.hashtags || []).map((tag) => ({
      ...tag,
      usage_count: usageMap.get(tag.normalized_tag || tag.tag) || 0,
    })),
  }));
}

function serializeMention(mention) {
  return {
    id: mention.id,
    user_id: mention.mentioned_user_id,
    username: mention.mentioned_user?.username || mention.username_snapshot,
    display_name: mention.mentioned_user?.name || null,
    start_index: mention.start_index,
    end_index: mention.end_index,
  };
}

function serializeHashtag(tag) {
  return {
    id: tag.id,
    tag: tag.tag,
    normalized_tag: tag.normalized_tag || tag.tag,
    start_index: tag.start_index,
    end_index: tag.end_index,
    usage_count: tag.usage_count,
  };
}

function serializePostEntities(post) {
  return {
    ...post,
    hashtags: (post.hashtags || []).map(serializeHashtag).sort((a, b) => a.start_index - b.start_index),
    mentions: (post.mentions || []).map(serializeMention).sort((a, b) => a.start_index - b.start_index),
  };
}

module.exports = {
  MAX_HASHTAGS,
  MAX_MENTIONS,
  RECENT_WINDOW_DAYS,
  parsePostEntities,
  resolveMentions,
  upsertPostEntities,
  removePostEntities,
  rebuildFeedEntityAggregates,
  ensureFeedEntityAggregates,
  getPostEntityIncludes,
  attachHashtagUsageCounts,
  serializePostEntities,
};
