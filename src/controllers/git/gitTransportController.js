const path = require('path');
const { getRepoByGitRouteOr404, getRepoOr404, getAccessContext } = require('../../services/spaces/repoAccess');
const { verifyAccessToken, tokenHasScope } = require('../../services/auth/accessTokens');
const { streamGitHttpBackend } = require('../../services/git/gitHttpBackend');
const { resolveRepoPath } = require('../../services/git/gitPath');
const { ensureRepositoryHooks } = require('../../services/git/gitHooks');
const { syncRepoToSupabase } = require('../../services/git/gitSupabaseStorage');
const { withRepoLease, markRepoDirty, clearRepoDirty } = require('../../services/git/gitCacheState');

function getRouteParams(req) {
  if (req.params?.repoId) {
    return {
      repoId: req.params.repoId,
      namespace: null,
      repoSlug: null,
      rest: req.params[0] || '',
    };
  }

  if (Array.isArray(req.params)) {
    if (req.path.startsWith('/repos/')) {
      return {
        repoId: req.params[0],
        namespace: null,
        repoSlug: null,
        rest: req.params[1] || '',
      };
    }

    return {
      repoId: null,
      namespace: req.params[0],
      repoSlug: req.params[1],
      rest: req.params[2] || '',
    };
  }

  return {
    repoId: null,
    namespace: req.params?.[0],
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
    const { repoId, namespace, repoSlug, rest } = getRouteParams(req);
    if (!repoId && (!namespace || !repoSlug)) {
      return res.status(404).end('Repository not found');
    }

    const repo = repoId
      ? await getRepoOr404(repoId, res)
      : await getRepoByGitRouteOr404(namespace, repoSlug, res);
    if (!repo) return;

    const serviceMode = getGitService(req);
    const credentials = getBasicAuthToken(req);

    if (!credentials && serviceMode === 'read' && repo.visibility === 'public') {
      const repoPath = await resolveRepoPath(repo.id, repo.space_id);
      return withRepoLease(repoPath, async () => {
        await streamGitHttpBackend(req, res, {
          gitProjectRoot: path.dirname(repoPath),
          pathInfo: `/${path.basename(repoPath)}${rest ? `/${rest}` : ''}`,
          remoteUser: 'anonymous',
        });
      });
    }

    if (!credentials) {
      res.setHeader('WWW-Authenticate', 'Basic realm="LogoutDev Git"');
      return res.status(401).end('Authentication required');
    }

    const verified = await verifyAccessToken(credentials.token);
    if (!verified) {
      res.setHeader('WWW-Authenticate', 'Basic realm="LogoutDev Git"');
      return res.status(401).end('Invalid access token');
    }

    if (credentials.username && verified.token.user?.username && credentials.username !== verified.token.user.username) {
      res.setHeader('WWW-Authenticate', 'Basic realm="LogoutDev Git"');
      return res.status(401).end('Basic-auth username must match the access token owner');
    }

    const requiredScope = serviceMode === 'write' ? 'git:write' : 'git:read';
    if (requiredScope && !tokenHasScope(verified.token, requiredScope)) {
      return res.status(403).end(`Access token is missing ${requiredScope} scope`);
    }

    const access = await getAccessContext(repo, verified.userId);

    if (serviceMode === 'write' && !access.canWrite) {
      return res.status(404).end('Repository not found');
    }

    if (serviceMode === 'read' && !access.canRead) {
      return res.status(404).end('Repository not found');
    }

    const repoPath = await resolveRepoPath(repo.id, repo.space_id);
    await ensureRepositoryHooks(repoPath);
    return withRepoLease(repoPath, async () => {
      if (serviceMode === 'write') {
        await markRepoDirty(repoPath);
      }

      await streamGitHttpBackend(req, res, {
        gitProjectRoot: path.dirname(repoPath),
        pathInfo: `/${path.basename(repoPath)}${rest ? `/${rest}` : ''}`,
        remoteUser: credentials.username || repo.owner?.username || verified.userId,
        extraEnv: {
          LOGOUTDEV_REPO_ID: repo.id,
          LOGOUTDEV_ACTOR_ID: verified.userId,
        },
        onComplete: serviceMode === 'write'
          ? async ({ code }) => {
              if (Number(code) !== 0) {
                return;
              }
              await syncRepoToSupabase(repoPath, {
                repoId: repo.id,
                spaceId: repo.space_id,
              });
              await clearRepoDirty(repoPath);
            }
          : null,
      });
    });
  } catch (error) {
    return res.status(500).json({ error: 'Git transport failed.' });
  }
}

module.exports = {
  handleGitTransport,
};
