const path = require('path');
const { getRepoBySlugsOr404, getAccessContext } = require('../../services/spaces/repoAccess');
const { verifyAccessToken } = require('../../services/auth/accessTokens');
const { streamGitHttpBackend } = require('../../services/git/gitHttpBackend');
const { getRepoPath } = require('../../services/git/gitPath');

function getRouteParams(req) {
  if (Array.isArray(req.params)) {
    return {
      spaceSlug: req.params[0],
      repoSlug: req.params[1],
      rest: req.params[2] || '',
    };
  }

  return {
    spaceSlug: req.params?.[0],
    repoSlug: req.params?.[1],
    rest: req.params?.[2] || '',
  };
}

function getBasicAuthToken(req) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) return null;

  const encoded = authorization.slice('Basic '.length).trim();
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 2) return null;
    return {
      username: parts.shift() || '',
      token: parts.join(':'),
    };
  } catch (error) {
    return null;
  }
}

function getGitService(req) {
  const service = typeof req.query.service === 'string' ? req.query.service : '';
  if (service === 'git-upload-pack' || req.path.endsWith('/git-upload-pack')) {
    return 'read';
  }
  if (service === 'git-receive-pack' || req.path.endsWith('/git-receive-pack')) {
    return 'write';
  }
  return null;
}

async function handleGitTransport(req, res) {
  try {
    const { spaceSlug, repoSlug, rest } = getRouteParams(req);
    if (!spaceSlug || !repoSlug) {
      return res.status(404).end('Repository not found');
    }

    const repo = await getRepoBySlugsOr404(spaceSlug, repoSlug, res);
    if (!repo) return;

    const credentials = getBasicAuthToken(req);
    if (!credentials) {
      res.setHeader('WWW-Authenticate', 'Basic realm="LogoutDev Git"');
      return res.status(401).end('Authentication required');
    }

    const verified = await verifyAccessToken(credentials.token);
    if (!verified) {
      res.setHeader('WWW-Authenticate', 'Basic realm="LogoutDev Git"');
      return res.status(401).end('Invalid access token');
    }

    const access = await getAccessContext(repo, verified.userId);
    const serviceMode = getGitService(req);

    if (serviceMode === 'write' && !access.canWrite) {
      return res.status(404).end('Repository not found');
    }

    if (serviceMode === 'read' && !access.canRead) {
      return res.status(404).end('Repository not found');
    }

    const repoPath = getRepoPath(repo.space.id, repo.id);
    return streamGitHttpBackend(req, res, {
      gitProjectRoot: path.dirname(repoPath),
      pathInfo: `/${path.basename(repoPath)}${rest ? `/${rest}` : ''}`,
      remoteUser: credentials.username || verified.userId,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Git transport failed.' });
  }
}

module.exports = {
  handleGitTransport,
};
