const { RepoStar, RepoWatch, User } = require('../../models');
const { ensureRepoReadable } = require('../../services/spaces/repoAccess');

async function toggleStar(req, res) {
  try {
    const userId = req.user.userId;
    const repoId = req.params.repoId;

    const result = await ensureRepoReadable(repoId, userId, res);
    if (!result) return;

    const existing = await RepoStar.findOne({ where: { repo_id: repoId, user_id: userId } });
    if (existing) {
      await existing.destroy();
      const count = await RepoStar.count({ where: { repo_id: repoId } });
      return res.json({ starred: false, star_count: count });
    }

    await RepoStar.create({ repo_id: repoId, user_id: userId });
    const count = await RepoStar.count({ where: { repo_id: repoId } });
    return res.json({ starred: true, star_count: count });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to toggle star.' });
  }
}

async function unstar(req, res) {
  try {
    const userId = req.user.userId;
    const repoId = req.params.repoId;

    await RepoStar.destroy({ where: { repo_id: repoId, user_id: userId } });
    const count = await RepoStar.count({ where: { repo_id: repoId } });
    return res.json({ starred: false, star_count: count });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to unstar.' });
  }
}

async function listStargazers(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const stars = await RepoStar.findAll({
      where: { repo_id: req.params.repoId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'username', 'email'] }],
      order: [['created_at', 'DESC']],
    });

    return res.json({
      stargazers: stars.map((s) => s.user).filter(Boolean),
      star_count: stars.length,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list stargazers.' });
  }
}

async function setWatch(req, res) {
  try {
    const userId = req.user.userId;
    const repoId = req.params.repoId;
    const level = req.body.level || 'all';

    const result = await ensureRepoReadable(repoId, userId, res);
    if (!result) return;

    const [watch] = await RepoWatch.upsert({
      repo_id: repoId,
      user_id: userId,
      level,
    }, { returning: true });

    const count = await RepoWatch.count({ where: { repo_id: repoId } });
    return res.json({ watching: true, level: watch.level, watcher_count: count });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to set watch.' });
  }
}

async function unwatch(req, res) {
  try {
    const userId = req.user.userId;
    const repoId = req.params.repoId;

    await RepoWatch.destroy({ where: { repo_id: repoId, user_id: userId } });
    const count = await RepoWatch.count({ where: { repo_id: repoId } });
    return res.json({ watching: false, watcher_count: count });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to unwatch.' });
  }
}

async function listWatchers(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const watches = await RepoWatch.findAll({
      where: { repo_id: req.params.repoId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'username', 'email'] }],
      order: [['created_at', 'DESC']],
    });

    return res.json({
      watchers: watches.map((w) => ({ ...w.user?.toJSON(), level: w.level })).filter((w) => w.id),
      watcher_count: watches.length,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list watchers.' });
  }
}

module.exports = {
  toggleStar,
  unstar,
  listStargazers,
  setWatch,
  unwatch,
  listWatchers,
};
