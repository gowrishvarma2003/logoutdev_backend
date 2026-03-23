const { RepoRelease, User } = require('../../models');
const { ensureRepoReadable, ensureRepoWritable } = require('../../services/spaces/repoAccess');

async function listReleases(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const releases = await RepoRelease.findAll({
      where: { repo_id: req.params.repoId },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'username'] }],
      order: [['created_at', 'DESC']],
    });

    return res.json({ releases });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list releases.' });
  }
}

async function createRelease(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const tagName = (req.body.tag_name || '').trim();
    const title = (req.body.title || '').trim();
    const body = req.body.body || '';
    const isPrerelease = Boolean(req.body.is_prerelease);
    const isDraft = Boolean(req.body.is_draft);

    if (!tagName) return res.status(400).json({ error: 'Tag name is required.' });
    if (!title) return res.status(400).json({ error: 'Release title is required.' });

    const existing = await RepoRelease.findOne({
      where: { repo_id: req.params.repoId, tag_name: tagName },
    });
    if (existing) return res.status(409).json({ error: 'A release for this tag already exists.' });

    const release = await RepoRelease.create({
      repo_id: req.params.repoId,
      tag_name: tagName,
      title,
      body,
      is_draft: isDraft,
      is_prerelease: isPrerelease,
      created_by: req.user.userId,
      published_at: isDraft ? null : new Date(),
    });

    const reloaded = await RepoRelease.findByPk(release.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'username'] }],
    });

    return res.status(201).json({ release: reloaded });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create release.' });
  }
}

async function getRelease(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const release = await RepoRelease.findOne({
      where: { id: req.params.releaseId, repo_id: req.params.repoId },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'username'] }],
    });

    if (!release) return res.status(404).json({ error: 'Release not found.' });
    return res.json({ release });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch release.' });
  }
}

async function updateRelease(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const release = await RepoRelease.findOne({
      where: { id: req.params.releaseId, repo_id: req.params.repoId },
    });
    if (!release) return res.status(404).json({ error: 'Release not found.' });

    const updates = {};
    if (req.body.title !== undefined) updates.title = String(req.body.title).trim();
    if (req.body.body !== undefined) updates.body = req.body.body;
    if (req.body.is_prerelease !== undefined) updates.is_prerelease = Boolean(req.body.is_prerelease);
    if (req.body.is_draft !== undefined) {
      updates.is_draft = Boolean(req.body.is_draft);
      if (!updates.is_draft && !release.published_at) updates.published_at = new Date();
    }
    updates.updated_at = new Date();

    await release.update(updates);

    const reloaded = await RepoRelease.findByPk(release.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'username'] }],
    });

    return res.json({ release: reloaded });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update release.' });
  }
}

async function deleteRelease(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const release = await RepoRelease.findOne({
      where: { id: req.params.releaseId, repo_id: req.params.repoId },
    });
    if (!release) return res.status(404).json({ error: 'Release not found.' });

    await release.destroy();
    return res.json({ deleted: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete release.' });
  }
}

module.exports = {
  listReleases,
  createRelease,
  getRelease,
  updateRelease,
  deleteRelease,
};
