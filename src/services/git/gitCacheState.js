const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const repoLeaseCounts = new Map();
const DIRTY_MARKER_FILE_NAME = '.logoutdev-cache-dirty';

function normalizeRepoPath(repoPath) {
  if (!repoPath) {
    return '';
  }
  return path.resolve(String(repoPath));
}

function getDirtyMarkerPath(repoPath) {
  return path.join(normalizeRepoPath(repoPath), DIRTY_MARKER_FILE_NAME);
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

function acquireRepoLease(repoPath) {
  const normalizedPath = normalizeRepoPath(repoPath);
  if (!normalizedPath) {
    return 0;
  }

  const next = (repoLeaseCounts.get(normalizedPath) || 0) + 1;
  repoLeaseCounts.set(normalizedPath, next);
  return next;
}

function releaseRepoLease(repoPath) {
  const normalizedPath = normalizeRepoPath(repoPath);
  if (!normalizedPath) {
    return 0;
  }

  const current = repoLeaseCounts.get(normalizedPath) || 0;
  if (current <= 1) {
    repoLeaseCounts.delete(normalizedPath);
    return 0;
  }

  const next = current - 1;
  repoLeaseCounts.set(normalizedPath, next);
  return next;
}

function getRepoLeaseCount(repoPath) {
  return repoLeaseCounts.get(normalizeRepoPath(repoPath)) || 0;
}

function isRepoLeased(repoPath) {
  return getRepoLeaseCount(repoPath) > 0;
}

async function withRepoLease(repoPath, operation) {
  if (typeof operation !== 'function') {
    throw new Error('withRepoLease requires an operation function.');
  }

  const normalizedPath = normalizeRepoPath(repoPath);
  if (!normalizedPath) {
    return operation();
  }

  acquireRepoLease(normalizedPath);
  try {
    return await operation();
  } finally {
    releaseRepoLease(normalizedPath);
  }
}

async function touchRepoAccess(repoPath) {
  const normalizedPath = normalizeRepoPath(repoPath);
  if (!normalizedPath) {
    return;
  }

  const now = new Date();
  try {
    await fs.promises.utimes(normalizedPath, now, now);
  } catch (error) {
    // Access touch must never block repository operations.
  }
}

async function markRepoDirty(repoPath) {
  const markerPath = getDirtyMarkerPath(repoPath);
  const payload = {
    dirty: true,
    updated_at: new Date().toISOString(),
  };

  try {
    await fs.promises.writeFile(markerPath, JSON.stringify(payload), 'utf8');
  } catch (error) {
    // Keep non-fatal for safety; lack of marker should not block writes.
  }
}

async function clearRepoDirty(repoPath) {
  const markerPath = getDirtyMarkerPath(repoPath);
  try {
    await fs.promises.unlink(markerPath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function isRepoDirty(repoPath) {
  return pathExists(getDirtyMarkerPath(repoPath));
}

async function collectGitRepoPaths(rootPath, maxDepth = 8) {
  const normalizedRoot = path.resolve(rootPath);
  if (!(await pathExists(normalizedRoot))) {
    return [];
  }

  const results = [];

  async function walk(currentPath, depth) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);
      if (entry.name.endsWith('.git')) {
        results.push(path.resolve(fullPath));
        continue;
      }

      if (depth < maxDepth) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(normalizedRoot, 0);
  return Array.from(new Set(results));
}

async function listCachedRepoPaths(cacheRoot) {
  return collectGitRepoPaths(cacheRoot, 8);
}

async function listDirtyRepoPaths(cacheRoot) {
  const repoPaths = await listCachedRepoPaths(cacheRoot);
  const dirtyRepoPaths = [];

  for (const repoPath of repoPaths) {
    // eslint-disable-next-line no-await-in-loop
    if (await isRepoDirty(repoPath)) {
      dirtyRepoPaths.push(repoPath);
    }
  }

  return dirtyRepoPaths;
}

async function getRepoLastAccessMs(repoPath) {
  try {
    const stat = await fs.promises.stat(repoPath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

async function getDirectorySizeBytesFallback(targetPath) {
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      total += await getDirectorySizeBytesFallback(fullPath);
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.promises.stat(fullPath);
      total += Number.isFinite(stat.size) ? stat.size : 0;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return total;
}

async function getDirectorySizeBytes(targetPath) {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', targetPath]);
    const firstToken = String(stdout).trim().split(/\s+/)[0];
    const parsed = Number(firstToken);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return 0;
    }
    // Fall through to JS fallback for environments without du.
  }

  return getDirectorySizeBytesFallback(targetPath);
}

module.exports = {
  DIRTY_MARKER_FILE_NAME,
  normalizeRepoPath,
  pathExists,
  acquireRepoLease,
  releaseRepoLease,
  getRepoLeaseCount,
  isRepoLeased,
  withRepoLease,
  touchRepoAccess,
  markRepoDirty,
  clearRepoDirty,
  isRepoDirty,
  collectGitRepoPaths,
  listCachedRepoPaths,
  listDirtyRepoPaths,
  getRepoLastAccessMs,
  getDirectorySizeBytes,
};
