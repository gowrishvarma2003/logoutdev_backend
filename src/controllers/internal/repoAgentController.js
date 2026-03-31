const { getRepoOr404 } = require('../../services/spaces/repoAccess');
const { resolveRepoPath } = require('../../services/git/gitPath');
const {
  isSafeRef,
  listTreeRecursive,
  readBlob,
  listCommits,
  getDiffBetweenRefs,
  getRefOid,
  branchExists,
  ensureBranch,
  writeFilesBatch,
} = require('../../services/git/gitShell');
const {
  AGENT_BRANCH_NAME,
  AGENT_ARTIFACT_ROOT,
  validateAgentBranchName,
  normalizeInternalPath,
  isAllowedAgentArtifactPath,
} = require('../../services/internal/repoAgentPolicy');
const { buildBlobPreview, buildInventory } = require('../../services/repos/repoDocInventory');
const { logger } = require('../../logging/logger');
const MAX_BATCH_PATHS = 200;

async function loadInternalRepo(req, res) {
  return getRepoOr404(req.params.repoId, res);
}

function audit(req, action, metadata = {}) {
  logger.info('Internal repo-doc agent action', {
    action,
    service_id: req.internalService?.id || null,
    repo_id: req.params.repoId,
    ...metadata,
  });
}

function parseBlobBatchArgs(repo, req, res) {
  const ref = typeof req.body?.ref === 'string' && req.body.ref.trim()
    ? req.body.ref.trim()
    : repo.default_branch;
  const paths = Array.isArray(req.body?.paths)
    ? req.body.paths.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (!isSafeRef(ref)) {
    res.status(400).json({ error: 'Invalid ref.' });
    return null;
  }
  if (paths.length === 0) {
    res.status(400).json({ error: 'At least one path is required.' });
    return null;
  }
  if (paths.length > MAX_BATCH_PATHS) {
    res.status(400).json({ error: `A maximum of ${MAX_BATCH_PATHS} paths can be fetched at once.` });
    return null;
  }

  return { ref, paths };
}

async function getInventory(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const ref = typeof req.body?.ref === 'string' && req.body.ref.trim()
      ? req.body.ref.trim()
      : repo.default_branch;
    if (!isSafeRef(ref)) {
      return res.status(400).json({ error: 'Invalid ref.' });
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const [entries, head] = await Promise.all([
      listTreeRecursive(repoPath, ref, ''),
      getRefOid(repoPath, ref),
    ]);

    audit(req, 'get_inventory', { ref, file_count: entries.length });
    return res.json({
      repo_id: repo.id,
      ref,
      head,
      inventory: buildInventory(entries),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to build repository inventory.' });
  }
}

async function readBlobsBatch(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const args = parseBlobBatchArgs(repo, req, res);
    if (!args) return;
    const { ref, paths } = args;

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const blobs = [];
    for (const path of paths) {
      try {
        const blob = await readBlob(repoPath, ref, path);
        blobs.push({
          path,
          ...blob,
        });
      } catch (error) {
        blobs.push({
          path,
          error: error.message || 'Failed to read blob.',
        });
      }
    }

    audit(req, 'read_blobs_batch', { ref, path_count: paths.length });
    return res.json({
      repo_id: repo.id,
      ref,
      blobs,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch repository blobs.' });
  }
}

async function readBlobsPreviewBatch(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const args = parseBlobBatchArgs(repo, req, res);
    if (!args) return;
    const { ref, paths } = args;
    const maxChars = Math.max(Number(req.body?.max_chars) || 2200, 400);

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const previews = [];
    for (const path of paths) {
      try {
        const blob = await readBlob(repoPath, ref, path);
        previews.push(buildBlobPreview({
          path,
          ...blob,
        }, { maxChars }));
      } catch (error) {
        previews.push({
          path,
          error: error.message || 'Failed to build blob preview.',
        });
      }
    }

    audit(req, 'read_blobs_preview_batch', { ref, path_count: paths.length });
    return res.json({
      repo_id: repo.id,
      ref,
      previews,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch repository previews.' });
  }
}

async function getRecentCommits(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const ref = typeof req.query.ref === 'string' && req.query.ref.trim()
      ? req.query.ref.trim()
      : repo.default_branch;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    if (!isSafeRef(ref)) {
      return res.status(400).json({ error: 'Invalid ref.' });
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const commits = await listCommits(repoPath, ref, '', page, limit);
    audit(req, 'get_commits', { ref, page, limit });
    return res.json({
      repo_id: repo.id,
      ref,
      commits,
      page,
      limit,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch commits.' });
  }
}

async function getDiff(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const fromCommit = typeof req.query.from_commit === 'string' ? req.query.from_commit.trim() : '';
    const toCommit = typeof req.query.to_commit === 'string' ? req.query.to_commit.trim() : '';

    if (!isSafeRef(fromCommit) || !isSafeRef(toCommit)) {
      return res.status(400).json({ error: 'Invalid diff refs.' });
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const diff = await getDiffBetweenRefs(repoPath, fromCommit, toCommit);
    audit(req, 'get_diff', { from_commit: fromCommit, to_commit: toCommit, files_changed: diff.stats.files_changed });
    return res.json(diff);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch diff.' });
  }
}

async function getBranchHead(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const branch = typeof req.query.branch === 'string' ? req.query.branch.trim() : '';
    if (!isSafeRef(branch)) {
      return res.status(400).json({ error: 'Invalid branch.' });
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const exists = await branchExists(repoPath, branch);
    if (!exists) {
      return res.json({ repo_id: repo.id, branch, head: null, exists: false });
    }

    const head = await getRefOid(repoPath, `refs/heads/${branch}`);
    audit(req, 'get_branch_head', { branch, head });
    return res.json({ repo_id: repo.id, branch, head, exists: true });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch branch head.' });
  }
}

async function ensureAiBranch(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const branchName = typeof req.body?.branch_name === 'string' && req.body.branch_name.trim()
      ? req.body.branch_name.trim()
      : AGENT_BRANCH_NAME;
    const baseRef = typeof req.body?.base_ref === 'string' && req.body.base_ref.trim()
      ? req.body.base_ref.trim()
      : repo.default_branch;

    if (!validateAgentBranchName(branchName)) {
      return res.status(400).json({ error: `Only ${AGENT_BRANCH_NAME} can be managed by the agent service.` });
    }
    if (!isSafeRef(baseRef)) {
      return res.status(400).json({ error: 'Invalid base ref.' });
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const branch = await ensureBranch(repoPath, branchName, baseRef);
    audit(req, 'ensure_ai_branch', { branch_name: branchName, base_ref: baseRef, created: branch.created });
    return res.json({
      repo_id: repo.id,
      branch_name: branchName,
      base_ref: baseRef,
      ...branch,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to ensure AI branch.' });
  }
}

async function commitAiArtifacts(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const branchName = typeof req.body?.branch_name === 'string' && req.body.branch_name.trim()
      ? req.body.branch_name.trim()
      : AGENT_BRANCH_NAME;
    const expectedHead = req.body?.expected_head ? String(req.body.expected_head).trim() : null;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const files = Array.isArray(req.body?.files) ? req.body.files : [];

    if (!validateAgentBranchName(branchName)) {
      return res.status(400).json({ error: `Only ${AGENT_BRANCH_NAME} can be written by the agent service.` });
    }
    if (!message) {
      return res.status(400).json({ error: 'Commit message is required.' });
    }
    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required.' });
    }

    const normalizedFiles = files.map((file) => ({
      path: normalizeInternalPath(file?.path),
      content: file?.content ?? '',
      delete: Boolean(file?.delete),
    }));

    if (normalizedFiles.some((file) => !isAllowedAgentArtifactPath(file.path))) {
      return res.status(400).json({ error: `Agent commits may only write under ${AGENT_ARTIFACT_ROOT}/.` });
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const commit = await writeFilesBatch(
      repoPath,
      branchName,
      normalizedFiles,
      message,
      {
        name: typeof req.body?.author?.name === 'string' && req.body.author.name.trim()
          ? req.body.author.name.trim()
          : 'LogoutDev Repo Doc Agent',
        email: typeof req.body?.author?.email === 'string' && req.body.author.email.trim()
          ? req.body.author.email.trim()
          : 'repo-doc-agent@logoutdev.local',
      },
      { expectedHead }
    );

    audit(req, 'commit_ai_artifacts', { branch_name: branchName, file_count: normalizedFiles.length, commit: commit.oid });
    return res.status(201).json({
      repo_id: repo.id,
      branch_name: branchName,
      commit,
    });
  } catch (error) {
    const msg = error.message || 'Failed to commit AI artifacts.';
    const statusCode = msg === 'Branch head changed before publish.' ? 409
      : msg === 'Expected branch head does not exist.' ? 409
      : 400;
    logger.warn('commitAiArtifacts failed', {
      repo_id: req.params.repoId,
      branch_name: req.body?.branch_name,
      error: msg,
    });
    return res.status(statusCode).json({ error: msg });
  }
}

async function getExistingAgentArtifacts(req, res) {
  try {
    const repo = await loadInternalRepo(req, res);
    if (!repo) return;

    const branchName = typeof req.query.branch === 'string' && req.query.branch.trim()
      ? req.query.branch.trim()
      : AGENT_BRANCH_NAME;
    if (!validateAgentBranchName(branchName)) {
      return res.status(400).json({ error: `Only ${AGENT_BRANCH_NAME} artifacts are available.` });
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    const exists = await branchExists(repoPath, branchName);
    if (!exists) {
      return res.json({
        repo_id: repo.id,
        branch_name: branchName,
        head: null,
        artifacts: [],
      });
    }

    const entries = await listTreeRecursive(repoPath, branchName, AGENT_ARTIFACT_ROOT);
    const artifacts = [];
    for (const entry of entries.filter((candidate) => candidate.type === 'blob')) {
      const blob = await readBlob(repoPath, branchName, entry.path);
      artifacts.push({
        path: entry.path,
        oid: blob.oid,
        size: blob.size,
        is_binary: blob.is_binary,
        content: blob.content,
        encoding: blob.encoding,
      });
    }

    const head = await getRefOid(repoPath, `refs/heads/${branchName}`);
    audit(req, 'get_existing_agent_artifacts', { branch_name: branchName, artifact_count: artifacts.length });
    return res.json({
      repo_id: repo.id,
      branch_name: branchName,
      head,
      artifacts,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to fetch existing agent artifacts.' });
  }
}

module.exports = {
  AGENT_BRANCH_NAME,
  AGENT_ARTIFACT_ROOT,
  getInventory,
  readBlobsBatch,
  readBlobsPreviewBatch,
  getRecentCommits,
  getDiff,
  getBranchHead,
  ensureAiBranch,
  commitAiArtifacts,
  getExistingAgentArtifacts,
};
