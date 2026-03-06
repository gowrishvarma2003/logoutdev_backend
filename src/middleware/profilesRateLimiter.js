function createRateLimiter({ windowMs, max, keyPrefix, message }) {
  const hits = new Map();

  return function rateLimiter(req, res, next) {
    const userId = req.user?.userId || req.ip || 'unknown';
    const key = `${keyPrefix}:${userId}`;
    const now = Date.now();

    const current = hits.get(key);
    if (!current || now > current.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      return res.status(429).json({
        error: message,
      });
    }

    current.count += 1;
    hits.set(key, current);
    return next();
  };
}

const profileUpdateRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 12,
  keyPrefix: 'profiles:update',
  message: 'Too many profile update attempts. Please try again shortly.',
});

const profileSkillsRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'profiles:skills-update',
  message: 'Too many profile skills update attempts. Please try again shortly.',
});

const profileFeaturedProjectsRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'profiles:featured-projects-update',
  message: 'Too many featured projects update attempts. Please try again shortly.',
});

module.exports = {
  profileUpdateRateLimiter,
  profileSkillsRateLimiter,
  profileFeaturedProjectsRateLimiter,
};
