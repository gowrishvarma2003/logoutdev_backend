const { Op } = require('sequelize');
const {
  ProjectSpace,
  ProjectSpaceMember,
  Question,
  Launch,
  FreelanceProject,
} = require('../../models');

const ENTITY_SUGGEST_CACHE_TTL_MS = 45 * 1000;
const entitySuggestCache = new Map();

function getCache(key) {
  const entry = entitySuggestCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > ENTITY_SUGGEST_CACHE_TTL_MS) {
    entitySuggestCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  if (entitySuggestCache.size > 500) entitySuggestCache.clear();
  entitySuggestCache.set(key, { value, time: Date.now() });
}

const VALID_TYPES = new Set(['space', 'question', 'launch', 'freelance_project']);
const MAX_PER_TYPE = 3;

async function suggestEntities(req, res) {
  try {
    const rawQuery = String(req.query.q || '').trim().toLowerCase();
    if (rawQuery.length < 2) {
      return res.json({ entities: [] });
    }

    const requestedTypes = req.query.types
      ? String(req.query.types).split(',').filter((t) => VALID_TYPES.has(t.trim()))
      : [...VALID_TYPES];

    const viewerId = req.user?.userId || null;
    const cacheKey = `${rawQuery}:${requestedTypes.sort().join(',')}:${viewerId || 'anon'}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const results = [];

    // Search spaces
    if (requestedTypes.includes('space')) {
      const spaces = await ProjectSpace.findAll({
        where: {
          name: { [Op.iLike]: `%${rawQuery}%` },
          [Op.or]: [
            { visibility: 'public' },
            ...(viewerId ? [{ owner_id: viewerId }] : []),
          ],
        },
        attributes: ['id', 'name', 'summary', 'visibility'],
        order: [['updated_at', 'DESC']],
        limit: MAX_PER_TYPE,
      });

      // Also include private spaces where user is a member
      let memberSpaceIds = new Set();
      if (viewerId) {
        const memberships = await ProjectSpaceMember.findAll({
          where: { user_id: viewerId },
          attributes: ['space_id'],
        });
        memberSpaceIds = new Set(memberships.map((m) => m.space_id));
      }

      for (const space of spaces) {
        if (space.visibility !== 'public' && space.owner_id !== viewerId && !memberSpaceIds.has(space.id)) {
          continue;
        }
        results.push({
          type: 'space',
          id: space.id,
          name: space.name,
          subtitle: space.summary || null,
          href: `/spaces/${space.id}`,
        });
      }
    }

    // Search questions
    if (requestedTypes.includes('question')) {
      const questions = await Question.findAll({
        where: {
          title: { [Op.iLike]: `%${rawQuery}%` },
        },
        attributes: ['id', 'title', 'body'],
        order: [['latest_activity_at', 'DESC']],
        limit: MAX_PER_TYPE,
      });

      for (const question of questions) {
        results.push({
          type: 'question',
          id: question.id,
          name: question.title,
          subtitle: question.body ? question.body.slice(0, 100) : null,
          href: `/questions/${question.id}`,
        });
      }
    }

    // Search launches
    if (requestedTypes.includes('launch')) {
      const launches = await Launch.findAll({
        where: {
          name: { [Op.iLike]: `%${rawQuery}%` },
          status: 'published',
        },
        attributes: ['id', 'name', 'tagline'],
        order: [['published_at', 'DESC']],
        limit: MAX_PER_TYPE,
      });

      for (const launch of launches) {
        results.push({
          type: 'launch',
          id: launch.id,
          name: launch.name,
          subtitle: launch.tagline || null,
          href: `/launches/${launch.id}`,
        });
      }
    }

    // Search freelance projects
    if (requestedTypes.includes('freelance_project')) {
      const projects = await FreelanceProject.findAll({
        where: {
          title: { [Op.iLike]: `%${rawQuery}%` },
          status: { [Op.in]: ['open', 'in_review', 'awarded'] },
        },
        attributes: ['id', 'title', 'summary'],
        order: [['updated_at', 'DESC']],
        limit: MAX_PER_TYPE,
      });

      for (const project of projects) {
        results.push({
          type: 'freelance_project',
          id: project.id,
          name: project.title,
          subtitle: project.summary ? project.summary.slice(0, 100) : null,
          href: `/freelance/${project.id}`,
        });
      }
    }

    const payload = { entities: results };
    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    console.error('Entity suggest error:', error);
    return res.status(500).json({ error: 'Failed to suggest entities.' });
  }
}

module.exports = { suggestEntities };
