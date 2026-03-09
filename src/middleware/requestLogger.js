const crypto = require('crypto');
const { logger, sanitizeForLogging } = require('../logging/logger');
const { runWithRequestContext } = require('../logging/requestContext');

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
}

function buildRequestSnapshot(req) {
  return sanitizeForLogging({
    method: req.method,
    url: req.originalUrl || req.url,
    params: req.params,
    query: req.query,
    body: req.body,
    headers: {
      authorization: req.headers.authorization,
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      cookie: req.headers.cookie,
    },
    ip: getClientIp(req),
  });
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

function captureResponsePreview(res) {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);

  function storeBodyPreview(body) {
    res.locals.responseBodyPreview = sanitizeForLogging(body);
  }

  res.json = function jsonWithPreview(body) {
    storeBodyPreview(body);
    return originalJson(body);
  };

  res.send = function sendWithPreview(body) {
    storeBodyPreview(body);
    return originalSend(body);
  };

  res.end = function endWithPreview(chunk, encoding, callback) {
    if (chunk !== undefined && res.locals.responseBodyPreview === undefined) {
      storeBodyPreview(chunk);
    }

    return originalEnd(chunk, encoding, callback);
  };
}

function requestLogger(req, res, next) {
  const requestId = typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim()
    ? req.headers['x-request-id'].trim()
    : crypto.randomUUID();
  const startedAt = process.hrtime.bigint();

  res.setHeader('X-Request-Id', requestId);
  captureResponsePreview(res);

  return runWithRequestContext(
    {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
    },
    () => {
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const response = {
          statusCode: res.statusCode,
          contentLength: res.getHeader('content-length') || null,
        };

        if (res.statusCode >= 400 && res.locals.responseBodyPreview !== undefined) {
          response.body = res.locals.responseBodyPreview;
        }

        const logPayload = {
          durationMs: Number(durationMs.toFixed(2)),
          request: buildRequestSnapshot(req),
          response,
          user: buildUserSnapshot(req),
        };

        if (res.statusCode >= 500) {
          logger.error('HTTP request completed with server error', logPayload);
          return;
        }

        if (res.statusCode >= 400) {
          logger.warn('HTTP request completed with client error', logPayload);
          return;
        }

        logger.info('HTTP request completed', logPayload);
      });

      return next();
    },
  );
}

module.exports = requestLogger;