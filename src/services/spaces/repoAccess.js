const {
  ProjectSpace,
  ProjectSpaceMember,
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  User,
} = require('../../models');

const REPO_ROLE_ORDER = ['read', 'triage', 'write', 'maintain', 'admin'];
const ROLE_RANK = REPO_ROLE_ORDER.reduce((accumulator, role, index) => {
  accumulator[role] = index + 1;
  return accumulator;
}, {});

function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

function roleMeets(role, requiredRole) {
  return roleRank(role) >= roleRank(requiredRole);
}

function maxRole(...roles) {
  return roles
    .filter(Boolean)
    .sort((left, right) => roleRank(right) - roleRank(left))[0] || null;
}

function acceptedDirectRole(repoMembership) {
  return repoMembership?.status === 'accepted' ? repoMembership.role : null;
}

function getSpaceInheritedRole(space, membership, userId) {
  if (!space || !userId) return null;
  if (space.owner_id === userId || membership?.role === 'owner') return 'admin';
  if (membership?.role === 'maintainer') return 'maintain';
  return null;
}

function buildRepoCapabilities({
  repo,
  userId,
  effectiveRole,
  directRole,
  inheritedRole,
}) {
  const isPublic = repo.visibility === 'public';
  const canRead = isPublic || roleMeets(effectiveRole, 'read');
  const canPush = roleMeets(effectiveRole, 'write');
  const canOpenPr = roleMeets(effectiveRole, 'write');
  const canReview = roleMeets(effectiveRole, 'triage');
  const canManageRules = roleMeets(effectiveRole, 'maintain');
  const canManageAccess = roleMeets(effectiveRole, 'admin');
  const canArchive = roleMeets(effectiveRole, 'admin');
  const canDelete = Boolean(userId && repo.owner_id === userId);

  return {
    can_read: canRead,
    can_push: canPush,
    can_open_pr: canOpenPr,
    can_review: canReview,
    can_merge: roleMeets(effectiveRole, 'write'),
    can_manage_rules: canManageRules,
    can_manage_access: canManageAccess,
    can_archive: canArchive,
    can_delete: canDelete,
    can_manage_general: roleMeets(effectiveRole, 'admin'),
    can_manage_releases: roleMeets(effectiveRole, 'write'),
    can_manage_branches: roleMeets(effectiveRole, 'write'),
    can_manage_default_branch: roleMeets(effectiveRole, 'admin'),
    can_comment: canRead && Boolean(userId),
    direct_role: directRole,
    inherited_role: inheritedRole,
  };
}

function attachLegacyAliases(context) {
  return {
    ...context,
    isAdmin: roleMeets(context.effective_role, 'admin'),
    canRead: context.permissions.can_read,
    canWrite: context.permissions.can_push,
    my_role: context.effective_role,
  };
}

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
  const inheritedRole = isOwner ? 'admin' : getSpaceInheritedRole(space, membership, userId);
  const directRole = acceptedDirectRole(repoMembership);
  const effectiveRole = maxRole(inheritedRole, directRole);
  const permissions = buildRepoCapabilities({
    repo,
    userId,
    effectiveRole,
    directRole,
    inheritedRole,
  });

  return attachLegacyAliases({
    user_id: userId || null,
    repo_id: repo.id,
    space,
    membership,
    repoMembership,
    is_owner: isOwner,
    effective_role: effectiveRole,
    direct_role: directRole,
    inherited_role: inheritedRole,
    is_outside_collaborator: Boolean(repo.space_id && directRole && !membership && !inheritedRole),
    permissions,
  });
}

function denyCapability(res, capability) {
  const messages = {
    can_read: 'Repository not found.',
    can_push: 'You do not have permission to push to this repository.',
    can_open_pr: 'You do not have permission to open pull requests for this repository.',
    can_review: 'You do not have permission to review pull requests for this repository.',
    can_manage_rules: 'You do not have permission to manage branch protection for this repository.',
    can_manage_access: 'You do not have permission to manage repository access.',
    can_archive: 'You do not have permission to archive this repository.',
    can_delete: 'Only the repository owner can delete this repository.',
    can_manage_general: 'You do not have permission to manage repository settings.',
  };
  const statusCode = capability === 'can_read' ? 404 : 403;
  res.status(statusCode).json({ error: messages[capability] || 'Repository access denied.' });
}

async function ensureRepoCapability(repoId, userId, res, capability) {
  const repo = await getRepoOr404(repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.permissions[capability]) {
    denyCapability(res, capability);
    return null;
  }

  return { repo, access };
}

async function ensureLegacyRepoCapability(spaceId, repoId, userId, res, capability) {
  const repo = await getLegacyRepoOr404(spaceId, repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.permissions[capability]) {
    denyCapability(res, capability);
    return null;
  }

  return { repo, access };
}

async function ensureRepoAdmin(repoId, userId, res) {
  return ensureRepoCapability(repoId, userId, res, 'can_manage_access');
}

async function ensureRepoOwner(repoId, userId, res) {
  const repo = await getRepoOr404(repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.is_owner) {
    res.status(403).json({ error: 'Only the repository owner can manage this repository.' });
    return null;
  }

  return { repo, access };
}

async function ensureLegacyRepoAdmin(spaceId, repoId, userId, res) {
  return ensureLegacyRepoCapability(spaceId, repoId, userId, res, 'can_manage_access');
}

async function ensureLegacyRepoOwner(spaceId, repoId, userId, res) {
  const repo = await getLegacyRepoOr404(spaceId, repoId, res);
  if (!repo) return null;

  const access = await getAccessContext(repo, userId);
  if (!access.is_owner) {
    res.status(403).json({ error: 'Only the repository owner can manage this repository.' });
    return null;
  }

  return { repo, access };
}

async function ensureRepoReadable(repoId, userId, res) {
  return ensureRepoCapability(repoId, userId, res, 'can_read');
}

async function ensureLegacyRepoReadable(spaceId, repoId, userId, res) {
  return ensureLegacyRepoCapability(spaceId, repoId, userId, res, 'can_read');
}

async function ensureRepoWritable(repoId, userId, res) {
  return ensureRepoCapability(repoId, userId, res, 'can_push');
}

async function ensureRepoMemberCandidate(repo, userId, res, options = {}) {
  const { allowAdmin = false } = options;
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

  const membership = repo.space_id
    ? await ProjectSpaceMember.findOne({
        where: { space_id: repo.space_id, user_id: userId },
      })
    : null;

  if (membership?.role === 'owner') {
    res.status(400).json({ error: 'Space owner already has inherited admin access.' });
    return null;
  }

  if (membership?.role === 'maintainer' && allowAdmin) {
    res.status(400).json({ error: 'Space maintainer already has inherited maintain access.' });
    return null;
  }

  return { user, membership };
}

module.exports = {
  REPO_ROLE_ORDER,
  roleRank,
  roleMeets,
  maxRole,
  acceptedDirectRole,
  loadRepoWithRelations,
  getRepoOr404,
  getLegacyRepoOr404,
  getRepoByGitRouteOr404,
  getAccessContext,
  ensureRepoCapability,
  ensureLegacyRepoCapability,
  ensureRepoAdmin,
  ensureRepoOwner,
  ensureLegacyRepoAdmin,
  ensureLegacyRepoOwner,
  ensureRepoReadable,
  ensureLegacyRepoReadable,
  ensureRepoWritable,
  ensureRepoMemberCandidate,
};
