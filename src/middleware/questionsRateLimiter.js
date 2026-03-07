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
      return res.status(429).json({ error: message });
    }

    current.count += 1;
    hits.set(key, current);
    return next();
  };
}

const createQuestionRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 8,
  keyPrefix: 'questions:create',
  message: 'Too many question create attempts. Please try again shortly.',
});

const answerRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'questions:answer',
  message: 'Too many answer attempts. Please try again shortly.',
});

const discussionRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 25,
  keyPrefix: 'questions:discussion',
  message: 'Too many discussion actions. Please try again shortly.',
});

module.exports = {
  createQuestionRateLimiter,
  answerRateLimiter,
  discussionRateLimiter,
};
