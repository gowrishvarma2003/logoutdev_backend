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

const createSpaceRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  keyPrefix: 'spaces:create-space',
  message: 'Too many project space create attempts. Please try again shortly.',
});

const joinRequestRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyPrefix: 'spaces:join-request',
  message: 'Too many join request attempts. Please try again shortly.',
});

const discussionRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'spaces:discussion-write',
  message: 'Too many discussion actions. Please try again shortly.',
});

const updateRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  keyPrefix: 'spaces:update-write',
  message: 'Too many update actions. Please try again shortly.',
});

const issueWriteRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'spaces:issue-write',
  message: 'Too many issue actions. Please try again shortly.',
});

module.exports = {
  createSpaceRateLimiter,
  joinRequestRateLimiter,
  discussionRateLimiter,
  updateRateLimiter,
  issueWriteRateLimiter,
};
