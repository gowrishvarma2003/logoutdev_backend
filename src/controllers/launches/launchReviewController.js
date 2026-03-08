const { sequelize, Launch, LaunchReview } = require('../../models');
const { parsePagination } = require('../../services/spaces/pagination');
const { getLaunchOr404, isLaunchOwner } = require('../../services/launches/launchAccess');
const { validateLaunchReviewInput } = require('../../services/launches/launchValidation');
const { getReviewInclude, refreshLaunchCounts } = require('../../services/launches/launchQueries');

async function listLaunchReviews(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    if (launch.status !== 'published' && !isLaunchOwner(launch, req.user?.userId || null)) {
      return res.status(404).json({ error: 'Launch not found.' });
    }

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { count, rows } = await LaunchReview.findAndCountAll({
      where: { launch_id: launch.id },
      include: getReviewInclude(),
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return res.json({ reviews: rows, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch launch reviews.' });
  }
}

async function upsertMyReview(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    if (launch.status !== 'published') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Only published launches can be reviewed.' });
    }

    if (isLaunchOwner(launch, req.user.userId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Builders cannot review their own launch.' });
    }

    const validation = validateLaunchReviewInput(req.body);
    if (validation.error) {
      await transaction.rollback();
      return res.status(400).json({ error: validation.error });
    }

    const payload = validation.data;
    const existing = await LaunchReview.findOne({
      where: { launch_id: launch.id, author_id: req.user.userId },
      transaction,
    });

    let review;
    if (existing) {
      review = await existing.update({ ...payload, updated_at: new Date() }, { transaction });
    } else {
      review = await LaunchReview.create(
        { launch_id: launch.id, author_id: req.user.userId, ...payload },
        { transaction }
      );
    }

    await refreshLaunchCounts(launch.id, transaction);
    await transaction.commit();

    const hydrated = await LaunchReview.findByPk(review.id, { include: getReviewInclude() });
    return res.json({ review: hydrated });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to save launch review.' });
  }
}

async function deleteMyReview(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    await LaunchReview.destroy({
      where: { launch_id: launch.id, author_id: req.user.userId },
      transaction,
    });

    await refreshLaunchCounts(launch.id, transaction);
    await transaction.commit();

    return res.json({ deleted: true });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to delete launch review.' });
  }
}

module.exports = {
  listLaunchReviews,
  upsertMyReview,
  deleteMyReview,
};