const {
  Launch,
  LaunchBetaRegistration,
  User,
  sequelize,
} = require('../../models');
const {
  getLaunchOr404,
  isLaunchOwner,
} = require('../../services/launches/launchAccess');
const { validateBetaRegistrationInput } = require('../../services/launches/launchValidation');
const { refreshLaunchCounts } = require('../../services/launches/launchQueries');

async function rollbackIfNeeded(transaction) {
  if (transaction && !transaction.finished) {
    await transaction.rollback();
  }
}

function serializeRegistration(registration) {
  return {
    ...registration.toJSON(),
    user: registration.user ? {
      id: registration.user.id,
      name: registration.user.name,
      username: registration.user.username,
      headline: registration.user.headline,
    } : null,
    reviewer: registration.reviewer ? {
      id: registration.reviewer.id,
      name: registration.reviewer.name,
      username: registration.reviewer.username,
      headline: registration.reviewer.headline,
    } : null,
  };
}

async function ensureBetaLaunch(launch, res) {
  if (!launch) return false;
  if (launch.status !== 'published' || launch.launch_phase !== 'beta') {
    res.status(400).json({ error: 'This launch is not currently in public beta.' });
    return false;
  }
  return true;
}

async function requestBetaRegistration(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    if (!(await ensureBetaLaunch(launch, res))) {
      await transaction.rollback();
      return;
    }

    if (isLaunchOwner(launch, req.user.userId)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Builders cannot register for their own beta.' });
    }

    const validation = validateBetaRegistrationInput(req.body);
    if (validation.error) {
      await transaction.rollback();
      return res.status(400).json({ error: validation.error });
    }

    const existing = await LaunchBetaRegistration.findOne({
      where: { launch_id: launch.id, user_id: req.user.userId },
      transaction,
    });

    if (existing && ['pending', 'approved'].includes(existing.status)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'You already have an active beta registration for this launch.' });
    }

    const now = new Date();
    const registration = existing
      ? await existing.update({
        status: 'pending',
        message: validation.data.message,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: now,
      }, { transaction })
      : await LaunchBetaRegistration.create({
        launch_id: launch.id,
        user_id: req.user.userId,
        status: 'pending',
        message: validation.data.message,
      }, { transaction });

    await transaction.commit();
    return res.status(existing ? 200 : 201).json({ registration: serializeRegistration(registration) });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    return res.status(500).json({ error: 'Failed to request beta access.' });
  }
}

async function withdrawMyBetaRegistration(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    if (!(await ensureBetaLaunch(launch, res))) return;

    const registration = await LaunchBetaRegistration.findOne({
      where: { launch_id: launch.id, user_id: req.user.userId },
    });
    if (!registration || registration.status === 'withdrawn') {
      return res.status(404).json({ error: 'Beta registration not found.' });
    }

    await registration.update({
      status: 'withdrawn',
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date(),
    });

    return res.json({ registration: serializeRegistration(registration) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to withdraw beta access request.' });
  }
}

async function listBetaRegistrations(req, res) {
  try {
    const launch = await getLaunchOr404(req.params.launchId, res);
    if (!launch) return;

    if (!isLaunchOwner(launch, req.user.userId)) {
      return res.status(403).json({ error: 'Only the builder can review beta registrations.' });
    }

    const registrations = await LaunchBetaRegistration.findAll({
      where: { launch_id: launch.id },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'username', 'headline'], required: false },
        { model: User, as: 'reviewer', attributes: ['id', 'name', 'username', 'headline'], required: false },
      ],
      order: [
        ['status', 'ASC'],
        ['updated_at', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });

    return res.json({ registrations: registrations.map(serializeRegistration) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch beta registrations.' });
  }
}

async function updateRegistrationStatus(req, res, nextStatus) {
  const transaction = await sequelize.transaction();

  try {
    const launch = await getLaunchOr404(req.params.launchId, res, { transaction });
    if (!launch) {
      await transaction.rollback();
      return;
    }

    if (!(await ensureBetaLaunch(launch, res))) {
      await transaction.rollback();
      return;
    }

    if (!isLaunchOwner(launch, req.user.userId)) {
      await transaction.rollback();
      return res.status(403).json({ error: 'Only the builder can moderate beta registrations.' });
    }

    const registration = await LaunchBetaRegistration.findOne({
      where: { id: req.params.registrationId, launch_id: launch.id },
      transaction,
    });
    if (!registration) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Beta registration not found.' });
    }

    if (nextStatus === 'approved' && registration.status !== 'approved' && launch.beta_capacity) {
      const approvedCount = await LaunchBetaRegistration.count({
        where: { launch_id: launch.id, status: 'approved' },
        transaction,
      });

      if (approvedCount >= launch.beta_capacity) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Beta capacity is already full.' });
      }
    }

    await registration.update({
      status: nextStatus,
      reviewed_by: req.user.userId,
      reviewed_at: new Date(),
      updated_at: new Date(),
    }, { transaction });

    await refreshLaunchCounts(launch.id, transaction);
    await transaction.commit();

    const hydrated = await LaunchBetaRegistration.findByPk(registration.id, {
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'username', 'headline'], required: false },
        { model: User, as: 'reviewer', attributes: ['id', 'name', 'username', 'headline'], required: false },
      ],
    });

    return res.json({ registration: serializeRegistration(hydrated) });
  } catch (error) {
    await rollbackIfNeeded(transaction);
    return res.status(500).json({ error: 'Failed to update beta registration.' });
  }
}

async function approveBetaRegistration(req, res) {
  return updateRegistrationStatus(req, res, 'approved');
}

async function rejectBetaRegistration(req, res) {
  return updateRegistrationStatus(req, res, 'rejected');
}

module.exports = {
  requestBetaRegistration,
  withdrawMyBetaRegistration,
  listBetaRegistrations,
  approveBetaRegistration,
  rejectBetaRegistration,
};
