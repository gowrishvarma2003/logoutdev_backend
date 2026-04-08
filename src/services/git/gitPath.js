const fs = require('fs');
const path = require('path');
const { restoreRepoFromSupabase } = require('./gitSupabaseStorage');
const { touchRepoAccess } = require('./gitCacheState');

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function getGitStorageRoot() {
  const configuredRoot = typeof process.env.GIT_STORAGE_CACHE_ROOT === 'string'
    ? process.env.GIT_STORAGE_CACHE_ROOT.trim()
    : (typeof process.env.GIT_STORAGE_ROOT === 'string' ? process.env.GIT_STORAGE_ROOT.trim() : '');
  const defaultRoot = path.resolve(process.cwd(), 'git-storage');

  if (!configuredRoot) {
    return defaultRoot;
  }

  // Supabase-backed storage still needs a local cache path for git CLI operations.
  if (/^supabase:\/\//i.test(configuredRoot)) {
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
    await touchRepoAccess(modernPath);
    return modernPath;
  } catch (error) {
    const restored = await restoreRepoFromSupabase(modernPath, { repoId, spaceId });
    if (restored.restored) {
      await touchRepoAccess(modernPath);
      return modernPath;
    }

    if (spaceId) {
      const legacyPath = getLegacyRepoPath(spaceId, repoId);
      try {
        await fs.promises.access(legacyPath);
        await touchRepoAccess(legacyPath);
        return legacyPath;
      } catch (legacyError) {
        const restoredLegacy = await restoreRepoFromSupabase(legacyPath, { repoId, spaceId });
        if (restoredLegacy.restored) {
          await touchRepoAccess(legacyPath);
          return legacyPath;
        }
      }
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
