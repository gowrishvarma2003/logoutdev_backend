const {
  FreelanceProject,
  FreelanceProposal,
  FreelanceProjectSkill,
  User,
  UserProfileSkill,
  UserFeaturedProject,
  ProjectSpace,
} = require('../../models');

async function getProjectOr404(projectId, res, extra = {}) {
  const project = await FreelanceProject.findByPk(projectId, extra);
  if (!project) {
    res.status(404).json({ error: 'Freelance project not found.' });
    return null;
  }
  return project;
}

async function getProposalOr404(projectId, proposalId, res, extra = {}) {
  const proposal = await FreelanceProposal.findOne({
    where: { id: proposalId, project_id: projectId },
    ...extra,
  });
  if (!proposal) {
    res.status(404).json({ error: 'Proposal not found.' });
    return null;
  }
  return proposal;
}

function isProjectOwner(project, userId) {
  return Boolean(project && userId && project.client_id === userId);
}

function isProposalOwner(proposal, userId) {
  return Boolean(proposal && userId && proposal.freelancer_id === userId);
}

async function buildProjectViewerState(project, userId) {
  const viewerState = {
    is_owner: isProjectOwner(project, userId),
    can_edit: false,
    can_submit_proposal: false,
    can_view_proposals: false,
    has_submitted_proposal: false,
    my_proposal_id: null,
    my_proposal_status: null,
    can_open_workspace: false,
  };

  if (!userId) {
    return viewerState;
  }

  if (viewerState.is_owner) {
    viewerState.can_edit = project.status === 'open' || project.status === 'in_review';
    viewerState.can_view_proposals = true;
    viewerState.can_open_workspace = Boolean(project.linked_space_id);
    return viewerState;
  }

  const myProposal = await FreelanceProposal.findOne({
    where: { project_id: project.id, freelancer_id: userId },
    attributes: ['id', 'status'],
  });

  viewerState.has_submitted_proposal = Boolean(myProposal);
  viewerState.my_proposal_id = myProposal?.id || null;
  viewerState.my_proposal_status = myProposal?.status || null;
  viewerState.can_submit_proposal = !myProposal && (project.status === 'open' || project.status === 'in_review');
  viewerState.can_open_workspace = Boolean(
    project.linked_space_id && myProposal && myProposal.status === 'accepted'
  );

  return viewerState;
}

function getProjectListInclude({ skillFilter = false } = {}) {
  return [
    {
      model: User,
      as: 'client',
      attributes: ['id', 'name', 'email', 'username', 'headline', 'location'],
    },
    {
      model: FreelanceProjectSkill,
      as: 'skills',
      required: skillFilter,
      attributes: ['id', 'skill', 'rank'],
    },
    {
      model: ProjectSpace,
      as: 'linked_space',
      required: false,
      attributes: ['id', 'slug', 'name', 'status', 'visibility'],
    },
  ];
}

function getProposalInclude() {
  return [
    {
      model: User,
      as: 'freelancer',
      attributes: ['id', 'name', 'email', 'username', 'headline', 'location', 'github_url', 'website_url'],
      include: [
        {
          model: UserProfileSkill,
          as: 'profile_skills',
          attributes: ['id', 'skill', 'rank'],
          required: false,
        },
        {
          model: UserFeaturedProject,
          as: 'featured_projects',
          attributes: ['id', 'position'],
          required: false,
          include: [
            {
              model: ProjectSpace,
              as: 'space',
              attributes: ['id', 'name', 'slug', 'summary', 'status', 'visibility'],
              required: false,
            },
          ],
        },
      ],
    },
  ];
}

module.exports = {
  getProjectOr404,
  getProposalOr404,
  isProjectOwner,
  isProposalOwner,
  buildProjectViewerState,
  getProjectListInclude,
  getProposalInclude,
};
