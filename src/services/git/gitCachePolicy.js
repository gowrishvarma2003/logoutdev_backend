const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  dryRun: true,
  intervalMs: 5 * 60 * 1000,
  highWatermarkPercent: 85,
  lowWatermarkPercent: 70,
  minFreeBytes: 5 * 1024 * 1024 * 1024,
  protectRecentMs: 30 * 60 * 1000,
  ttlMs: 24 * 60 * 60 * 1000,
  recoverDirtyOnStartup: true,
  maxEvictionsPerSweep: 200,
});

function asTrimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(rawValue, fallback) {
  const normalized = asTrimmed(rawValue).toLowerCase();
  if (!normalized) return fallback;

  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseInteger(rawValue, fallback, minimum = null) {
  const parsed = Number.parseInt(asTrimmed(rawValue), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (minimum !== null && parsed < minimum) {
    return fallback;
  }

  return parsed;
}

function parseNumber(rawValue, fallback, minimum = null, maximum = null) {
  const parsed = Number(asTrimmed(rawValue));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (minimum !== null && parsed < minimum) {
    return fallback;
  }

  if (maximum !== null && parsed > maximum) {
    return fallback;
  }

  return parsed;
}

function buildPolicy(raw = process.env) {
  const policy = {
    enabled: parseBoolean(raw.GIT_CACHE_CLEANUP_ENABLED, DEFAULT_POLICY.enabled),
    dryRun: parseBoolean(raw.GIT_CACHE_CLEANUP_DRY_RUN, DEFAULT_POLICY.dryRun),
    intervalMs: parseInteger(raw.GIT_CACHE_CLEANUP_INTERVAL_MS, DEFAULT_POLICY.intervalMs, 10 * 1000),
    highWatermarkPercent: parseNumber(raw.GIT_CACHE_CLEANUP_HIGH_WATERMARK_PERCENT, DEFAULT_POLICY.highWatermarkPercent, 1, 99),
    lowWatermarkPercent: parseNumber(raw.GIT_CACHE_CLEANUP_LOW_WATERMARK_PERCENT, DEFAULT_POLICY.lowWatermarkPercent, 1, 98),
    minFreeBytes: parseInteger(raw.GIT_CACHE_CLEANUP_MIN_FREE_BYTES, DEFAULT_POLICY.minFreeBytes, 0),
    protectRecentMs: parseInteger(raw.GIT_CACHE_CLEANUP_PROTECT_RECENT_MS, DEFAULT_POLICY.protectRecentMs, 0),
    ttlMs: parseInteger(raw.GIT_CACHE_CLEANUP_TTL_MS, DEFAULT_POLICY.ttlMs, 0),
    recoverDirtyOnStartup: parseBoolean(raw.GIT_CACHE_RECOVER_DIRTY_ON_STARTUP, DEFAULT_POLICY.recoverDirtyOnStartup),
    maxEvictionsPerSweep: parseInteger(raw.GIT_CACHE_CLEANUP_MAX_EVICTIONS_PER_SWEEP, DEFAULT_POLICY.maxEvictionsPerSweep, 1),
  };

  if (policy.lowWatermarkPercent >= policy.highWatermarkPercent) {
    policy.lowWatermarkPercent = Math.max(policy.highWatermarkPercent - 5, 1);
  }

  return policy;
}

function getGitCachePolicy() {
  return buildPolicy(process.env);
}

module.exports = {
  DEFAULT_POLICY,
  getGitCachePolicy,
  buildPolicy,
};
