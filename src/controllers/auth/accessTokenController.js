const {
  listAccessTokensForUser,
  createAccessTokenForUser,
  revokeAccessTokenForUser,
} = require('../../services/auth/accessTokens');

function parseExpiresAt(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const date = new Date(`${value.trim()}T23:59:59.999`);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

async function listAccessTokens(req, res) {
  try {
    const tokens = await listAccessTokensForUser(req.user.userId);
    return res.json({ tokens });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch access tokens.' });
  }
}

async function createAccessToken(req, res) {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ error: 'Token name is required.' });
    }

    const expiresAt = parseExpiresAt(req.body.expires_at);
    if (req.body.expires_at && !expiresAt) {
      return res.status(400).json({ error: 'expires_at must be a valid date.' });
    }

    const { token, plaintext } = await createAccessTokenForUser(
      req.user.userId,
      name,
      expiresAt
    );

    return res.status(201).json({
      token,
      plaintext_token: plaintext,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create access token.' });
  }
}

async function revokeAccessToken(req, res) {
  try {
    const revoked = await revokeAccessTokenForUser(req.user.userId, req.params.tokenId);
    if (!revoked) {
      return res.status(404).json({ error: 'Access token not found.' });
    }

    return res.json({ revoked: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to revoke access token.' });
  }
}

module.exports = {
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
};
