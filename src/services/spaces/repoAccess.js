const {
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  User,
} = require('../../models');

async function loadRepoWithRelations(where) {
  return ProjectSpaceRepo.findOne({
    where: {
      ...where,
      archived_at: null,
    },
    include: [
      { model: ProjectSpace, as: 'space', required: false },
      { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
    ],
  });
}

async function getRepoOr404(repoId, res) {
  const repo = await loadRepoWithRelations({ id: repoId });
  if (!repo) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }
  return repo;
}

async function getLegacyRepoOr404(spaceId, repoId, res) {
  const repo = await loadRepoWithRelations({ id: repoId, space_id: spaceId });
  if (!repo) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }
  return repo;
}

async function getRepoByGitRouteOr404(namespace, repoSlug, res) {
  const byOwner = await ProjectSpaceRepo.findOne({
    where: {
      slug: repoSlug,
      archived_at: null,
    },
    include: [
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'username'],
        where: { username: namespace },
      },
      { model: ProjectSpace, as: 'space', required: false },
    ],
  });
  if (byOwner) return byOwner;

  const bySpace = await ProjectSpaceRepo.findOne({
    where: {
      slug: repoSlug,
      archived_at: null,
    },
    include: [
      {
        model: ProjectSpace,
        as: 'space',
        where: { slug: namespace },
      },
      { model: User, as: 'owner', attributes: ['id', 'username'], required: false },
    ],
  });
  if (bySpace) return bySpace;

  res.status(404).json({ error: 'Repository not found.' });
  return null;
}

async function getAccessContext(repo, userId) {
  const space = repo.space || (repo.space_id ? await ProjectSpace.findByPk(repo.space_id) : null);
  const membership = userId && repo.space_id
    ? await ProjectSpaceMember.findOne({
        where: { space_id: repo.space_id, user_id: userId },
      })
    : null;
  const repoMembership = userId
    ? await ProjectSpaceRepoMember.findOne({
        where: { repo_id: repo.id, user_id: userId },
      })
    : null;

  const isOwner = Boolean(userId && repo.owner_id === userId);
  const isSpaceAdmin = Boolean(
    space
    && userId
    && (
      space.owner_id === userId
      || membership?.role === 'owner'
      || membership?.role === 'maintainer'
    )
  );
  const hasValidSpaceMembership = !repo.space_id || Boolean(membership) || isSpaceAdmin || isOwner;
  const explicitRole = hasValidSpaceMembership ? repoMembership?.role || null : null;
  const isPublic = repo.visibility === 'public';

  return {
    space,
    membership,
    repoMembership,
    isOwner,
    isSpaceAdmin,
    isAdmin: isOwner || isSpaceAdmin,
    canRead: isPublic || isOwner || isSpaceAdmin || Boolean(explicitRole),
    canWrite: isOwner || isSpaceAdmin || explicitRole === 'write',
    my_role: isOwner || isSpaceAdmin ? 'admin' : explicitRole,
  };
}

async function ensureRepoAdmin(repoId, userId, res) {
  const repo = await getRepoOr404(repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.isAdmin) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureLegacyRepoAdmin(spaceId, repoId, userId, res) {
  const repo = await getLegacyRepoOr404(spaceId, repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.isAdmin) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureRepoReadable(repoId, userId, res) {
  const repo = await getRepoOr404(repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.canRead) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureLegacyRepoReadable(spaceId, repoId, userId, res) {
  const repo = await getLegacyRepoOr404(spaceId, repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.canRead) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureRepoWritable(repoId, userId, res) {
  const repo = await getRepoOr404(repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.canWrite) {
    res.status(404).json({ error: 'Repository not found.' });
    return null;
  }

  return { repo, access };
}

async function ensureRepoMemberCandidate(repo, userId, res) {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'name', 'email', 'username'],
  });

  if (!user) {
    res.status(404).json({ error: 'Target user not found.' });
    return null;
  }

  if (repo.owner_id === userId) {
    res.status(400).json({ error: 'Repository owner already has admin access.' });
    return null;
  }

  if (repo.space_id) {
    const membership = await ProjectSpaceMember.findOne({
      where: { space_id: repo.space_id, user_id: userId },
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

  return { user, membership: null };
}

module.exports = {
  getRepoOr404,
  getLegacyRepoOr404,
  getRepoByGitRouteOr404,
  getAccessContext,
  ensureRepoAdmin,
  ensureLegacyRepoAdmin,
  ensureRepoReadable,
  ensureLegacyRepoReadable,
  ensureRepoWritable,
  ensureRepoMemberCandidate,
};
