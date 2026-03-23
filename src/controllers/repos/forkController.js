const {
  ProjectSpaceRepo,
  ProjectSpace,
  RepoFork,
  User,
} = require('../../models');
const { ensureRepoReadable, getAccessContext } = require('../../services/spaces/repoAccess');
const { getRepoPath, resolveRepoPath } = require('../../services/git/gitPath');
const { forkRepository } = require('../../services/git/gitShell');
const { serializeRepo } = require('./repositoryController');

async function forkRepo(req, res) {
  try {
    const userId = req.user.userId;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const sourceRepo = result.repo;

    // Check if user already forked this repo
    const existingFork = await RepoFork.findOne({
      where: { source_repo_id: sourceRepo.id, forked_by: userId },
    });
    if (existingFork) {
      return res.status(409).json({ error: 'You have already forked this repository.' });
    }

    // Create the forked repo record
    const forkedRepo = await ProjectSpaceRepo.create({
      owner_id: userId,
      space_id: null,
      name: sourceRepo.name,
      slug: `${sourceRepo.slug}-fork-${Date.now().toString(36)}`,
      description: `Forked from ${sourceRepo.owner?.username || 'unknown'}/${sourceRepo.name}`,
      default_branch: sourceRepo.default_branch,
      visibility: sourceRepo.visibility,
      created_by: userId,
    });

    try {
      // Clone the bare repository
      const sourceRepoPath = await resolveRepoPath(sourceRepo.id, sourceRepo.space_id);
      const destRepoPath = getRepoPath(forkedRepo.id);
      await forkRepository(sourceRepoPath, destRepoPath);

      // Record the fork relationship
      await RepoFork.create({
        source_repo_id: sourceRepo.id,
        forked_repo_id: forkedRepo.id,
        forked_by: userId,
      });

      const reloaded = await ProjectSpaceRepo.findByPk(forkedRepo.id, {
        include: [
          { model: ProjectSpace, as: 'space', required: false },
          { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'username'], required: false },
        ],
      });

      return res.status(201).json({
        repo: await serializeRepo(reloaded, userId),
        fork: {
          source_repo_id: sourceRepo.id,
          source_repo_name: sourceRepo.name,
          source_owner: sourceRepo.owner?.username || null,
        },
      });
    } catch (error) {
      await forkedRepo.destroy().catch(() => null);
      throw error;
    }
  } catch (error) {
    if (error.status === 409 || res.statusCode === 409) return;
    return res.status(500).json({ error: error.message || 'Failed to fork repository.' });
  }
}

async function listForks(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const forks = await RepoFork.findAll({
      where: { source_repo_id: req.params.repoId },
      include: [
        {
          model: ProjectSpaceRepo,
          as: 'forked_repo',
          include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'username'] }],
        },
        { model: User, as: 'forker', attributes: ['id', 'name', 'username'] },
      ],
      order: [['created_at', 'DESC']],
    });

    return res.json({
      forks: forks.map((f) => ({
        id: f.id,
        repo: f.forked_repo
          ? {
              id: f.forked_repo.id,
              name: f.forked_repo.name,
              slug: f.forked_repo.slug,
              visibility: f.forked_repo.visibility,
              owner: f.forked_repo.owner,
            }
          : null,
        forker: f.forker,
        created_at: f.created_at,
      })),
      fork_count: forks.length,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list forks.' });
  }
}

module.exports = {
  forkRepo,
  listForks,
};
