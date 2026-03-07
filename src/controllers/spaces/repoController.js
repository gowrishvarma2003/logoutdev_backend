const { Op } = require('sequelize');
const {
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
} = require('../../models');
const { getSpaceOr404, getMembership, ensureSpaceReadable, isMaintainerOrOwner } = require('../../services/spaces/spaceAccess');
const { slugify, asTrimmedString } = require('../../services/spaces/spaceValidation');
const { getRepoPath } = require('../../services/git/gitPath');
const { initializeBareRepository, setDefaultBranch, isSafeRef } = require('../../services/git/gitShell');
const { getAccessContext, ensureRepoAdmin, ensureRepoReadable } = require('../../services/spaces/repoAccess');

async function listRepos(req, res) {
  try {
    const userId = req.user.userId;
    const space = await ensureSpaceReadable(req.params.spaceId, userId, res);
    if (!space) return;

    const membership = await getMembership(space.id, userId);
    const isAdmin = space.owner_id === userId || isMaintainerOrOwner(membership);

    if (!isAdmin && !membership) {
      return res.json({ repos: [] });
    }

    let repos = [];
    if (isAdmin) {
      repos = await ProjectSpaceRepo.findAll({
        where: { space_id: space.id, archived_at: null },
        order: [['created_at', 'DESC']],
      });
    } else {
      repos = await ProjectSpaceRepo.findAll({
        where: { space_id: space.id, archived_at: null },
        include: [
          {
            model: ProjectSpaceRepoMember,
            as: 'members',
            where: { user_id: userId },
            attributes: [],
            required: true,
          },
        ],
        order: [['created_at', 'DESC']],
      });
    }

    const payload = await Promise.all(repos.map(async (repo) => {
      const access = await getAccessContext(repo, userId);
      return {
        ...repo.toJSON(),
        my_role: access.my_role,
      };
    }));

    return res.json({ repos: payload });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repositories.' });
  }
}

async function createRepo(req, res) {
  let repo = null;

  try {
    const userId = req.user.userId;
    const space = await getSpaceOr404(req.params.spaceId, res);
    if (!space) return;

    const membership = await getMembership(space.id, userId);
    if (!(space.owner_id === userId || isMaintainerOrOwner(membership))) {
      return res.status(403).json({ error: 'Only space owner or maintainer can create repositories.' });
    }

    const name = asTrimmedString(req.body.name);
    const description = asTrimmedString(req.body.description) || null;
    const defaultBranch = asTrimmedString(req.body.default_branch || 'main') || 'main';

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: 'Repository name must be between 2 and 120 characters.' });
    }

    if (description && description.length > 2000) {
      return res.status(400).json({ error: 'Repository description must be 2000 characters or fewer.' });
    }

    if (!isSafeRef(defaultBranch)) {
      return res.status(400).json({ error: 'Invalid default branch.' });
    }

    const baseSlug = slugify(req.body.slug || name);
    if (!baseSlug) {
      return res.status(400).json({ error: 'Unable to generate a valid repository slug.' });
    }

    let slug = baseSlug;
    let counter = 1;
    while (await ProjectSpaceRepo.findOne({ where: { space_id: space.id, slug } })) {
      counter += 1;
      slug = `${baseSlug}-${counter}`;
    }

    repo = await ProjectSpaceRepo.create({
      space_id: space.id,
      name,
      slug,
      description,
      default_branch: defaultBranch,
      created_by: userId,
    });

    await initializeBareRepository(getRepoPath(space.id, repo.id), defaultBranch);

    return res.status(201).json({
      repo: {
        ...repo.toJSON(),
        my_role: 'admin',
      },
    });
  } catch (error) {
    if (repo) {
      await repo.destroy().catch(() => null);
    }
    return res.status(500).json({ error: 'Failed to create repository.' });
  }
}

async function getRepo(req, res) {
  try {
    const result = await ensureRepoReadable(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    return res.json({
      repo: {
        ...result.repo.toJSON(),
        my_role: result.access.my_role,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repository.' });
  }
}

async function updateRepo(req, res) {
  try {
    const result = await ensureRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
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

    if (req.body.slug !== undefined) {
      const nextSlug = slugify(req.body.slug);
      if (!nextSlug) {
        return res.status(400).json({ error: 'Invalid repository slug.' });
      }

      const existing = await ProjectSpaceRepo.findOne({
        where: {
          space_id: repo.space_id,
          slug: nextSlug,
          id: { [Op.ne]: repo.id },
        },
      });
      if (existing) {
        return res.status(409).json({ error: 'This repository slug is already in use in the space.' });
      }

      updates.slug = nextSlug;
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
      await setDefaultBranch(getRepoPath(repo.space_id, repo.id), updates.default_branch);
    }

    return res.json({
      repo: {
        ...repo.toJSON(),
        my_role: 'admin',
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update repository.' });
  }
}

async function archiveRepo(req, res) {
  try {
    const result = await ensureRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
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
  listRepos,
  createRepo,
  getRepo,
  updateRepo,
  archiveRepo,
};
