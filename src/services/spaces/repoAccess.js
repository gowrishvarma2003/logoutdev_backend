const {
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  User,
} = require('../../models');

async function getRepoOr404(spaceId, repoId, res) {
  const repo = await ProjectSpaceRepo.findOne({
    where: {
      id: repoId,
      space_id: spaceId,
      archived_at: null,
    },
  });

  if (!repo) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return repo;
}

async function getRepoBySlugsOr404(spaceSlug, repoSlug, res) {
  const repo = await ProjectSpaceRepo.findOne({
    where: {
      slug: repoSlug,
      archived_at: null,
    },
    include: [
      {
        model: ProjectSpace,
        as: 'space',
        where: { slug: spaceSlug },
      },
    ],
  });

  if (!repo) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return repo;
}

async function getAccessContext(repo, userId) {
  const space = repo.space || await ProjectSpace.findByPk(repo.space_id);
  const membership = userId
    ? await ProjectSpaceMember.findOne({
      where: { space_id: repo.space_id, user_id: userId },
    })
    : null;
  const repoMembership = userId
    ? await ProjectSpaceRepoMember.findOne({
      where: { repo_id: repo.id, user_id: userId },
    })
    : null;

  const isOwner = Boolean(space && userId && space.owner_id === userId);
  const isMaintainer = Boolean(membership && membership.role === 'maintainer');
  const isAdmin = isOwner || isMaintainer;
  const hasContributorMembership = Boolean(membership);
  const explicitRole = hasContributorMembership ? repoMembership?.role || null : null;

  return {
    space,
    membership,
    repoMembership,
    isAdmin,
    canRead: isAdmin || Boolean(explicitRole),
    canWrite: isAdmin || explicitRole === 'write',
    my_role: isAdmin ? 'admin' : explicitRole,
  };
}

async function ensureRepoAdmin(spaceId, repoId, userId, res) {
  const repo = await getRepoOr404(spaceId, repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.isAdmin) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureRepoReadable(spaceId, repoId, userId, res) {
  const repo = await getRepoOr404(spaceId, repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.canRead) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureRepoWritable(spaceId, repoId, userId, res) {
  const repo = await getRepoOr404(spaceId, repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.canWrite) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureRepoMemberCandidate(spaceId, userId, res) {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'name', 'email', 'username'],
  });

  if (!user) {
    res.status(404).json({ error: 'Target user not found.' });
    return null;
  }

  const membership = await ProjectSpaceMember.findOne({
    where: { space_id: spaceId, user_id: userId },
  });

  if (!membership) {
    res.status(400).json({ error: 'Target user must be a space contributor before gaining repo access.' });
    return null;
  }

  if (membership.role === 'owner' || membership.role === 'maintainer') {
    res.status(400).json({ error: 'Space owner and maintainers already have repo admin access.' });
    return null;
  }

  return { user, membership };
}

module.exports = {
  getRepoOr404,
  getRepoBySlugsOr404,
  getAccessContext,
  ensureRepoAdmin,
  ensureRepoReadable,
  ensureRepoWritable,
  ensureRepoMemberCandidate,
};
