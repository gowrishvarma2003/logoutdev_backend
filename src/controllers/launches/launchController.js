const { Op } = require('sequelize');
const {
  sequelize,
  Launch,
  LaunchBetaRegistration,
  LaunchFeedbackComment,
  LaunchFeedbackItem,
  LaunchReview,
  LaunchScreenshot,
  LaunchTechStack,
  LaunchUpvote,
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
  getLaunchBetaSummary,
  getLaunchEarlySupporters,
} = require('../../services/launches/launchAccess');
const {
  getLaunchBaseInclude,
  getLaunchDetailInclude,
  generateUniqueLaunchSlug,
  replaceLaunchScreenshots,
  replaceLaunchTechStack,
  refreshLaunchCounts,
} = require('../../services/launches/launchQueries');
const { getLaunchGraph } = require('../../services/workGraph/workGraphService');

async function rollbackIfNeeded(transaction) {
  if (transaction && !transaction.finished) {
    await transaction.rollback();
  }
}

function serializeLaunch(launch, { viewerState = null } = {}) {
  const json = launch.toJSON();
  json.linked_space = buildLinkedSpaceSummary(json.linked_space);
  if (viewerState) json.viewer_state = viewerState;
  return json;
}

async function enrichLaunchResponse(launch, userId = null, { includeGraph = false } = {}) {
  const viewerState = await buildLaunchViewerState(launch, userId);
  const betaSummary = await getLaunchBetaSummary(launch.id, launch.beta_capacity);
  const earlySupporters = launch.launch_phase === 'live'
    ? await getLaunchEarlySupporters(launch.id)
    : { total: 0, users: [] };
  const base = {
    ...serializeLaunch(launch, { viewerState }),
    beta_summary: betaSummary,
    early_supporters: earlySupporters.users,
    early_supporter_count: earlySupporters.total,
  };

  if (!includeGraph) return base;
  return {
    ...base,
    ...(await getLaunchGraph(launch, userId)),
  };
}

function buildPhaseTimestamps(launchPhase, { publishedAt = null, now = new Date() } = {}) {
  if (launchPhase === 'beta') {
    return {
      published_at: publishedAt || now,
      beta_opened_at: now,
      went_live_at: null,
    };
  }

  return {
    published_at: publishedAt || now,
    beta_opened_at: null,
    went_live_at: now,
  };
}

async function listLaunches(req, res) {
  try {
    const q = asTrimmedString(req.query.q);
    const productType = asTrimmedString(req.query.product_type);
    const developmentStage = asTrimmedString(req.query.development_stage);
    const launchPhase = asTrimmedString(req.query.launch_phase);
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
    if (launchPhase) where.launch_phase = launchPhase;
    if (seekingCollaborators) where.collaboration_mode = 'looking';

    const include = getLaunchBaseInclude({ stackRequired: Boolean(stack) });
    if (stack) {
      include[2].where = { technology: { [Op.iLike]: `%${stack}%` } };
    }

    const recencyOrder = launchPhase === 'beta'
      ? [['beta_opened_at', 'DESC'], ['published_at', 'DESC'], ['created_at', 'DESC']]
      : launchPhase === 'live'
        ? [['went_live_at', 'DESC'], ['published_at', 'DESC'], ['created_at', 'DESC']]
        : [['published_at', 'DESC'], ['created_at', 'DESC']];

    const order = sort === 'top'
      ? [['upvote_count', 'DESC'], ...recencyOrder]
      : recencyOrder;

    const { count, rows } = await Launch.findAndCountAll({
      where,
      include,
      distinct: true,
      order,
      limit,
      offset,
    });

    return res.json({
      launches: await Promise.all(rows.map((launch) => enrichLaunchResponse(launch, req.user?.userId || null))),
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
      launches: await Promise.all(rows.map((launch) => enrichLaunchResponse(launch, req.user.userId))),
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

    return res.json({
      launch: await enrichLaunchResponse(launch, userId, { includeGraph: true }),
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
        launch_phase: payload.launch_phase || 'live',
        beta_capacity: payload.beta_capacity || null,
        beta_access_url: payload.beta_access_url || null,
        live_url: payload.live_url || payload.demo_url || payload.website_url || null,
        demo_url: payload.demo_url || null,
        website_url: payload.website_url || null,
        github_url: payload.github_url || null,
        docs_url: payload.docs_url || null,
        collaboration_mode: payload.collaboration_mode || 'off',
        collaboration_note: payload.collaboration_note || null,
        collaboration_roles: payload.collaboration_roles || [],
        status: requestedStatus,
        ...(requestedStatus === 'published'
          ? buildPhaseTimestamps(payload.launch_phase || 'live', { now: new Date() })
          : {}),
      },
      { transaction }
    );

    await replaceLaunchScreenshots(launch.id, payload.screenshots || [], transaction);
    await replaceLaunchTechStack(launch.id, payload.tech_stack || [], transaction);

    await transaction.commit();

    const hydrated = await Launch.findByPk(launch.id, { include: getLaunchDetailInclude() });
    return res.status(201).json({ launch: await enrichLaunchResponse(hydrated, req.user.userId) });
  } catch (error) {
    await rollbackIfNeeded(transaction);
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
    if (payload.launch_phase && launch.status === 'published' && payload.launch_phase !== launch.launch_phase) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Use the go-live action to move a published beta launch to live.' });
    }

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
    return res.json({ launch: await enrichLaunchResponse(hydrated, req.user.userId) });
  } catch (error) {
    await rollbackIfNeeded(transaction);
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
        ...buildPhaseTimestamps(launch.launch_phase, { publishedAt: launch.published_at, now: new Date() }),
        updated_at: new Date(),
      },
      { transaction }
    );

    await transaction.commit();

    const hydrated = await Launch.findByPk(launch.id, { include: getLaunchDetailInclude() });
    return res.json({ launch: await enrichLaunchResponse(hydrated, req.user.userId) });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    return res.status(500).json({ error: 'Failed to publish launch.' });
  }
}

async function goLiveLaunch(req, res) {
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
      return res.status(403).json({ error: 'Only the builder can move this launch live.' });
    }

    if (launch.status !== 'published' || launch.launch_phase !== 'beta') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Only a published beta launch can go live.' });
    }

    const nextLiveUrl = asTrimmedString(req.body.live_url) || launch.live_url || launch.demo_url || launch.website_url || null;
    const validationError = validateLaunchForPublish({
      ...launch.toJSON(),
      launch_phase: 'live',
      live_url: nextLiveUrl,
    });
    if (validationError) {
      await transaction.rollback();
      return res.status(400).json({ error: validationError });
    }

    await launch.update(
      {
        launch_phase: 'live',
        live_url: nextLiveUrl,
        went_live_at: new Date(),
        updated_at: new Date(),
      },
      { transaction }
    );

    await refreshLaunchCounts(launch.id, transaction);
    await transaction.commit();

    const hydrated = await Launch.findByPk(launch.id, { include: getLaunchDetailInclude() });
    return res.json({ launch: await enrichLaunchResponse(hydrated, req.user.userId) });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    return res.status(500).json({ error: 'Failed to move launch live.' });
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
    return res.json({ launch: await enrichLaunchResponse(hydrated, req.user.userId) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to archive launch.' });
  }
}

async function deleteLaunch(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    if (!isLaunchOwner(launch, req.user.userId)) {
      await transaction.rollback();
      return res.status(403).json({ error: 'Only the builder can delete this launch.' });
    }

    const feedbackItems = await LaunchFeedbackItem.findAll({
      where: { launch_id: launch.id },
      attributes: ['id'],
      transaction,
    });
    const feedbackIds = feedbackItems.map((item) => item.id);

    if (feedbackIds.length > 0) {
      await LaunchFeedbackComment.destroy({
        where: { feedback_id: { [Op.in]: feedbackIds } },
        transaction,
      });
    }

    await LaunchFeedbackItem.destroy({ where: { launch_id: launch.id }, transaction });
    await LaunchBetaRegistration.destroy({ where: { launch_id: launch.id }, transaction });
    await LaunchReview.destroy({ where: { launch_id: launch.id }, transaction });
    await LaunchUpvote.destroy({ where: { launch_id: launch.id }, transaction });
    await LaunchScreenshot.destroy({ where: { launch_id: launch.id }, transaction });
    await LaunchTechStack.destroy({ where: { launch_id: launch.id }, transaction });
    await Launch.destroy({ where: { id: launch.id }, transaction });

    await transaction.commit();
    return res.json({ deleted: true, launch_id: launch.id });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    return res.status(500).json({ error: 'Failed to delete launch.' });
  }
}

module.exports = {
  listLaunches,
  listMyLaunches,
  getLaunch,
  createLaunch,
  updateLaunch,
  publishLaunch,
  goLiveLaunch,
  archiveLaunch,
  deleteLaunch,
};
