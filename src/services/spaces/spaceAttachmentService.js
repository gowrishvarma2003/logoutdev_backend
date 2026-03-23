const {
  ProjectSpaceRepoAttachment,
  ProjectSpaceRepo,
  ProjectSpace,
  User,
} = require('../../models');
const { getAccessContext } = require('./repoAccess');

async function serializeAttachment(attachment, userId = null) {
  if (!attachment) return null;

  if (attachment.repo) {
    const access = await getAccessContext(attachment.repo, userId);
    if (!access.canRead) return null;

    return {
      id: attachment.id,
      kind: 'managed',
      label: attachment.label || attachment.repo.name,
      position: attachment.position,
      is_primary: attachment.is_primary,
      repo_id: attachment.repo.id,
      external_url: null,
      repo: {
        ...attachment.repo.toJSON(),
        my_role: access.my_role,
      },
    };
  }

  return {
    id: attachment.id,
    kind: 'external',
    label: attachment.label || attachment.external_url,
    position: attachment.position,
    is_primary: attachment.is_primary,
    repo_id: null,
    external_url: attachment.external_url,
    repo: null,
  };
}

async function listVisibleAttachments(spaceId, userId = null) {
  const attachments = await ProjectSpaceRepoAttachment.findAll({
    where: { space_id: spaceId },
    include: [
      {
        model: ProjectSpaceRepo,
        as: 'repo',
        required: false,
        include: [
          { model: ProjectSpace, as: 'space', required: false },
          { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
        ],
      },
    ],
    order: [['position', 'ASC'], ['created_at', 'ASC']],
  });

  const serialized = await Promise.all(attachments.map((attachment) => serializeAttachment(attachment, userId)));
  return serialized.filter(Boolean);
}

module.exports = {
  serializeAttachment,
  listVisibleAttachments,
};
