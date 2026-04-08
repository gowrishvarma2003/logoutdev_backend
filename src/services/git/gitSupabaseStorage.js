const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  getStorageProvider,
  uploadFile,
  downloadFile,
} = require('../storage/objectStorage');

const execFileAsync = promisify(execFile);

function asTrimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getGitStorageProvider() {
  const configured = asTrimmed(process.env.GIT_STORAGE_PROVIDER);
  if (configured) {
    return configured.toLowerCase();
  }
  return getStorageProvider();
}

function isGitSupabaseStorageEnabled() {
  return getGitStorageProvider() === 'supabase';
}

function getGitStoragePrefix() {
  const prefix = asTrimmed(process.env.GIT_STORAGE_PREFIX || 'git');
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '') || 'git';
}

function extractRepoId(repoPath) {
  const repoBase = path.basename(String(repoPath || ''));
  if (!repoBase.endsWith('.git')) {
    throw new Error('Expected bare repository path ending with .git.');
  }
  return repoBase.slice(0, -4);
}

function buildRepoObjectKey(repoId) {
  return `${getGitStoragePrefix()}/repos/${repoId}.git.tar.gz`;
}

function buildLegacyRepoObjectKey(spaceId, repoId) {
  return `${getGitStoragePrefix()}/spaces/${spaceId}/${repoId}.git.tar.gz`;
}

function buildPathBasedObjectKey(repoPath) {
  const normalizedPath = String(repoPath || '').replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  const repoBase = segments[segments.length - 1] || '';

  if (!repoBase.endsWith('.git')) {
    return null;
  }

  const repoId = repoBase.slice(0, -4);
  const spacesIndex = segments.lastIndexOf('spaces');
  if (spacesIndex !== -1 && segments.length > spacesIndex + 2) {
    const spaceId = segments[spacesIndex + 1];
    return buildLegacyRepoObjectKey(spaceId, repoId);
  }

  return buildRepoObjectKey(repoId);
}

function buildRepoObjectKeyCandidates(repoId, spaceId = null, repoPath = null) {
  const candidates = [buildRepoObjectKey(repoId)];
  if (spaceId) {
    candidates.push(buildLegacyRepoObjectKey(spaceId, repoId));
  }

  if (repoPath) {
    const pathBased = buildPathBasedObjectKey(repoPath);
    if (pathBased) {
      candidates.push(pathBased);
    }
  }

  return Array.from(new Set(candidates));
}

function createTempArchivePath(repoId) {
  const randomPart = Math.random().toString(36).slice(2);
  return path.join(os.tmpdir(), `logoutdev-${repoId}-${Date.now()}-${randomPart}.tar.gz`);
}

async function archiveRepository(repoPath, archivePath) {
  const parentDir = path.dirname(repoPath);
  const repoDirName = path.basename(repoPath);
  await execFileAsync('tar', ['-czf', archivePath, '-C', parentDir, repoDirName]);
}

async function extractRepositoryArchive(archivePath, destinationParentDir) {
  await execFileAsync('tar', ['-xzf', archivePath, '-C', destinationParentDir]);
}

async function syncRepoToSupabase(repoPath, options = {}) {
  if (!isGitSupabaseStorageEnabled()) {
    return { synced: false, reason: 'disabled' };
  }

  const repoId = options.repoId || extractRepoId(repoPath);
  const objectKey = options.objectKey || buildRepoObjectKey(repoId);
  await fs.promises.access(repoPath);

  const archivePath = createTempArchivePath(repoId);
  try {
    await archiveRepository(repoPath, archivePath);
    await uploadFile(archivePath, objectKey, {
      contentType: 'application/gzip',
      cacheControl: '3600',
    });
    return {
      synced: true,
      objectKey,
    };
  } finally {
    try {
      await fs.promises.unlink(archivePath);
    } catch (_) {
      // Ignore temporary file cleanup errors.
    }
  }
}

async function restoreRepoFromSupabase(repoPath, options = {}) {
  if (!isGitSupabaseStorageEnabled()) {
    return { restored: false, reason: 'disabled' };
  }

  const repoId = options.repoId || extractRepoId(repoPath);
  const objectKeys = buildRepoObjectKeyCandidates(repoId, options.spaceId, repoPath);
  const destinationParentDir = path.dirname(repoPath);

  await fs.promises.mkdir(destinationParentDir, { recursive: true });

  for (const objectKey of objectKeys) {
    const archivePath = createTempArchivePath(repoId);
    try {
      // eslint-disable-next-line no-await-in-loop
      const downloaded = await downloadFile(objectKey, archivePath);
      if (!downloaded) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await extractRepositoryArchive(archivePath, destinationParentDir);
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.access(repoPath);

      return {
        restored: true,
        objectKey,
      };
    } finally {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.promises.unlink(archivePath);
      } catch (_) {
        // Ignore temporary file cleanup errors.
      }
    }
  }

  return { restored: false };
}

module.exports = {
  isGitSupabaseStorageEnabled,
  buildRepoObjectKey,
  buildLegacyRepoObjectKey,
  syncRepoToSupabase,
  restoreRepoFromSupabase,
};
