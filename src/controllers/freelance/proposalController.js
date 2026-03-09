const { Op } = require('sequelize');
const {
  sequelize,
  FreelanceProject,
  FreelanceProjectSkill,
  FreelanceProposal,
  User,
} = require('../../models');
const { parsePagination } = require('../../services/spaces/pagination');
const {
  validateProposalInput,
  canAcceptNewProposals,
  isEditableProposalStatus,
  FREELANCE_PROPOSAL_REVIEW_ACTIONS,
} = require('../../services/freelance/freelanceValidation');
const {
  getProjectOr404,
  getProposalOr404,
  isProjectOwner,
  isProposalOwner,
  getProposalInclude,
} = require('../../services/freelance/freelanceAccess');
const { createLinkedSpaceForAward } = require('../../services/freelance/freelanceSpaceLink');
const { asTrimmedString, isAllowedValue } = require('../../services/spaces/spaceValidation');
const {
  buildEntityRef,
  emitUserNotification,
} = require('../../services/notifications/notificationService');

function serializeProposal(proposal) {
  return proposal.toJSON();
}

function summarizeCoverNote(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!normalized) return null;
  return normalized.length > 120 ? `${normalized.slice(0, 119)}…` : normalized;
}

async function listProjectProposals(req, res) {
  try {
    const project = await getProjectOr404(req.params.projectId, res);
    if (!project) return;

    if (!isProjectOwner(project, req.user.userId)) {
      return res.status(403).json({ error: 'Only the client can view project proposals.' });
    }

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { count, rows } = await FreelanceProposal.findAndCountAll({
      where: { project_id: project.id },
      include: getProposalInclude(),
      distinct: true,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return res.json({
      proposals: rows.map((proposal) => serializeProposal(proposal)),
      total: count,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch proposals.' });
  }
}

async function createProposal(req, res) {
  try {
    const project = await getProjectOr404(req.params.projectId, res);
    if (!project) return;

    if (isProjectOwner(project, req.user.userId)) {
      return res.status(400).json({ error: 'Project owners cannot submit proposals to their own project.' });
    }

    if (!canAcceptNewProposals(project.status)) {
      return res.status(400).json({ error: 'This project is not accepting new proposals.' });
    }

    const existing = await FreelanceProposal.findOne({
      where: { project_id: project.id, freelancer_id: req.user.userId },
      attributes: ['id'],
    });
    if (existing) {
      return res.status(409).json({ error: 'You have already submitted a proposal to this project.' });
    }

    const validation = validateProposalInput(req.body);
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const payload = validation.data;
    if (payload.pricing_model !== project.pricing_model) {
      return res.status(400).json({ error: 'Proposal pricing_model must match the project pricing model.' });
    }

    const proposal = await FreelanceProposal.create({
      project_id: project.id,
      freelancer_id: req.user.userId,
      cover_note: payload.cover_note,
      pricing_model: payload.pricing_model,
      currency_code: payload.currency_code || project.currency_code,
      bid_amount_cents: payload.bid_amount_cents,
      estimated_duration_weeks: payload.estimated_duration_weeks,
      availability_hours: payload.availability_hours,
      proof_links: payload.proof_links || [],
    });

    const hydrated = await FreelanceProposal.findByPk(proposal.id, {
      include: getProposalInclude(),
    });

    await emitUserNotification({
      recipientUserId: project.client_id,
      actorUserId: req.user.userId,
      eventType: 'proposal_submitted',
      category: 'freelance',
      priority: 'action',
      entityType: 'freelance_project',
      entityId: project.id,
      entitySnapshot: buildEntityRef({
        type: 'freelance_project',
        id: project.id,
        title: project.title,
        href: `/freelance/${project.id}`,
      }),
      secondaryEntityType: 'proposal',
      secondaryEntityId: proposal.id,
      secondarySnapshot: {
        type: 'proposal',
        id: proposal.id,
        title: 'Proposal submitted',
        href: `/freelance/${project.id}/proposals`,
        subtitle: summarizeCoverNote(payload.cover_note),
        visibility: null,
        tags: [],
      },
      actionUrl: `/freelance/${project.id}/proposals`,
      previewText: 'submitted a proposal to your project',
      dedupeKey: `proposal_submitted:${proposal.id}:${project.client_id}`,
      createdAt: proposal.created_at,
    });

    return res.status(201).json({ proposal: serializeProposal(hydrated) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to submit proposal.' });
  }
}

async function updateProposal(req, res) {
  try {
    const project = await getProjectOr404(req.params.projectId, res);
    if (!project) return;

    const proposal = await getProposalOr404(project.id, req.params.proposalId, res);
    if (!proposal) return;

    if (!isProposalOwner(proposal, req.user.userId)) {
      return res.status(403).json({ error: 'Only the proposal owner can edit this proposal.' });
    }

    if (!canAcceptNewProposals(project.status)) {
      return res.status(400).json({ error: 'This project is no longer accepting proposal edits.' });
    }

    if (!isEditableProposalStatus(proposal.status)) {
      return res.status(400).json({ error: 'Only submitted or shortlisted proposals can be edited.' });
    }

    const validation = validateProposalInput(req.body, { partial: true });
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const updates = { ...validation.data };
    if (updates.pricing_model && updates.pricing_model !== project.pricing_model) {
      return res.status(400).json({ error: 'Proposal pricing_model must match the project pricing model.' });
    }

    updates.updated_at = new Date();
    await proposal.update(updates);

    const hydrated = await FreelanceProposal.findByPk(proposal.id, {
      include: getProposalInclude(),
    });

    return res.json({ proposal: serializeProposal(hydrated) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update proposal.' });
  }
}

async function withdrawProposal(req, res) {
  try {
    const project = await getProjectOr404(req.params.projectId, res);
    if (!project) return;

    const proposal = await getProposalOr404(project.id, req.params.proposalId, res);
    if (!proposal) return;

    if (!isProposalOwner(proposal, req.user.userId)) {
      return res.status(403).json({ error: 'Only the proposal owner can withdraw this proposal.' });
    }

    if (proposal.status === 'accepted') {
      return res.status(400).json({ error: 'Accepted proposals cannot be withdrawn.' });
    }

    await proposal.update({
      status: 'withdrawn',
      withdrawn_at: new Date(),
      updated_at: new Date(),
    });

    return res.json({ withdrawn: true, proposal });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to withdraw proposal.' });
  }
}

async function reviewProposal(req, res) {
  const transaction = await sequelize.transaction();

  try {
    const project = await getProjectOr404(req.params.projectId, res, { transaction, lock: transaction.LOCK.UPDATE });
    if (!project) {
      await transaction.rollback();
      return;
    }

    if (!isProjectOwner(project, req.user.userId)) {
      await transaction.rollback();
      return res.status(403).json({ error: 'Only the client can review proposals.' });
    }

    if (!canAcceptNewProposals(project.status)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'This project cannot review proposals right now.' });
    }

    const action = asTrimmedString(req.body.action);
    if (!isAllowedValue(action, FREELANCE_PROPOSAL_REVIEW_ACTIONS)) {
      await transaction.rollback();
      return res.status(400).json({ error: 'action must be shortlist, reject, or accept.' });
    }

    const proposal = await getProposalOr404(project.id, req.params.proposalId, res, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!proposal) {
      await transaction.rollback();
      return;
    }

    if (proposal.status === 'withdrawn') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Withdrawn proposals cannot be reviewed.' });
    }

    if (action === 'shortlist') {
      await proposal.update({ status: 'shortlisted', reviewed_at: new Date(), updated_at: new Date() }, { transaction });
    } else if (action === 'reject') {
      await proposal.update({ status: 'rejected', reviewed_at: new Date(), updated_at: new Date() }, { transaction });
    } else if (action === 'accept') {
      if (project.accepted_proposal_id) {
        await transaction.rollback();
        return res.status(409).json({ error: 'This project already has an accepted proposal.' });
      }

      const linkedSpace = await createLinkedSpaceForAward({ project, proposal, transaction });

      await proposal.update(
        {
          status: 'accepted',
          reviewed_at: new Date(),
          updated_at: new Date(),
        },
        { transaction }
      );

      await FreelanceProposal.update(
        {
          status: 'rejected',
          reviewed_at: new Date(),
          updated_at: new Date(),
        },
        {
          where: {
            project_id: project.id,
            id: { [Op.ne]: proposal.id },
            status: { [Op.notIn]: ['withdrawn', 'accepted'] },
          },
          transaction,
        }
      );

      await project.update(
        {
          status: 'awarded',
          accepted_proposal_id: proposal.id,
          linked_space_id: linkedSpace.id,
          updated_at: new Date(),
        },
        { transaction }
      );
    }

    await transaction.commit();

    const hydrated = await FreelanceProposal.findByPk(proposal.id, {
      include: getProposalInclude(),
    });
    const updatedProject = await FreelanceProject.findByPk(project.id);

    if (action === 'shortlist' || action === 'accept') {
      await emitUserNotification({
        recipientUserId: proposal.freelancer_id,
        actorUserId: req.user.userId,
        eventType: action === 'accept' ? 'proposal_accepted' : 'proposal_shortlisted',
        category: 'freelance',
        priority: action === 'accept' ? 'action' : 'important',
        entityType: 'freelance_project',
        entityId: project.id,
        entitySnapshot: buildEntityRef({
          type: 'freelance_project',
          id: project.id,
          title: project.title,
          href: `/freelance/${project.id}`,
        }),
        secondaryEntityType: 'proposal',
        secondaryEntityId: proposal.id,
        secondarySnapshot: {
          type: 'proposal',
          id: proposal.id,
          title: action === 'accept' ? 'Proposal accepted' : 'Proposal shortlisted',
          href: '/freelance/my-proposals',
          subtitle: null,
          visibility: null,
          tags: [],
        },
        actionUrl: action === 'accept' && updatedProject?.linked_space_id
          ? `/spaces/${updatedProject.linked_space_id}`
          : '/freelance/my-proposals',
        previewText: action === 'accept'
          ? 'accepted your proposal'
          : 'shortlisted your proposal',
        dedupeKey: `${action === 'accept' ? 'proposal_accepted' : 'proposal_shortlisted'}:${proposal.id}:${proposal.freelancer_id}`,
      });
    }

    return res.json({
      proposal: serializeProposal(hydrated),
      project: updatedProject,
    });
  } catch (error) {
    await transaction.rollback();
    return res.status(500).json({ error: 'Failed to review proposal.' });
  }
}

async function listMyProposals(req, res) {
  try {
    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const { count, rows } = await FreelanceProposal.findAndCountAll({
      where: { freelancer_id: req.user.userId },
      include: [
        {
          model: FreelanceProject,
          as: 'project',
          include: [
            {
              model: User,
              as: 'client',
              attributes: ['id', 'name', 'email', 'username', 'headline', 'location'],
              required: false,
            },
            {
              model: FreelanceProjectSkill,
              as: 'skills',
              attributes: ['id', 'skill', 'rank'],
              required: false,
            },
          ],
        },
      ],
      distinct: true,
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });

    return res.json({
      proposals: rows.map((proposal) => serializeProposal(proposal)),
      total: count,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch your proposals.' });
  }
}

module.exports = {
  listProjectProposals,
  createProposal,
  updateProposal,
  withdrawProposal,
  reviewProposal,
  listMyProposals,
};
