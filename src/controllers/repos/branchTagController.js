const { ensureRepoReadable, ensureRepoWritable } = require('../../services/spaces/repoAccess');
const { resolveRepoPath } = require('../../services/git/gitPath');
const {
  isSafeRef,
  listBranches,
  createBranch,
  deleteBranch,
  listTags,
  createTag,
  deleteTag,
  getCommitDetail,
} = require('../../services/git/gitShell');
const { getMatchingBranchProtectionRule, evaluateDirectBranchUpdate } = require('../../services/repos/repoGovernance');

async function listRepoBranches(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    const branches = await listBranches(repoPath);

    return res.json({ branches, default_branch: result.repo.default_branch });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to list branches.' });
  }
}

async function createRepoBranch(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const name = (req.body.name || '').trim();
    const startPoint = (req.body.start_point || 'HEAD').trim();

    if (!name) return res.status(400).json({ error: 'Branch name is required.' });
    if (!isSafeRef(name)) return res.status(400).json({ error: 'Invalid branch name.' });

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    const branch = await createBranch(repoPath, name, startPoint);

    return res.status(201).json({ branch });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to create branch.' });
  }
}

async function deleteRepoBranch(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const name = req.params.name;
    if (!isSafeRef(name)) return res.status(400).json({ error: 'Invalid branch name.' });

    const protectionRule = await getMatchingBranchProtectionRule(result.repo.id, name);
    const protection = evaluateDirectBranchUpdate({
      rule: protectionRule,
      access: result.access,
      branchName: name,
      isDeletion: true,
    });
    if (!protection.allowed) {
      return res.status(409).json({ error: protection.blocking_reasons[0] });
    }

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    await deleteBranch(repoPath, name);

    return res.json({ deleted: true });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to delete branch.' });
  }
}

async function listRepoTags(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    const tags = await listTags(repoPath);

    return res.json({ tags });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to list tags.' });
  }
}

async function createRepoTag(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const name = (req.body.name || '').trim();
    const ref = (req.body.ref || 'HEAD').trim();
    const message = req.body.message ? String(req.body.message).trim() : null;

    if (!name) return res.status(400).json({ error: 'Tag name is required.' });
    if (!isSafeRef(name)) return res.status(400).json({ error: 'Invalid tag name.' });

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    const tag = await createTag(repoPath, name, ref, message);

    return res.status(201).json({ tag });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to create tag.' });
  }
}

async function deleteRepoTag(req, res) {
  try {
    const result = await ensureRepoWritable(req.params.repoId, req.user.userId, res);
    if (!result) return;

    const name = req.params.name;
    if (!isSafeRef(name)) return res.status(400).json({ error: 'Invalid tag name.' });

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    await deleteTag(repoPath, name);

    return res.json({ deleted: true });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to delete tag.' });
  }
}

async function getRepoCommitDetail(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const oid = req.params.oid;
    if (!isSafeRef(oid)) return res.status(400).json({ error: 'Invalid commit ref.' });

    const repoPath = await resolveRepoPath(result.repo.id, result.repo.space_id);
    const commit = await getCommitDetail(repoPath, oid);

    return res.json({ commit });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch commit detail.' });
  }
}

module.exports = {
  listRepoBranches,
  createRepoBranch,
  deleteRepoBranch,
  listRepoTags,
  createRepoTag,
  deleteRepoTag,
  getRepoCommitDetail,
};
