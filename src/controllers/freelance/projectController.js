const { Op } = require('sequelize');
const {
  sequelize,
  FreelanceProject,
  FreelanceProjectSkill,
  FreelanceProposal,
} = require('../../models');
const { parsePagination } = require('../../services/spaces/pagination');
const {
  validateProjectInput,
  FREELANCE_PROJECT_STATUSES,
  FREELANCE_PRICING_MODELS,
  FREELANCE_EXPERIENCE_LEVELS,
  FREELANCE_ENGAGEMENT_TYPES,
  isProjectStatusTransitionAllowed,
  isEditableProjectStatus,
  buildFreelanceSlug,
} = require('../../services/freelance/freelanceValidation');
const {
  getProjectOr404,
  isProjectOwner,
  buildProjectViewerState,
  getProjectListInclude,
} = require('../../services/freelance/freelanceAccess');
const { asTrimmedString, isAllowedValue } = require('../../services/spaces/spaceValidation');
const { getFreelanceGraph } = require('../../services/workGraph/workGraphService');

async function generateUniqueProjectSlug(seed, excludeId, transaction) {
  const base = buildFreelanceSlug(seed);
  if (!base) return '';

  let slug = base;
  let counter = 1;
  while (
    await FreelanceProject.findOne({
      where: {
        slug,
        ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
      },
      attributes: ['id'],
      transaction,
    })
  ) {
    counter += 1;
    slug = `${base.slice(0, 130)}-${counter}`;
  }

  return slug;
}

async function replaceProjectSkills(projectId, skills, transaction) {
  await FreelanceProjectSkill.destroy({ where: { project_id: projectId }, transaction });

  if (!skills || skills.length === 0) return;

  await FreelanceProjectSkill.bulkCreate(
    skills.map((skill, index) => ({
      project_id: projectId,
      skill,
      rank: index,
    })),
    { transaction }
  );
}

function serializeProject(project, viewerState = null) {
  const json = project.toJSON();
  if (viewerState) json.viewer_state = viewerState;
  return json;
}

async function listProjects(req, res) {
  try {
    const q = asTrimmedString(req.query.q);
    const skill = asTrimmedString(req.query.skill);
    const pricingModel = asTrimmedString(req.query.pricing_model);
    const experienceLevel = asTrimmedString(req.query.experience_level);
    const engagementType = asTrimmedString(req.query.engagement_type);
    const sort = asTrimmedString(req.query.sort || 'newest');
    const requestedStatus = asTrimmedString(req.query.status || 'open');
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const where = {};
    if (q) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${q}%` } },
        { summary: { [Op.iLike]: `%${q}%` } },
        { description: { [Op.iLike]: `%${q}%` } },
      ];
    }

    if (pricingModel && isAllowedValue(pricingModel, FREELANCE_PRICING_MODELS)) {
      where.pricing_model = pricingModel;
    }

    if (experienceLevel && isAllowedValue(experienceLevel, FREELANCE_EXPERIENCE_LEVELS)) {
      where.experience_level = experienceLevel;
    }

    if (engagementType && isAllowedValue(engagementType, FREELANCE_ENGAGEMENT_TYPES)) {
      where.engagement_type = engagementType;
    }

    if (requestedStatus && isAllowedValue(requestedStatus, FREELANCE_PROJECT_STATUSES)) {
      where.status = requestedStatus;
    } else {
      where.status = 'open';
    }

    const include = getProjectListInclude({ skillFilter: Boolean(skill) });
    if (skill) {
      include[1].where = { skill: { [Op.iLike]: `%${skill}%` } };
    }

    const order = sort === 'budget'
      ? [['budget_max_cents', 'DESC'], ['created_at', 'DESC']]
      : [['created_at', 'DESC']];

    const { count, rows } = await FreelanceProject.findAndCountAll({
      where,
      include,
      distinct: true,
      order,
      limit,
      offset,
    });

    return res.json({
      projects: rows.map((project) => serializeProject(project)),
      total: count,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch freelance projects.' });
  }
}

async function createProject(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const validation = validateProjectInput(req.body);
    if (validation.error) {
      await transaction.rollback();
      return res.status(400).json({ error: validation.error });
    }

    const payload = validation.data;
    const slug = await generateUniqueProjectSlug(req.body.slug || payload.title, null, transaction);
    if (!slug) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Unable to generate a valid project slug.' });
    }

    const project = await FreelanceProject.create(
      {
        client_id: req.user.userId,
        slug,
        title: payload.title,
        summary: payload.summary,
        description: payload.description,
        pricing_model: payload.pricing_model,
        currency_code: payload.currency_code || 'USD',
        budget_min_cents: payload.budget_min_cents,
        budget_max_cents: payload.budget_max_cents,
        experience_level: payload.experience_level || 'any',
        engagement_type: payload.engagement_type,
        duration_weeks: payload.duration_weeks,
        location_mode: payload.location_mode || 'remote',
        timezone_note: payload.timezone_note,
      },
      { transaction }
    );

    await replaceProjectSkills(project.id, payload.skills, transaction);
    await transaction.commit();

    const hydrated = await FreelanceProject.findByPk(project.id, {
      include: getProjectListInclude(),
    });

    return res.status(201).json({ project: serializeProject(hydrated) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to create freelance project.' });
  }
}

async function getProject(req, res) {
  try {
    const project = await getProjectOr404(req.params.projectId, res, {
      include: [
        ...getProjectListInclude(),
        {
          model: FreelanceProposal,
          as: 'accepted_proposal',
          required: false,
          attributes: ['id', 'freelancer_id', 'status', 'bid_amount_cents', 'pricing_model'],
        },
      ],
    });
    if (!project) return;

    const viewerState = await buildProjectViewerState(project, req.user?.userId || null);
    const graph = await getFreelanceGraph(project, req.user?.userId || null);
    return res.json({
      project: {
        ...serializeProject(project, viewerState),
        ...graph,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch freelance project.' });
  }
}

async function updateProject(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const project = await getProjectOr404(req.params.projectId, res, { transaction });
    if (!project) {
      await transaction.rollback();
      return;
    }

    if (!isProjectOwner(project, req.user.userId)) {
      await transaction.rollback();
      return res.status(403).json({ error: 'Only the client can edit this project.' });
    }

    if (!isEditableProjectStatus(project.status)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Only open or in-review projects can be edited.' });
    }

    const validation = validateProjectInput(req.body, { partial: true });
    if (validation.error) {
      await transaction.rollback();
      return res.status(400).json({ error: validation.error });
    }

    const updates = { ...validation.data };
    delete updates.skills;

    if (req.body.slug !== undefined || req.body.title !== undefined) {
      const nextSlug = await generateUniqueProjectSlug(
        req.body.slug || updates.title || project.title,
        project.id,
        transaction
      );
      if (!nextSlug) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Unable to generate a valid project slug.' });
      }
      updates.slug = nextSlug;
    }

    updates.updated_at = new Date();
    await project.update(updates, { transaction });

    if (validation.data.skills) {
      await replaceProjectSkills(project.id, validation.data.skills, transaction);
    }

    await transaction.commit();

    const hydrated = await FreelanceProject.findByPk(project.id, {
      include: getProjectListInclude(),
    });
    return res.json({ project: serializeProject(hydrated) });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to update freelance project.' });
  }
}

async function updateProjectStatus(req, res) {
  try {
    const project = await getProjectOr404(req.params.projectId, res);
    if (!project) return;

    if (!isProjectOwner(project, req.user.userId)) {
      return res.status(403).json({ error: 'Only the client can update project status.' });
    }

    const nextStatus = asTrimmedString(req.body.status);
    if (!isAllowedValue(nextStatus, FREELANCE_PROJECT_STATUSES)) {
      return res.status(400).json({ error: 'Invalid project status.' });
    }

    if (!isProjectStatusTransitionAllowed(project.status, nextStatus)) {
      return res.status(400).json({ error: 'This status transition is not allowed.' });
    }

    await project.update({
      status: nextStatus,
      closed_at: ['completed', 'cancelled'].includes(nextStatus) ? new Date() : null,
      updated_at: new Date(),
    });

    return res.json({ project });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update project status.' });
  }
}

async function listMyProjects(req, res) {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { count, rows } = await FreelanceProject.findAndCountAll({
      where: { client_id: req.user.userId },
      include: getProjectListInclude(),
      distinct: true,
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });

    return res.json({
      projects: rows.map((project) => serializeProject(project)),
      total: count,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch your freelance projects.' });
  }
}

module.exports = {
  listProjects,
  createProject,
  getProject,
  updateProject,
  updateProjectStatus,
  listMyProjects,
};
