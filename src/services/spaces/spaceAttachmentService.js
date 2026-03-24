const {
  ProjectSpaceRepoAttachment,
  ProjectSpaceRepo,
  ProjectSpace,
  User,
} = require('../../models');
const { getAccessContext } = require('./repoAccess');
const { resolveRepoPath } = require('../git/gitPath');
const { listTree } = require('../git/gitShell');

const COMMUNITY_FILE_LABELS = {
  'README.md': 'README',
  README: 'README',
  'CONTRIBUTING.md': 'CONTRIBUTING',
  CONTRIBUTING: 'CONTRIBUTING',
  'CODE_OF_CONDUCT.md': 'CODE_OF_CONDUCT',
  'CODE_OF_CONDUCT.MD': 'CODE_OF_CONDUCT',
  CODE_OF_CONDUCT: 'CODE_OF_CONDUCT',
};

async function buildCommunityFiles(repo) {
  try {
    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const entries = await listTree(repoPath, repo.default_branch, '');
    return entries
      .filter((entry) => entry.type === 'blob' && COMMUNITY_FILE_LABELS[entry.name])
      .map((entry) => ({
        key: COMMUNITY_FILE_LABELS[entry.name],
        path: entry.path,
        name: entry.name,
      }));
  } catch (error) {
    return [];
  }
}

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
        community_files: await buildCommunityFiles(attachment.repo),
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
