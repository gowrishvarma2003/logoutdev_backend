const { logger } = require('../../logging/logger');
const { regenerateRepoDoc, enqueueRepoDocJob } = require('../agents/repoDocAgentClient');
const { resolveRepoPath } = require('../git/gitPath');
const { getRefOid, repoHasCommits } = require('../git/gitShell');

async function resolveRepoDocSource({ repo, sourceBranch, sourceCommit }) {
  const resolvedBranch = typeof sourceBranch === 'string' && sourceBranch.trim()
    ? sourceBranch.trim()
    : repo.default_branch;

  if (sourceCommit) {
    return {
      source_branch: resolvedBranch,
      source_commit: String(sourceCommit).trim(),
    };
  }

  const repoPath = await resolveRepoPath(repo.id, repo.space_id);
  const hasCommits = await repoHasCommits(repoPath, resolvedBranch).catch(() => false);
  if (!hasCommits) {
    throw new Error(`Repository has no commits on branch '${resolvedBranch}'. Push at least one commit before generating documentation.`);
  }
  const resolvedCommit = await getRefOid(repoPath, resolvedBranch);
  return {
    source_branch: resolvedBranch,
    source_commit: resolvedCommit,
  };
}

async function triggerRepoDocRefresh({
  repo,
  sourceBranch,
  sourceCommit,
  trigger = 'repo_opened',
  requestedByUserId = null,
  requestedByUsername = null,
  force = false,
}) {
  const source = await resolveRepoDocSource({
    repo,
    sourceBranch,
    sourceCommit,
  });

  const payload = {
    repo_id: repo.id,
    source_branch: source.source_branch,
    source_commit: source.source_commit,
    trigger,
    requested_by_user_id: requestedByUserId,
    requested_by_username: requestedByUsername,
  };

  let response;
  try {
    response = force
      ? await regenerateRepoDoc(repo.id, { ...payload, force: true })
      : await enqueueRepoDocJob(payload);
  } catch (error) {
    const agentError = error.message || 'Agent API request failed.';
    logger.warn('Repo doc agent call failed', {
      repo_id: repo.id,
      source_branch: source.source_branch,
      source_commit: source.source_commit,
      force,
      error: agentError,
    });
    throw new Error(`Repo doc agent is unavailable: ${agentError}`);
  }

  return {
    ...source,
    ...response,
  };
}

async function triggerDefaultBranchRepoDocRefresh({
  repo,
  branchName,
  sourceCommit,
  trigger = 'default_branch_updated',
  requestedByUserId = null,
  requestedByUsername = null,
}) {
  const normalizedBranch = String(branchName || '').trim();
  if (!normalizedBranch || normalizedBranch !== repo.default_branch) {
    return null;
  }

  return triggerRepoDocRefresh({
    repo,
    sourceBranch: repo.default_branch,
    sourceCommit,
    trigger,
    requestedByUserId,
    requestedByUsername,
    force: false,
  });
}

async function tryTriggerDefaultBranchRepoDocRefresh(options) {
  try {
    return await triggerDefaultBranchRepoDocRefresh(options);
  } catch (error) {
    logger.warn('Repo doc refresh trigger failed', {
      repo_id: options.repo?.id || null,
      branch: options.branchName || null,
      trigger: options.trigger || 'default_branch_updated',
      error: error.message || 'Unknown error',
    });
    return null;
  }
}

module.exports = {
  resolveRepoDocSource,
  triggerRepoDocRefresh,
  triggerDefaultBranchRepoDocRefresh,
  tryTriggerDefaultBranchRepoDocRefresh,
};
