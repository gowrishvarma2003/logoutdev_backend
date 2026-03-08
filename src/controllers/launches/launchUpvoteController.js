const { sequelize, Launch, LaunchUpvote } = require('../../models');
const { getLaunchOr404, isLaunchOwner } = require('../../services/launches/launchAccess');
const { refreshLaunchCounts } = require('../../services/launches/launchQueries');

async function upvoteLaunch(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    if (launch.status !== 'published') {
      await transaction.rollback();
      return res.status(404).json({ error: 'Launch not found.' });
    }

    if (isLaunchOwner(launch, req.user.userId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Builders cannot upvote their own launch.' });
    }

    await LaunchUpvote.findOrCreate({
      where: { launch_id: launch.id, user_id: req.user.userId },
      defaults: { launch_id: launch.id, user_id: req.user.userId },
      transaction,
    });

    await refreshLaunchCounts(launch.id, transaction);
    await transaction.commit();

    const refreshed = await Launch.findByPk(launch.id, { attributes: ['id', 'upvote_count'] });
    return res.json({ upvoted: true, upvote_count: refreshed.upvote_count });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to upvote launch.' });
  }
}

async function removeLaunchUpvote(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    await LaunchUpvote.destroy({
      where: { launch_id: launch.id, user_id: req.user.userId },
      transaction,
    });

    await refreshLaunchCounts(launch.id, transaction);
    await transaction.commit();

    const refreshed = await Launch.findByPk(launch.id, { attributes: ['id', 'upvote_count'] });
    return res.json({ upvoted: false, upvote_count: refreshed.upvote_count });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to remove launch upvote.' });
  }
}

module.exports = {
  upvoteLaunch,
  removeLaunchUpvote,
};