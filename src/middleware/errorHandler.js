const { logger, serializeError, sanitizeForLogging } = require('../logging/logger');

function notFoundHandler(req, res) {
  return res.status(404).json({ error: 'Route not found.' });
}

function buildUserSnapshot(req) {
  if (!req.user) {
    return null;
  }

  return sanitizeForLogging({
    userId: req.user.userId || req.user.id || null,
    username: req.user.username || null,
  });
}

function errorHandler(error, req, res, next) {
  logger.error('Unhandled request error', {
    error: serializeError(error),
    request: {
      method: req.method,
      url: req.originalUrl || req.url,
      params: sanitizeForLogging(req.params),
      query: sanitizeForLogging(req.query),
      body: sanitizeForLogging(req.body),
    },
    user: buildUserSnapshot(req),
  });

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : Number.isInteger(error?.status)
      ? error.status
      : 500;

  return res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error.' : error.message,
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};