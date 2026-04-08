const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { logger } = require('../../logging/logger');
const { getGitStorageRoot } = require('./gitPath');
const { getGitCachePolicy } = require('./gitCachePolicy');
const { isGitSupabaseStorageEnabled, syncRepoToSupabase } = require('./gitSupabaseStorage');
const {
  pathExists,
  listCachedRepoPaths,
  listDirtyRepoPaths,
  isRepoLeased,
  isRepoDirty,
  getRepoLeaseCount,
  getRepoLastAccessMs,
  getDirectorySizeBytes,
  clearRepoDirty,
} = require('./gitCacheState');

const execFileAsync = promisify(execFile);

let cleanupIntervalHandle = null;

async function getDiskStats(cacheRoot) {
  const { stdout } = await execFileAsync('df', ['-Pk', cacheRoot]);
  const lines = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('Unable to parse disk statistics from df output.');
  }

  const dataColumns = lines[lines.length - 1].split(/\s+/);
  if (dataColumns.length < 6) {
    throw new Error('Unexpected df output shape.');
  }

  const totalKb = Number(dataColumns[1]);
  const usedKb = Number(dataColumns[2]);
  const availableKb = Number(dataColumns[3]);
  const usedPercent = Number(String(dataColumns[4]).replace('%', ''));

  if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb) || !Number.isFinite(availableKb)) {
    throw new Error('Disk statistics contain non-numeric values.');
  }

  return {
    totalBytes: Math.max(totalKb, 0) * 1024,
    usedBytes: Math.max(usedKb, 0) * 1024,
    availableBytes: Math.max(availableKb, 0) * 1024,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : 0,
  };
}

function isUnderPressure(diskStats, policy) {
  return diskStats.usedPercent >= policy.highWatermarkPercent
    || diskStats.availableBytes < policy.minFreeBytes;
}

function hasPressureRelieved(diskStats, policy, estimatedFreedBytes) {
  const freedBytes = Math.max(Number(estimatedFreedBytes) || 0, 0);
  const availableBytes = diskStats.availableBytes + freedBytes;
  const usedBytes = Math.max(diskStats.usedBytes - freedBytes, 0);
  const usedPercent = diskStats.totalBytes > 0 ? (usedBytes / diskStats.totalBytes) * 100 : 0;

  return usedPercent <= policy.lowWatermarkPercent
    && availableBytes >= policy.minFreeBytes;
}

async function buildCandidateList(cacheRoot, policy, pressureMode, nowMs) {
  const candidates = [];
  const skipped = {
    leased: 0,
    dirty: 0,
    recent: 0,
    ttl: 0,
  };

  const repoPaths = await listCachedRepoPaths(cacheRoot);
  for (const repoPath of repoPaths) {
    if (isRepoLeased(repoPath)) {
      skipped.leased += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await isRepoDirty(repoPath)) {
      skipped.dirty += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const lastAccessMs = await getRepoLastAccessMs(repoPath);
    const ageMs = Math.max(nowMs - lastAccessMs, 0);

    if (policy.protectRecentMs > 0 && ageMs < policy.protectRecentMs) {
      skipped.recent += 1;
      continue;
    }

    if (!pressureMode && policy.ttlMs > 0 && ageMs < policy.ttlMs) {
      skipped.ttl += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const sizeBytes = await getDirectorySizeBytes(repoPath);
    candidates.push({
      repoPath,
      ageMs,
      sizeBytes,
      lastAccessMs,
    });
  }

  candidates.sort((a, b) => {
    if (a.lastAccessMs === b.lastAccessMs) {
      return a.repoPath.localeCompare(b.repoPath);
    }
    return a.lastAccessMs - b.lastAccessMs;
  });

  return { candidates, skipped, scannedRepoCount: repoPaths.length };
}

async function evictRepoPath(repoPath, dryRun) {
  if (isRepoLeased(repoPath)) {
    return { evicted: false, reason: 'leased' };
  }

  if (await isRepoDirty(repoPath)) {
    return { evicted: false, reason: 'dirty' };
  }

  if (dryRun) {
    return { evicted: false, reason: 'dry-run' };
  }

  await fs.promises.rm(repoPath, { recursive: true, force: true });
  return { evicted: true, reason: 'evicted' };
}

async function runGitCacheCleanupSweep(options = {}) {
  const policy = options.policy || getGitCachePolicy();
  const dryRun = typeof options.dryRun === 'boolean' ? options.dryRun : policy.dryRun;

  if (!policy.enabled) {
    return {
      executed: false,
      reason: 'disabled',
    };
  }

  if (!options.skipProviderCheck && !isGitSupabaseStorageEnabled()) {
    return {
      executed: false,
      reason: 'provider-not-supabase',
    };
  }

  const cacheRoot = options.cacheRoot || getGitStorageRoot();
  if (!(await pathExists(cacheRoot))) {
    return {
      executed: false,
      reason: 'cache-root-missing',
      cacheRoot,
    };
  }

  const diskStats = options.diskStats || await getDiskStats(cacheRoot);
  const pressureMode = Boolean(options.forcePressure) || isUnderPressure(diskStats, policy);

  if (!pressureMode && policy.ttlMs <= 0) {
    return {
      executed: true,
      reason: 'no-pressure-and-ttl-disabled',
      cacheRoot,
      dryRun,
    };
  }

  const nowMs = Date.now();
  const { candidates, skipped, scannedRepoCount } = await buildCandidateList(cacheRoot, policy, pressureMode, nowMs);

  let freedBytes = 0;
  let evictedCount = 0;
  let dryRunCount = 0;
  let skippedByRace = 0;
  const maxEvictions = Math.max(policy.maxEvictionsPerSweep, 1);

  for (const candidate of candidates) {
    if (evictedCount + dryRunCount >= maxEvictions) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const evictionResult = await evictRepoPath(candidate.repoPath, dryRun);

    if (evictionResult.reason === 'leased' || evictionResult.reason === 'dirty') {
      skippedByRace += 1;
      continue;
    }

    freedBytes += candidate.sizeBytes;
    if (evictionResult.reason === 'dry-run') {
      dryRunCount += 1;
    }

    if (evictionResult.reason === 'evicted') {
      evictedCount += 1;
    }

    if (pressureMode && hasPressureRelieved(diskStats, policy, freedBytes)) {
      break;
    }
  }

  const summary = {
    executed: true,
    reason: pressureMode ? 'pressure-sweep' : 'ttl-sweep',
    dryRun,
    cacheRoot,
    scannedRepoCount,
    candidateCount: candidates.length,
    evictedCount,
    dryRunCount,
    skippedByRace,
    skipped,
    freedBytes,
    disk: {
      usedPercent: diskStats.usedPercent,
      availableBytes: diskStats.availableBytes,
      totalBytes: diskStats.totalBytes,
    },
  };

  logger.info('Git cache cleanup sweep completed.', summary);
  return summary;
}

async function recoverDirtyRepos(options = {}) {
  const policy = options.policy || getGitCachePolicy();
  if (!policy.enabled) {
    return {
      recovered: 0,
      skipped: 0,
      failed: 0,
      scanned: 0,
      reason: 'disabled',
    };
  }

  if (!options.skipProviderCheck && !isGitSupabaseStorageEnabled()) {
    return {
      recovered: 0,
      skipped: 0,
      failed: 0,
      scanned: 0,
      reason: 'provider-not-supabase',
    };
  }

  const cacheRoot = options.cacheRoot || getGitStorageRoot();
  if (!(await pathExists(cacheRoot))) {
    return {
      recovered: 0,
      skipped: 0,
      failed: 0,
      scanned: 0,
      reason: 'cache-root-missing',
    };
  }

  const syncRepo = typeof options.syncRepo === 'function' ? options.syncRepo : syncRepoToSupabase;
  const dirtyRepoPaths = await listDirtyRepoPaths(cacheRoot);

  let recovered = 0;
  let skipped = 0;
  let failed = 0;

  for (const repoPath of dirtyRepoPaths) {
    if (isRepoLeased(repoPath)) {
      skipped += 1;
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await syncRepo(repoPath);
      // eslint-disable-next-line no-await-in-loop
      await clearRepoDirty(repoPath);
      recovered += 1;
    } catch (error) {
      failed += 1;
      logger.warn('Git cache dirty recovery failed.', {
        repoPath,
        leaseCount: getRepoLeaseCount(repoPath),
        error: error.message,
      });
    }
  }

  const summary = {
    recovered,
    skipped,
    failed,
    scanned: dirtyRepoPaths.length,
    reason: 'completed',
  };
  logger.info('Git cache dirty recovery finished.', summary);
  return summary;
}

function stopGitCacheCleanupService() {
  if (!cleanupIntervalHandle) {
    return;
  }

  clearInterval(cleanupIntervalHandle);
  cleanupIntervalHandle = null;
  logger.info('Git cache cleanup service stopped.');
}

async function initializeGitCacheCleanupService() {
  const policy = getGitCachePolicy();

  if (!policy.enabled) {
    logger.info('Git cache cleanup service is disabled by configuration.');
    return stopGitCacheCleanupService;
  }

  if (!isGitSupabaseStorageEnabled()) {
    logger.info('Git cache cleanup service skipped because git storage provider is not supabase.');
    return stopGitCacheCleanupService;
  }

  if (policy.recoverDirtyOnStartup) {
    await recoverDirtyRepos({ policy });
  }

  await runGitCacheCleanupSweep({ policy, reason: 'startup' });

  if (cleanupIntervalHandle) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
  }

  cleanupIntervalHandle = setInterval(() => {
    void runGitCacheCleanupSweep({ reason: 'interval' }).catch((error) => {
      logger.warn('Git cache cleanup sweep failed.', { error: error.message });
    });
  }, policy.intervalMs);

  if (typeof cleanupIntervalHandle.unref === 'function') {
    cleanupIntervalHandle.unref();
  }

  logger.info('Git cache cleanup service started.', {
    dryRun: policy.dryRun,
    intervalMs: policy.intervalMs,
    highWatermarkPercent: policy.highWatermarkPercent,
    lowWatermarkPercent: policy.lowWatermarkPercent,
    minFreeBytes: policy.minFreeBytes,
    ttlMs: policy.ttlMs,
    protectRecentMs: policy.protectRecentMs,
    maxEvictionsPerSweep: policy.maxEvictionsPerSweep,
  });

  return stopGitCacheCleanupService;
}

module.exports = {
  getDiskStats,
  runGitCacheCleanupSweep,
  recoverDirtyRepos,
  initializeGitCacheCleanupService,
  stopGitCacheCleanupService,
};
