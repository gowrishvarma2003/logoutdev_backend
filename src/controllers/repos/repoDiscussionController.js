const { ensureRepoReadable } = require('../../services/spaces/repoAccess');
const { getMembership, buildSpaceViewerPermissions } = require('../../services/spaces/spaceAccess');

async function buildDiscussionState(repo, userId) {
  if (repo.space_id && repo.space) {
    const membership = userId ? await getMembership(repo.space_id, userId) : null;
    const viewerPermissions = buildSpaceViewerPermissions(repo.space, membership, userId);
    return {
      mode: 'space_handoff',
      message: 'Discussions for attached repositories now live in the linked Space.',
      collaboration_home: {
        type: 'space',
        space_id: repo.space.id,
        href: `/spaces/${repo.space.id}/discussions`,
        can_contribute: viewerPermissions.can_reply || viewerPermissions.can_manage_discussions,
        can_start_discussion: viewerPermissions.can_create_discussion,
      },
      viewer_permissions: viewerPermissions,
    };
  }

  return {
    mode: 'setup_required',
    message: 'Attach this repository to a Space to unlock project discussions, updates, and collaboration.',
    collaboration_home: {
      type: 'none',
      can_contribute: false,
      can_start_discussion: false,
    },
  };
}

exports.listDiscussions = async (req, res) => {
  try {
    const requesterId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, requesterId, res);
    if (!result) return;

    return res.json(await buildDiscussionState(result.repo, requesterId));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load repository collaboration state.' });
  }
};

exports.createDiscussion = async (req, res) => {
  try {
    const result = await ensureRepoReadable(req.params.repoId, req.user.userId, res);
    if (!result) return;
    return res.status(409).json({
      error: 'Repository discussions are disabled. Use the collaboration home instead.',
      ...(await buildDiscussionState(result.repo, req.user.userId)),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to route repository discussion.' });
  }
};

exports.getDiscussion = async (req, res) => {
  try {
    const requesterId = req.user?.userId || null;
    const result = await ensureRepoReadable(req.params.repoId, requesterId, res);
    if (!result) return;
    return res.json(await buildDiscussionState(result.repo, requesterId));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load repository collaboration state.' });
  }
};

exports.addDiscussionComment = async (req, res) => {
  try {
    const result = await ensureRepoReadable(req.params.repoId, req.user.userId, res);
    if (!result) return;
    return res.status(409).json({
      error: 'Repository discussions are disabled. Use the collaboration home instead.',
      ...(await buildDiscussionState(result.repo, req.user.userId)),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to route repository discussion.' });
  }
};

exports.markAnswer = async (req, res) => {
  try {
    const result = await ensureRepoReadable(req.params.repoId, req.user.userId, res);
    if (!result) return;
    return res.status(409).json({
      error: 'Repository discussions are disabled. Use the collaboration home instead.',
      ...(await buildDiscussionState(result.repo, req.user.userId)),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to route repository discussion.' });
  }
};
