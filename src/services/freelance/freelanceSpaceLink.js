const {
  ProjectSpace,
  ProjectSpaceMember,
} = require('../../models');
const { buildFreelanceSlug } = require('./freelanceValidation');

async function generateUniqueSpaceSlug(seed, transaction) {
  const base = buildFreelanceSlug(seed) || `freelance-workspace-${Date.now()}`;
  let slug = base;
  let counter = 1;

  while (await ProjectSpace.findOne({ where: { slug }, transaction, attributes: ['id'] })) {
    counter += 1;
    slug = `${base.slice(0, 130)}-${counter}`;
  }

  return slug;
}

async function createLinkedSpaceForAward({ project, proposal, transaction }) {
  if (project.linked_space_id) {
    const existing = await ProjectSpace.findByPk(project.linked_space_id, { transaction });
    if (existing) return existing;
  }

  const slug = await generateUniqueSpaceSlug(`${project.title} workspace`, transaction);
  const space = await ProjectSpace.create(
    {
      owner_id: project.client_id,
      name: project.title,
      slug,
      summary: project.summary,
      description: project.description,
      status: 'building',
      visibility: 'private',
      primary_repo_url: null,
    },
    { transaction }
  );

  await ProjectSpaceMember.findOrCreate({
    where: { space_id: space.id, user_id: project.client_id },
    defaults: { role: 'owner' },
    transaction,
  });

  await ProjectSpaceMember.findOrCreate({
    where: { space_id: space.id, user_id: proposal.freelancer_id },
    defaults: { role: 'maintainer' },
    transaction,
  });

  return space;
}

module.exports = {
  createLinkedSpaceForAward,
};
