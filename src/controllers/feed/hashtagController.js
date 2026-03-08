const { Op } = require('sequelize');
const {
  HashtagCatalog,
  HashtagRelation,
} = require('../../models');

const CACHE_TTL_MS = 45 * 1000;
const suggestionCache = new Map();

function normalizeHashtagQuery(value) {
  return String(value || '').trim().replace(/^#+/, '').toLowerCase().slice(0, 100);
}

function getCache(key) {
  const hit = suggestionCache.get(key);
  if (!hit) return null;
  if (hit.expires_at < Date.now()) {
    suggestionCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value) {
  suggestionCache.set(key, {
    value,
    expires_at: Date.now() + CACHE_TTL_MS,
  });
}

async function suggestHashtags(req, res) {
  try {
    const query = normalizeHashtagQuery(req.query.q);
    const context = normalizeHashtagQuery(req.query.context);
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 8);
    const cacheKey = `hashtags:${query}:${context}:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const where = query
      ? {
          normalized_tag: {
            [Op.iLike]: `${query}%`,
          },
        }
      : {};

    const hashtags = await HashtagCatalog.findAll({
      where,
      order: [['usage_count', 'DESC'], ['last_used_at', 'DESC']],
      limit,
    });

    const relatedWhere = context
      ? { tag: context }
      : hashtags[0]
        ? { tag: hashtags[0].normalized_tag }
        : null;

    const relatedTags = relatedWhere
      ? await HashtagRelation.findAll({
          where: relatedWhere,
          order: [['cooccurrence_count', 'DESC'], ['last_seen_at', 'DESC']],
          limit: 5,
        })
      : [];

    const payload = {
      hashtags: hashtags.map((tag) => ({
        tag: tag.display_tag,
        normalized_tag: tag.normalized_tag,
        usage_count: tag.usage_count,
        recent_post_count: tag.recent_post_count,
        unique_author_count: tag.unique_author_count,
      })),
      related_tags: relatedTags.map((tag) => ({
        tag: tag.related_tag,
        normalized_tag: tag.related_tag,
        cooccurrence_count: tag.cooccurrence_count,
      })),
    };

    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to suggest hashtags.' });
  }
}

async function getTrendingHashtags(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 6, 12);
    const cacheKey = `trending:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const tags = await HashtagCatalog.findAll({
      order: [['recent_post_count', 'DESC'], ['usage_count', 'DESC'], ['last_used_at', 'DESC']],
      limit,
    });

    const payload = {
      hashtags: tags.map((tag) => ({
        tag: tag.display_tag,
        normalized_tag: tag.normalized_tag,
        usage_count: tag.usage_count,
        recent_post_count: tag.recent_post_count,
      })),
    };

    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch trending hashtags.' });
  }
}

module.exports = {
  suggestHashtags,
  getTrendingHashtags,
};
