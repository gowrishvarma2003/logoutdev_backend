const { verifyServiceRequest } = require('../services/internal/serviceAuth');

function internalServiceAuth(options = {}) {
  return function internalServiceAuthMiddleware(req, res, next) {
    const result = verifyServiceRequest(req, options);
    if (!result.ok) {
      return res.status(401).json({ error: result.error });
    }

    req.internalService = {
      id: result.serviceId,
      timestamp: result.timestamp,
    };
    return next();
  };
}

module.exports = internalServiceAuth;
