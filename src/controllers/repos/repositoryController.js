const { Op } = require('sequelize');
const {
  ProjectSpaceRepo,
  ProjectSpaceRepoAttachment,
  ProjectSpaceRepoMember,
  ProjectSpace,
  RepoFork,
  RepoStar,
  RepoWatch,
  User,
} = require('../../models');
const {
  getSpaceOr404,
  getMembership,
  isMaintainerOrOwner,
  buildSpaceViewerPermissions,
} = require('../../services/spaces/spaceAccess');
const {
  getAccessContext,
  ensureRepoCapability,
  ensureRepoReadable,
} = require('../../services/spaces/repoAccess');
const {
  slugify,
  asTrimmedString,
  isAllowedValue,
  REPO_VISIBILITIES,
} = require('../../services/spaces/spaceValidation');
const { parsePagination } = require('../../services/spaces/pagination');
const { getMatchingBranchProtectionRule } = require('../../services/repos/repoGovernance');
const { analyzeRepositoryLanguages } = require('../../services/repos/repoLanguage');
const { getRepoPath, resolveRepoPath } = require('../../services/git/gitPath');
const { initializeBareRepository, setDefaultBranch, listTree, isSafeRef } = require('../../services/git/gitShell');

const COMMUNITY_FILE_LABELS = {
  'README.md': 'README',
  README: 'README',
  'CONTRIBUTING.md': 'CONTRIBUTING',
  CONTRIBUTING: 'CONTRIBUTING',
  'CODE_OF_CONDUCT.md': 'CODE_OF_CONDUCT',
  'CODE_OF_CONDUCT.MD': 'CODE_OF_CONDUCT',
  CODE_OF_CONDUCT: 'CODE_OF_CONDUCT',
};

function buildAttachedSpace(repo) {
  if (!repo.space) return null;
  return {
    id: repo.space.id,
    name: repo.space.name,
    slug: repo.space.slug,
    visibility: repo.space.visibility,
  };
}

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

function buildCollaborationHome(repo, access) {
  if (!repo.space || !repo.space_id) {
    return {
      type: 'none',
      can_contribute: false,
      can_start_discussion: false,
    };
  }

  const viewerPermissions = buildSpaceViewerPermissions(repo.space, access.membership, access.user_id);

  return {
    type: 'space',
    space_id: repo.space.id,
    href: `/spaces/${repo.space.id}/discussions`,
    can_contribute: viewerPermissions.can_reply || viewerPermissions.can_manage_discussions,
    can_start_discussion: viewerPermissions.can_create_discussion,
  };
}

async function serializeRepo(repo, userId = null, options = {}) {
  const { includeCommunityFiles = false, includeGovernance = false } = options;
  const access = await getAccessContext(repo, userId);
  const [
    starCount,
    watcherCount,
    forkCount,
    directCollaboratorCount,
    starRecord,
    watchRecord,
    forkRelation,
    defaultBranchRule,
    languageSummary,
  ] = await Promise.all([
    RepoStar.count({ where: { repo_id: repo.id } }),
    RepoWatch.count({ where: { repo_id: repo.id } }),
    RepoFork.count({ where: { source_repo_id: repo.id } }),
    ProjectSpaceRepoMember.count({ where: { repo_id: repo.id } }),
    userId ? RepoStar.findOne({ where: { repo_id: repo.id, user_id: userId }, attributes: ['id'] }) : Promise.resolve(null),
    userId ? RepoWatch.findOne({ where: { repo_id: repo.id, user_id: userId }, attributes: ['id', 'level'] }) : Promise.resolve(null),
    RepoFork.findOne({
      where: { forked_repo_id: repo.id },
      include: [
        {
          model: ProjectSpaceRepo,
          as: 'source_repo',
          required: false,
          include: [
            { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
          ],
        },
      ],
    }),
    includeGovernance ? getMatchingBranchProtectionRule(repo.id, repo.default_branch) : Promise.resolve(null),
    analyzeRepositoryLanguages(repo),
  ]);

  return {
    ...repo.toJSON(),
    my_role: access.my_role,
    effective_role: access.effective_role,
    inherited_role: access.inherited_role,
    direct_role: access.direct_role,
    is_outside_collaborator: access.is_outside_collaborator,
    permissions: access.permissions,
    can_read: access.permissions.can_read,
    can_push: access.permissions.can_push,
    can_open_pr: access.permissions.can_open_pr,
    can_review: access.permissions.can_review,
    can_merge: access.permissions.can_merge,
    can_manage_rules: access.permissions.can_manage_rules,
    can_manage_access: access.permissions.can_manage_access,
    can_archive: access.permissions.can_archive,
    attached_space: buildAttachedSpace(repo),
    collaboration_home: buildCollaborationHome(repo, access),
    is_attached: Boolean(repo.space_id),
    collaborator_count: directCollaboratorCount,
    star_count: starCount,
    watcher_count: watcherCount,
    fork_count: forkCount,
    language: languageSummary.language,
    languages: languageSummary.languages,
    is_starred: Boolean(starRecord),
    is_watching: Boolean(watchRecord),
    watch_level: watchRecord?.level || null,
    forked_from: forkRelation?.source_repo
      ? {
          id: forkRelation.source_repo.id,
          name: forkRelation.source_repo.name,
          slug: forkRelation.source_repo.slug,
          owner: forkRelation.source_repo.owner
            ? {
                id: forkRelation.source_repo.owner.id,
                name: forkRelation.source_repo.owner.name,
                username: forkRelation.source_repo.owner.username,
              }
            : null,
        }
      : null,
    protected_default_branch: defaultBranchRule
      ? {
          branch_pattern: defaultBranchRule.branch_pattern,
          require_pr: defaultBranchRule.require_pr,
          required_approvals: defaultBranchRule.required_approvals,
          require_status_checks: defaultBranchRule.require_status_checks,
        }
      : null,
    community_files: includeCommunityFiles ? await buildCommunityFiles(repo) : undefined,
  };
}

async function buildOwnerScopedSlug(ownerId, seed, ignoreRepoId = null) {
  const baseSlug = slugify(seed);
  if (!baseSlug) return null;

  let slug = baseSlug;
  let counter = 1;

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await ProjectSpaceRepo.findOne({
      where: {
        owner_id: ownerId,
        slug,
        archived_at: null,
        ...(ignoreRepoId ? { id: { [Op.ne]: ignoreRepoId } } : {}),
      },
      attributes: ['id'],
    });

    if (!existing) return slug;
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
}

async function listRepositories(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const scope = asTrimmedString(req.query.scope || 'all');
    const visibility = asTrimmedString(req.query.visibility || '');
    const attached = req.query.attached;
    const q = asTrimmedString(req.query.q || '').toLowerCase();
    const { page, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    let repos = await ProjectSpaceRepo.findAll({
      where: { archived_at: null },
      include: [
        { model: ProjectSpace, as: 'space', required: false },
        { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
        requesterId
          ? {
              model: ProjectSpaceRepoMember,
              as: 'members',
              where: { user_id: requesterId },
              required: false,
            }
          : null,
      ].filter(Boolean),
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    });

    if (q) {
      repos = repos.filter((repo) => {
        const haystack = [repo.name, repo.description, repo.slug, repo.owner?.username]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    const visible = [];
    for (const repo of repos) {
      // eslint-disable-next-line no-await-in-loop
      const access = await getAccessContext(repo, requesterId);
      const isMine = requesterId && repo.owner_id === requesterId;
      const isShared = requesterId && !isMine && access.canRead;
      const isPublic = repo.visibility === 'public';

      if (!access.canRead) continue;
      if (visibility && (!isAllowedValue(visibility, REPO_VISIBILITIES) || repo.visibility !== visibility)) continue;
      if (attached === 'true' && !repo.space_id) continue;
      if (attached === 'false' && repo.space_id) continue;
      if (scope === 'mine' && !isMine) continue;
      if (scope === 'shared' && !isShared) continue;
      if (scope === 'public' && !isPublic) continue;

      visible.push(await serializeRepo(repo, requesterId));
    }

    const offset = (page - 1) * limit;
    return res.json({
      repos: visible.slice(offset, offset + limit),
      total: visible.length,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repositories.' });
  }
}

async function createRepository(req, res) {
  let repo = null;

  try {
    const userId = req.user.userId;
    const name = asTrimmedString(req.body.name);
    const description = asTrimmedString(req.body.description) || null;
    const defaultBranch = asTrimmedString(req.body.default_branch || 'main') || 'main';
    const visibility = asTrimmedString(req.body.visibility || 'private') || 'private';
    const spaceId = asTrimmedString(req.body.space_id || '') || null;

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: 'Repository name must be between 2 and 120 characters.' });
    }

    if (description && description.length > 2000) {
      return res.status(400).json({ error: 'Repository description must be 2000 characters or fewer.' });
    }

    if (!isSafeRef(defaultBranch)) {
      return res.status(400).json({ error: 'Invalid default branch.' });
    }

    if (!isAllowedValue(visibility, REPO_VISIBILITIES)) {
      return res.status(400).json({ error: 'Invalid repository visibility.' });
    }

    let attachedSpace = null;
    if (spaceId) {
      attachedSpace = await getSpaceOr404(spaceId, res);
      if (!attachedSpace) return;

      const membership = await getMembership(spaceId, userId);
      if (!(attachedSpace.owner_id === userId || isMaintainerOrOwner(membership))) {
        return res.status(403).json({ error: 'Only the space owner or maintainer can create attached repositories.' });
      }
    }

    const slug = await buildOwnerScopedSlug(userId, req.body.slug || name);
    if (!slug) {
      return res.status(400).json({ error: 'Unable to generate a valid repository slug.' });
    }

    repo = await ProjectSpaceRepo.create({
      owner_id: userId,
      space_id: spaceId,
      name,
      slug,
      description,
      default_branch: defaultBranch,
      visibility,
      created_by: userId,
    });

    await initializeBareRepository(getRepoPath(repo.id), defaultBranch);

    if (spaceId) {
      const existingCount = await ProjectSpaceRepoAttachment.count({
        where: { space_id: spaceId },
      });

      await ProjectSpaceRepoAttachment.create({
        space_id: spaceId,
        repo_id: repo.id,
        external_url: null,
        label: repo.name,
        position: existingCount,
        is_primary: existingCount === 0,
        attached_by: userId,
      });
    }

    return res.status(201).json({
      repo: await serializeRepo(
        await ProjectSpaceRepo.findByPk(repo.id, {
          include: [
            { model: ProjectSpace, as: 'space', required: false },
            { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
          ],
        }),
        userId,
        { includeCommunityFiles: true, includeGovernance: true }
      ),
    });
  } catch (error) {
    if (repo) {
      await repo.destroy().catch(() => null);
    }
    return res.status(500).json({ error: 'Failed to create repository.' });
  }
}

async function getRepository(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, requesterId, res);
    if (!result) return;

    return res.json({
      repo: await serializeRepo(result.repo, requesterId, { includeCommunityFiles: true, includeGovernance: true }),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repository.' });
  }
}

async function updateRepository(req, res) {
  try {
    const result = await ensureRepoCapability(req.params.repoId, req.user.userId, res, 'can_manage_general');
    if (!result) return;

    const { repo } = result;
    const updates = {};

    if (req.body.name !== undefined) {
      const name = asTrimmedString(req.body.name);
      if (name.length < 2 || name.length > 120) {
        return res.status(400).json({ error: 'Repository name must be between 2 and 120 characters.' });
      }
      updates.name = name;
    }

    if (req.body.description !== undefined) {
      const description = asTrimmedString(req.body.description) || null;
      if (description && description.length > 2000) {
        return res.status(400).json({ error: 'Repository description must be 2000 characters or fewer.' });
      }
      updates.description = description;
    }

    if (req.body.visibility !== undefined) {
      const visibility = asTrimmedString(req.body.visibility);
      if (!isAllowedValue(visibility, REPO_VISIBILITIES)) {
        return res.status(400).json({ error: 'Invalid repository visibility.' });
      }
      updates.visibility = visibility;
    }

    if (req.body.slug !== undefined) {
      const slug = await buildOwnerScopedSlug(repo.owner_id, req.body.slug, repo.id);
      if (!slug) {
        return res.status(400).json({ error: 'Invalid repository slug.' });
      }
      updates.slug = slug;
    }

    if (req.body.default_branch !== undefined) {
      const defaultBranch = asTrimmedString(req.body.default_branch);
      if (!defaultBranch || !isSafeRef(defaultBranch)) {
        return res.status(400).json({ error: 'Invalid default branch.' });
      }
      updates.default_branch = defaultBranch;
    }

    updates.updated_at = new Date();
    await repo.update(updates);

    if (updates.default_branch) {
      await setDefaultBranch(await resolveRepoPath(repo.id, repo.space_id), updates.default_branch);
    }

    return res.json({
      repo: await serializeRepo(
        await ProjectSpaceRepo.findByPk(repo.id, {
          include: [
            { model: ProjectSpace, as: 'space', required: false },
            { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
          ],
        }),
        req.user.userId,
        { includeCommunityFiles: true, includeGovernance: true }
      ),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update repository.' });
  }
}

async function archiveRepository(req, res) {
  try {
    const result = await ensureRepoCapability(req.params.repoId, req.user.userId, res, 'can_archive');
    if (!result) return;

    await result.repo.update({
      archived_at: new Date(),
      updated_at: new Date(),
    });

    return res.json({ archived: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to archive repository.' });
  }
}

module.exports = {
  listRepositories,
  createRepository,
  getRepository,
  updateRepository,
  archiveRepository,
  serializeRepo,
};
