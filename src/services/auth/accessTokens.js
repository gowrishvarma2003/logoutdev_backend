const crypto = require('crypto');
const { Op } = require('sequelize');
const { UserAccessToken } = require('../../models');

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

async function createAccessTokenForUser(userId, name, expiresAt = null) {
  const plaintext = generateTokenValue();
  const token = await UserAccessToken.create({
    user_id: userId,
    name,
    token_prefix: plaintext.slice(0, 12),
    token_hash: hashToken(plaintext),
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
};
