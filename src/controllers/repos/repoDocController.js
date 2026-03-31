const { ensureRepoReadable } = require('../../services/spaces/repoAccess');
const { isSafeRef } = require('../../services/git/gitShell');
const {
  getRepoDocStatus,
  getRepoDocRuns,
} = require('../../services/agents/repoDocAgentClient');
const { triggerRepoDocRefresh, resolveRepoDocSource } = require('../../services/repos/repoDocRefresh');

async function resolveRepoSource(req, res) {
  const userId = req.user?.userId || null;
  const result = await ensureRepoReadable(req.params.repoId, userId, res);
  if (!result) return null;

  const sourceBranch = typeof req.body?.source_branch === 'string' && req.body.source_branch.trim()
    ? req.body.source_branch.trim()
    : result.repo.default_branch;
  if (!isSafeRef(sourceBranch)) {
    res.status(400).json({ error: 'Invalid source branch.' });
    return null;
  }
  const source = await resolveRepoDocSource({
    repo: result.repo,
    sourceBranch,
  });

  return {
    repo: result.repo,
    source_branch: source.source_branch,
    source_commit: source.source_commit,
  };
}

async function ensureRepoDoc(req, res) {
  try {
    const source = await resolveRepoSource(req, res);
    if (!source) return;

    const response = await triggerRepoDocRefresh({
      repo: source.repo,
      sourceBranch: source.source_branch,
      sourceCommit: source.source_commit,
      trigger: typeof req.body?.trigger === 'string' && req.body.trigger.trim()
        ? req.body.trigger.trim()
        : 'repo_opened',
      requestedByUserId: req.user?.userId || null,
      requestedByUsername: req.user?.username || null,
      force: false,
    });

    return res.status(202).json({
      repo_id: source.repo.id,
      source_branch: source.source_branch,
      source_commit: source.source_commit,
      ...response,
    });
  } catch (error) {
    const message = error.message || 'Failed to enqueue repo documentation job.';
    const isUserError = message.includes('no commits') || message.includes('Invalid');
    return res.status(isUserError ? 400 : 503).json({ error: message });
  }
}

async function fetchRepoDocStatus(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const status = await getRepoDocStatus(result.repo.id);
    return res.json(status);
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Failed to fetch repo documentation status.' });
  }
}

async function fetchRepoDocRuns(req, res) {
  try {
    const userId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, userId, res);
    if (!result) return;

    const runs = await getRepoDocRuns(result.repo.id);
    return res.json(runs);
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Failed to fetch repo documentation runs.' });
  }
}

async function forceRegenerateRepoDoc(req, res) {
  try {
    const source = await resolveRepoSource(req, res);
    if (!source) return;

    const response = await triggerRepoDocRefresh({
      repo: source.repo,
      sourceBranch: source.source_branch,
      sourceCommit: source.source_commit,
      trigger: 'manual_regenerate',
      requestedByUserId: req.user?.userId || null,
      requestedByUsername: req.user?.username || null,
      force: true,
    });

    return res.status(202).json({
      repo_id: source.repo.id,
      source_branch: source.source_branch,
      source_commit: source.source_commit,
      ...response,
    });
  } catch (error) {
    const message = error.message || 'Failed to regenerate repo documentation.';
    const isUserError = message.includes('no commits') || message.includes('Invalid');
    return res.status(isUserError ? 400 : 503).json({ error: message });
  }
}

module.exports = {
  ensureRepoDoc,
  fetchRepoDocStatus,
  fetchRepoDocRuns,
  forceRegenerateRepoDoc,
};
