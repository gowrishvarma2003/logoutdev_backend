const { Op } = require('sequelize');
const {
  ProjectSpaceRepo,
  ProjectSpaceRepoMember,
  ProjectSpace,
  User,
  ProjectSpaceRepoAttachment,
} = require('../../models');
const { getSpaceOr404, getMembership, ensureSpaceReadable, isMaintainerOrOwner } = require('../../services/spaces/spaceAccess');
const { slugify, asTrimmedString, isAllowedValue, REPO_VISIBILITIES } = require('../../services/spaces/spaceValidation');
const { getRepoPath, resolveRepoPath } = require('../../services/git/gitPath');
const { initializeBareRepository, setDefaultBranch, isSafeRef } = require('../../services/git/gitShell');
const { serializeRepo } = require('../repos/repositoryController');
const { getAccessContext, ensureLegacyRepoAdmin, ensureLegacyRepoReadable } = require('../../services/spaces/repoAccess');

async function listRepos(req, res) {
  try {
    const userId = req.user.userId;
    const space = await ensureSpaceReadable(req.params.spaceId, userId, res);
    if (!space) return;

    const repos = await ProjectSpaceRepo.findAll({
      where: { space_id: space.id, archived_at: null },
      include: [
        { model: ProjectSpace, as: 'space', required: false },
        { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
        {
          model: ProjectSpaceRepoMember,
          as: 'members',
          where: { user_id: userId },
          attributes: [],
          required: false,
        },
      ],
      order: [['created_at', 'DESC']],
    });

    const payload = [];
    for (const repo of repos) {
      // eslint-disable-next-line no-await-in-loop
      const access = await getAccessContext(repo, userId);
      if (!access.canRead) continue;
      // eslint-disable-next-line no-await-in-loop
      payload.push(await serializeRepo(repo, userId));
    }

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
    const visibility = asTrimmedString(req.body.visibility || 'private') || 'private';

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

    const baseSlug = slugify(req.body.slug || name);
    if (!baseSlug) {
      return res.status(400).json({ error: 'Unable to generate a valid repository slug.' });
    }

    let slug = baseSlug;
    let counter = 1;
    while (await ProjectSpaceRepo.findOne({ where: { owner_id: userId, slug, archived_at: null } })) {
      counter += 1;
      slug = `${baseSlug}-${counter}`;
    }

    repo = await ProjectSpaceRepo.create({
      owner_id: userId,
      space_id: space.id,
      name,
      slug,
      description,
      default_branch: defaultBranch,
      visibility,
      created_by: userId,
    });

    await initializeBareRepository(getRepoPath(repo.id), defaultBranch);
    const existingCount = await ProjectSpaceRepoAttachment.count({
      where: { space_id: space.id },
    });
    await ProjectSpaceRepoAttachment.findOrCreate({
      where: { repo_id: repo.id },
      defaults: {
        space_id: space.id,
        repo_id: repo.id,
        external_url: null,
        label: repo.name,
        position: existingCount,
        is_primary: existingCount === 0,
        attached_by: userId,
      },
    });

    return res.status(201).json({
      repo: await serializeRepo(
        await ProjectSpaceRepo.findByPk(repo.id, {
          include: [
            { model: ProjectSpace, as: 'space', required: false },
            { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
          ],
        }),
        userId
      ),
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
    const result = await ensureLegacyRepoReadable(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    return res.json({
      repo: await serializeRepo(result.repo, req.user.userId, { includeCommunityFiles: true }),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch repository.' });
  }
}

async function updateRepo(req, res) {
  try {
    const result = await ensureLegacyRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
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
          owner_id: repo.owner_id,
          slug: nextSlug,
          id: { [Op.ne]: repo.id },
          archived_at: null,
        },
      });
      if (existing) {
        return res.status(409).json({ error: 'This repository slug is already in use for the owner.' });
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

    if (req.body.visibility !== undefined) {
      const visibility = asTrimmedString(req.body.visibility);
      if (!isAllowedValue(visibility, REPO_VISIBILITIES)) {
        return res.status(400).json({ error: 'Invalid repository visibility.' });
      }
      updates.visibility = visibility;
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
        { includeCommunityFiles: true }
      ),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update repository.' });
  }
}

async function archiveRepo(req, res) {
  try {
    const result = await ensureLegacyRepoAdmin(req.params.spaceId, req.params.repoId, req.user.userId, res);
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
