const { Op } = require('sequelize');
const {
  sequelize,
  Launch,
  LaunchTechStack,
} = require('../../models');
const { parsePagination } = require('../../services/spaces/pagination');
const { asTrimmedString } = require('../../services/spaces/spaceValidation');
const {
  validateLaunchInput,
  validateLaunchForPublish,
} = require('../../services/launches/launchValidation');
const {
  getLaunchOr404,
  isLaunchOwner,
  canUserLinkSpace,
  buildLinkedSpaceSummary,
  buildLaunchViewerState,
} = require('../../services/launches/launchAccess');
const {
  getLaunchBaseInclude,
  getLaunchDetailInclude,
  generateUniqueLaunchSlug,
  replaceLaunchScreenshots,
  replaceLaunchTechStack,
} = require('../../services/launches/launchQueries');
const { getLaunchGraph } = require('../../services/workGraph/workGraphService');

function serializeLaunch(launch, { viewerState = null } = {}) {
  const json = launch.toJSON();
  json.linked_space = buildLinkedSpaceSummary(json.linked_space);
  if (viewerState) json.viewer_state = viewerState;
  return json;
}

async function listLaunches(req, res) {
  try {
    const q = asTrimmedString(req.query.q);
    const productType = asTrimmedString(req.query.product_type);
    const developmentStage = asTrimmedString(req.query.development_stage);
    const stack = asTrimmedString(req.query.stack);
    const sort = asTrimmedString(req.query.sort || 'newest');
    const seekingCollaborators = ['1', 'true', 'yes'].includes(String(req.query.seeking_collaborators || '').toLowerCase());
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 18, maxLimit: 100 });

    const where = { status: 'published' };
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { tagline: { [Op.iLike]: `%${q}%` } },
        { description: { [Op.iLike]: `%${q}%` } },
      ];
    }
    if (productType) where.product_type = productType;
    if (developmentStage) where.development_stage = developmentStage;
    if (seekingCollaborators) where.collaboration_mode = 'looking';

    const include = getLaunchBaseInclude({ stackRequired: Boolean(stack) });
    if (stack) {
      include[2].where = { technology: { [Op.iLike]: `%${stack}%` } };
    }

    const order = sort === 'top'
      ? [['upvote_count', 'DESC'], ['published_at', 'DESC'], ['created_at', 'DESC']]
      : [['published_at', 'DESC'], ['created_at', 'DESC']];

    const { count, rows } = await Launch.findAndCountAll({
      where,
      include,
      distinct: true,
      order,
      limit,
      offset,
    });

    return res.json({
      launches: rows.map((launch) => serializeLaunch(launch)),
      total: count,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch launches.' });
  }
}

async function listMyLaunches(req, res) {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { count, rows } = await Launch.findAndCountAll({
      where: { builder_id: req.user.userId },
      include: getLaunchBaseInclude(),
      distinct: true,
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });

    return res.json({
      launches: rows.map((launch) => serializeLaunch(launch)),
      total: count,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch your launches.' });
  }
}

async function getLaunch(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res, {
      include: getLaunchDetailInclude(),
    });
    if (!launch) return;

    const userId = req.user?.userId || null;
    const owner = isLaunchOwner(launch, userId);
    if (launch.status !== 'published' && !owner) {
      return res.status(404).json({ error: 'Launch not found.' });
    }

    const viewerState = await buildLaunchViewerState(launch, userId);
    const graph = await getLaunchGraph(launch, userId);
    return res.json({
      launch: {
        ...serializeLaunch(launch, { viewerState }),
        ...graph,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch launch.' });
  }
}

async function createLaunch(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const requestedStatus = req.body.status === 'published' || req.body.publish_now === true
      ? 'published'
      : 'draft';
    const validation = validateLaunchInput(req.body);
    if (validation.error) {
      await transaction.rollback();
      return res.status(400).json({ error: validation.error });
    }

    const payload = validation.data;
    if (requestedStatus === 'published') {
      const publishValidationError = validateLaunchForPublish({
        ...payload,
        screenshots: payload.screenshots || [],
      });
      if (publishValidationError) {
        await transaction.rollback();
        return res.status(400).json({ error: publishValidationError });
      }
    }

    if (payload.linked_space_id && !(await canUserLinkSpace(payload.linked_space_id, req.user.userId))) {
      await transaction.rollback();
      return res.status(403).json({ error: 'You must be an owner or maintainer of the linked space.' });
    }

    const slug = await generateUniqueLaunchSlug(payload.slug || payload.name, null, transaction);
    if (!slug) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Unable to generate a valid launch slug.' });
    }

    const launch = await Launch.create(
      {
        builder_id: req.user.userId,
        linked_space_id: payload.linked_space_id || null,
        name: payload.name,
        slug,
        tagline: payload.tagline,
        description: payload.description,
        product_type: payload.product_type,
        development_stage: payload.development_stage,
        demo_url: payload.demo_url || null,
        website_url: payload.website_url || null,
        github_url: payload.github_url || null,
        docs_url: payload.docs_url || null,
        collaboration_mode: payload.collaboration_mode || 'off',
        collaboration_note: payload.collaboration_note || null,
        collaboration_roles: payload.collaboration_roles || [],
        status: requestedStatus,
        published_at: requestedStatus === 'published' ? new Date() : null,
      },
      { transaction }
    );

    await replaceLaunchScreenshots(launch.id, payload.screenshots || [], transaction);
    await replaceLaunchTechStack(launch.id, payload.tech_stack || [], transaction);

    await transaction.commit();

    const hydrated = await Launch.findByPk(launch.id, { include: getLaunchDetailInclude() });
    return res.status(201).json({ launch: serializeLaunch(hydrated) });
  } catch (error) {
    await transaction.rollback();
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'This linked space or slug is already in use by another launch.' });
    }
    return res.status(500).json({ error: 'Failed to create launch.' });
  }
}

async function updateLaunch(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    if (!isLaunchOwner(launch, req.user.userId)) {
      await transaction.rollback();
      return res.status(403).json({ error: 'Only the builder can edit this launch.' });
    }

    const validation = validateLaunchInput(req.body, { partial: true });
    if (validation.error) {
      await transaction.rollback();
      return res.status(400).json({ error: validation.error });
    }

    const payload = validation.data;
    if (payload.linked_space_id && !(await canUserLinkSpace(payload.linked_space_id, req.user.userId))) {
      await transaction.rollback();
      return res.status(403).json({ error: 'You must be an owner or maintainer of the linked space.' });
    }

    const updates = { ...payload };
    delete updates.screenshots;
    delete updates.tech_stack;

    if (req.body.slug !== undefined || req.body.name !== undefined) {
      const nextSlug = await generateUniqueLaunchSlug(req.body.slug || payload.name || launch.name, launch.id, transaction);
      if (!nextSlug) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Unable to generate a valid launch slug.' });
      }
      updates.slug = nextSlug;
    }

    updates.updated_at = new Date();
    await launch.update(updates, { transaction });

    if (payload.screenshots) {
      await replaceLaunchScreenshots(launch.id, payload.screenshots, transaction);
    }

    if (payload.tech_stack) {
      await replaceLaunchTechStack(launch.id, payload.tech_stack, transaction);
    }

    await transaction.commit();

    const hydrated = await Launch.findByPk(launch.id, { include: getLaunchDetailInclude() });
    return res.json({ launch: serializeLaunch(hydrated) });
  } catch (error) {
    await transaction.rollback();
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'This linked space or slug is already in use by another launch.' });
    }
    return res.status(500).json({ error: 'Failed to update launch.' });
  }
}

async function publishLaunch(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, {
      transaction,
      include: getLaunchDetailInclude(),
    });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    if (!isLaunchOwner(launch, req.user.userId)) {
      await transaction.rollback();
      return res.status(403).json({ error: 'Only the builder can publish this launch.' });
    }

    const validationError = validateLaunchForPublish(launch.toJSON());
    if (validationError) {
      await transaction.rollback();
      return res.status(400).json({ error: validationError });
    }

    await launch.update(
      {
        status: 'published',
        published_at: launch.published_at || new Date(),
        updated_at: new Date(),
      },
      { transaction }
    );

    await transaction.commit();

    const hydrated = await Launch.findByPk(launch.id, { include: getLaunchDetailInclude() });
    return res.json({ launch: serializeLaunch(hydrated) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to publish launch.' });
  }
}

async function archiveLaunch(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    if (!isLaunchOwner(launch, req.user.userId)) {
      return res.status(403).json({ error: 'Only the builder can archive this launch.' });
    }

    await launch.update({ status: 'archived', updated_at: new Date() });
    const hydrated = await Launch.findByPk(launch.id, { include: getLaunchDetailInclude() });
    return res.json({ launch: serializeLaunch(hydrated) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to archive launch.' });
  }
}

module.exports = {
  listLaunches,
  listMyLaunches,
  getLaunch,
  createLaunch,
  updateLaunch,
  publishLaunch,
  archiveLaunch,
};
