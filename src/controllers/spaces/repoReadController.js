const { parsePagination } = require('../../services/spaces/pagination');
const { ensureRepoReadable } = require('../../services/spaces/repoAccess');
const { getRepoPath } = require('../../services/git/gitPath');
const {
  normalizeRepoPath,
  isSafeRef,
  listTree,
  readBlob,
  findReadme,
  listCommits,
} = require('../../services/git/gitShell');

async function getTree(req, res) {
  try {
    const result = await ensureRepoReadable(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    const ref = typeof req.query.ref === 'string' && req.query.ref ? req.query.ref : result.repo.default_branch;
    const treePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!isSafeRef(ref)) {
      return res.status(400).json({ error: 'Invalid ref.' });
    }

    const entries = await listTree(getRepoPath(result.repo.space_id, result.repo.id), ref, treePath);

    return res.json({
      ref,
      path: normalizeRepoPath(treePath),
      entries,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch repository tree.' });
  }
}

async function getBlob(req, res) {
  try {
    const result = await ensureRepoReadable(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    const ref = typeof req.query.ref === 'string' && req.query.ref ? req.query.ref : result.repo.default_branch;
    const blobPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!isSafeRef(ref)) {
      return res.status(400).json({ error: 'Invalid ref.' });
    }

    const blob = await readBlob(getRepoPath(result.repo.space_id, result.repo.id), ref, blobPath);

    return res.json({
      ref,
      path: normalizeRepoPath(blobPath),
      ...blob,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch repository blob.' });
  }
}

async function getReadme(req, res) {
  try {
    const result = await ensureRepoReadable(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    const ref = typeof req.query.ref === 'string' && req.query.ref ? req.query.ref : result.repo.default_branch;
    if (!isSafeRef(ref)) {
      return res.status(400).json({ error: 'Invalid ref.' });
    }

    const readme = await findReadme(getRepoPath(result.repo.space_id, result.repo.id), ref);
    return res.json({ readme });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch README.' });
  }
}

async function getCommits(req, res) {
  try {
    const result = await ensureRepoReadable(req.params.spaceId, req.params.repoId, req.user.userId, res);
    if (!result) return;

    const ref = typeof req.query.ref === 'string' && req.query.ref ? req.query.ref : result.repo.default_branch;
    const commitPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!isSafeRef(ref)) {
      return res.status(400).json({ error: 'Invalid ref.' });
    }

    const { page, limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const commits = await listCommits(
      getRepoPath(result.repo.space_id, result.repo.id),
      ref,
      commitPath,
      page,
      limit
    );

    return res.json({
      ref,
      page,
      limit,
      commits,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch commits.' });
  }
}

module.exports = {
  getTree,
  getBlob,
  getReadme,
  getCommits,
};
