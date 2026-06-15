const fs = require('fs');
const path = require('path');
const { hydrateRepoFromR2, isR2Enabled } = require('./r2Storage');

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function getGitStorageRoot() {
  const configuredRoot = typeof process.env.GIT_STORAGE_ROOT === 'string'
    ? process.env.GIT_STORAGE_ROOT.trim()
    : '';
  const defaultRoot = path.resolve(process.cwd(), 'git-storage');

  if (!configuredRoot) {
    return defaultRoot;
  }

  // A Windows-only path in `.env` breaks repo creation when the backend runs on Linux/macOS.
  if (process.platform !== 'win32' && isWindowsAbsolutePath(configuredRoot)) {
    return defaultRoot;
  }

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(process.cwd(), configuredRoot);
}

function getRepoPath(repoId) {
  return path.join(getGitStorageRoot(), 'repos', `${repoId}.git`);
}

function getLegacyRepoPath(spaceId, repoId) {
  return path.join(getGitStorageRoot(), 'spaces', spaceId, `${repoId}.git`);
}

async function resolveRepoPath(repoId, spaceId = null) {
  const modernPath = getRepoPath(repoId);
  try {
    await fs.promises.access(modernPath);
    return modernPath;
  } catch (error) {
    if (isR2Enabled() && await hydrateRepoFromR2(modernPath)) {
      return modernPath;
    }

    if (spaceId) {
      const legacyPath = getLegacyRepoPath(spaceId, repoId);
      if (isR2Enabled()) {
        await hydrateRepoFromR2(legacyPath);
      }
      return legacyPath;
    }
    return modernPath;
  }
}

async function ensureRepoParentDirectory() {
  const repoDir = path.join(getGitStorageRoot(), 'repos');
  await fs.promises.mkdir(repoDir, { recursive: true });
  return repoDir;
}

module.exports = {
  getGitStorageRoot,
  getRepoPath,
  getLegacyRepoPath,
  resolveRepoPath,
  ensureRepoParentDirectory,
};
