const fs = require('fs');
const path = require('path');

function getGitStorageRoot() {
  return process.env.GIT_STORAGE_ROOT || path.resolve(process.cwd(), 'git-storage');
}

function getRepoPath(spaceId, repoId) {
  return path.join(getGitStorageRoot(), 'spaces', spaceId, `${repoId}.git`);
}

async function ensureRepoParentDirectory(spaceId) {
  const repoDir = path.join(getGitStorageRoot(), 'spaces', spaceId);
  await fs.promises.mkdir(repoDir, { recursive: true });
  return repoDir;
}

module.exports = {
  getGitStorageRoot,
  getRepoPath,
  ensureRepoParentDirectory,
};
