const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULT_POLICY, buildPolicy } = require('../src/services/git/gitCachePolicy');
const { runGitCacheCleanupSweep } = require('../src/services/git/gitCacheCleanupService');
const {
  acquireRepoLease,
  releaseRepoLease,
  markRepoDirty,
} = require('../src/services/git/gitCacheState');

async function createBareRepoLikeDir(repoPath, ageMs, byteSize = 2048) {
  await fs.promises.mkdir(repoPath, { recursive: true });
  await fs.promises.mkdir(path.join(repoPath, 'objects'), { recursive: true });
  await fs.promises.writeFile(path.join(repoPath, 'objects', 'payload.bin'), Buffer.alloc(byteSize, 1));
  const touchDate = new Date(Date.now() - ageMs);
  await fs.promises.utimes(repoPath, touchDate, touchDate);
}

test('buildPolicy falls back to defaults for invalid values', () => {
  const policy = buildPolicy({
    GIT_CACHE_CLEANUP_ENABLED: 'invalid',
    GIT_CACHE_CLEANUP_DRY_RUN: 'invalid',
    GIT_CACHE_CLEANUP_INTERVAL_MS: 'abc',
    GIT_CACHE_CLEANUP_HIGH_WATERMARK_PERCENT: '101',
    GIT_CACHE_CLEANUP_LOW_WATERMARK_PERCENT: 'xyz',
    GIT_CACHE_CLEANUP_MIN_FREE_BYTES: '-1',
    GIT_CACHE_CLEANUP_PROTECT_RECENT_MS: '-50',
    GIT_CACHE_CLEANUP_TTL_MS: 'nope',
    GIT_CACHE_RECOVER_DIRTY_ON_STARTUP: 'unknown',
    GIT_CACHE_CLEANUP_MAX_EVICTIONS_PER_SWEEP: '0',
  });

  assert.equal(policy.enabled, DEFAULT_POLICY.enabled);
  assert.equal(policy.dryRun, DEFAULT_POLICY.dryRun);
  assert.equal(policy.intervalMs, DEFAULT_POLICY.intervalMs);
  assert.equal(policy.highWatermarkPercent, DEFAULT_POLICY.highWatermarkPercent);
  assert.equal(policy.lowWatermarkPercent, DEFAULT_POLICY.lowWatermarkPercent);
  assert.equal(policy.minFreeBytes, DEFAULT_POLICY.minFreeBytes);
  assert.equal(policy.protectRecentMs, DEFAULT_POLICY.protectRecentMs);
  assert.equal(policy.ttlMs, DEFAULT_POLICY.ttlMs);
  assert.equal(policy.recoverDirtyOnStartup, DEFAULT_POLICY.recoverDirtyOnStartup);
  assert.equal(policy.maxEvictionsPerSweep, DEFAULT_POLICY.maxEvictionsPerSweep);
});

test('cleanup sweep evicts eligible repos and skips dirty and leased repos', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-git-cache-cleanup-'));
  const repoA = path.join(tmpRoot, 'repos', 'repo-a.git');
  const repoB = path.join(tmpRoot, 'repos', 'repo-b.git');
  const repoC = path.join(tmpRoot, 'repos', 'repo-c.git');

  try {
    await createBareRepoLikeDir(repoA, 2 * 24 * 60 * 60 * 1000, 4096);
    await createBareRepoLikeDir(repoB, 2 * 24 * 60 * 60 * 1000, 4096);
    await createBareRepoLikeDir(repoC, 2 * 24 * 60 * 60 * 1000, 4096);

    await markRepoDirty(repoB);
    acquireRepoLease(repoC);

    const policy = {
      ...DEFAULT_POLICY,
      enabled: true,
      dryRun: false,
      ttlMs: 1,
      protectRecentMs: 0,
      minFreeBytes: 0,
      maxEvictionsPerSweep: 10,
    };

    const summary = await runGitCacheCleanupSweep({
      cacheRoot: tmpRoot,
      policy,
      dryRun: false,
      skipProviderCheck: true,
      diskStats: {
        totalBytes: 1024 * 1024,
        usedBytes: 256 * 1024,
        availableBytes: 768 * 1024,
        usedPercent: 25,
      },
    });

    await assert.doesNotReject(() => fs.promises.access(repoB));
    await assert.doesNotReject(() => fs.promises.access(repoC));
    await assert.rejects(() => fs.promises.access(repoA));

    assert.equal(summary.executed, true);
    assert.equal(summary.reason, 'ttl-sweep');
    assert.equal(summary.evictedCount, 1);
    assert.equal(summary.skipped.dirty, 1);
    assert.equal(summary.skipped.leased, 1);
  } finally {
    releaseRepoLease(repoC);
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('cleanup sweep dry-run does not delete repos', async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logoutdev-git-cache-dryrun-'));
  const repoA = path.join(tmpRoot, 'repos', 'repo-a.git');

  try {
    await createBareRepoLikeDir(repoA, 2 * 24 * 60 * 60 * 1000, 2048);

    const policy = {
      ...DEFAULT_POLICY,
      enabled: true,
      dryRun: true,
      ttlMs: 1,
      protectRecentMs: 0,
      minFreeBytes: 0,
      maxEvictionsPerSweep: 10,
    };

    const summary = await runGitCacheCleanupSweep({
      cacheRoot: tmpRoot,
      policy,
      dryRun: true,
      skipProviderCheck: true,
      diskStats: {
        totalBytes: 1024 * 1024,
        usedBytes: 256 * 1024,
        availableBytes: 768 * 1024,
        usedPercent: 25,
      },
    });

    await assert.doesNotReject(() => fs.promises.access(repoA));
    assert.equal(summary.dryRun, true);
    assert.equal(summary.dryRunCount, 1);
    assert.equal(summary.evictedCount, 0);
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  }
});
