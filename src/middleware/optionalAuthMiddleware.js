const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function optionalAuthMiddleware(req, res, next) {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authorizationHeader.replace('Bearer ', '').trim();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (error) {
    // Ignore invalid token on optional auth endpoints; protected routes still use authMiddleware.
  }

  return next();
}

module.exports = optionalAuthMiddleware;
