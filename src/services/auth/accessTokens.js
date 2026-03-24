const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, UserAccessToken } = require('../../models');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateTokenValue() {
  return `ldt_${crypto.randomBytes(24).toString('hex')}`;
}

function sanitizeTokenRecord(record) {
  return {
    id: record.id,
    name: record.name,
    token_prefix: record.token_prefix,
    scopes: Array.isArray(record.scopes) ? record.scopes : ['git:read', 'git:write'],
    last_used_at: record.last_used_at,
    expires_at: record.expires_at,
    revoked_at: record.revoked_at,
    created_at: record.created_at,
  };
}

async function listAccessTokensForUser(userId) {
  const tokens = await UserAccessToken.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
  });

  return tokens.map(sanitizeTokenRecord);
}

function normalizeScopes(scopes) {
  const allowed = new Set(['git:read', 'git:write']);
  if (!Array.isArray(scopes)) {
    return ['git:read', 'git:write'];
  }

  return Array.from(new Set(
    scopes
      .map((scope) => (typeof scope === 'string' ? scope.trim() : ''))
      .filter((scope) => allowed.has(scope))
  ));
}

function tokenHasScope(token, requiredScope) {
  const scopes = Array.isArray(token?.scopes) ? token.scopes : ['git:read', 'git:write'];
  return scopes.includes(requiredScope);
}

async function createAccessTokenForUser(userId, name, expiresAt = null, scopes = null) {
  const plaintext = generateTokenValue();
  const token = await UserAccessToken.create({
    user_id: userId,
    name,
    token_prefix: plaintext.slice(0, 12),
    token_hash: hashToken(plaintext),
    scopes: normalizeScopes(scopes),
    expires_at: expiresAt,
  });

  return {
    token: sanitizeTokenRecord(token),
    plaintext,
  };
}

async function revokeAccessTokenForUser(userId, tokenId) {
  const token = await UserAccessToken.findOne({
    where: {
      id: tokenId,
      user_id: userId,
    },
  });

  if (!token) return false;

  await token.update({
    revoked_at: new Date(),
  });

  return true;
}

async function verifyAccessToken(plaintextToken) {
  if (!plaintextToken || typeof plaintextToken !== 'string') {
    return null;
  }

  const digest = hashToken(plaintextToken);
  const token = await UserAccessToken.findOne({
    where: {
      token_hash: digest,
      revoked_at: null,
      [Op.or]: [
        { expires_at: null },
        { expires_at: { [Op.gt]: new Date() } },
      ],
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'username'], required: false }],
  });

  if (!token) return null;

  await token.update({ last_used_at: new Date() });

  return {
    userId: token.user_id,
    token,
  };
}

module.exports = {
  listAccessTokensForUser,
  createAccessTokenForUser,
  revokeAccessTokenForUser,
  verifyAccessToken,
  normalizeScopes,
  tokenHasScope,
};
