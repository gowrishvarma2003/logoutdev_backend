const { PullRequest, PullRequestReview, User } = require('../../models');
const { ensureRepoReadable } = require('../../services/spaces/repoAccess');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

async function loadPr(repoId, number) {
  return PullRequest.findOne({ where: { repo_id: repoId, number } });
}

function withAvatar(user, req) {
  if (!user) return null;
  return {
    ...user.toJSON(),
    avatar_url: `${req.protocol}://${req.get('host')}/api/users/${user.id}/avatar`,
  };
}

async function submitReview(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const { status, body } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!['approved', 'changes_requested', 'commented'].includes(status)) {
      return res.status(400).json({ error: 'Invalid review status.' });
    }
    if (!readable.access.permissions.can_review) {
      return res.status(403).json({ error: 'You do not have permission to review pull requests for this repository.' });
    }

    const pr = await loadPr(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });
    if (pr.status !== 'open') {
      return res.status(400).json({ error: 'Only open pull requests can be reviewed.' });
    }
    if (pr.author_id === userId && status !== 'commented') {
      return res.status(400).json({ error: 'You cannot approve or request changes on your own pull request.' });
    }

    const review = await PullRequestReview.create({
      pull_request_id: pr.id,
      reviewer_id: userId,
      status,
      body,
      submitted_at: new Date(),
    });

    const reloaded = await PullRequestReview.findByPk(review.id, {
      include: [
        { model: User, as: 'reviewer', attributes: ['id', 'name', 'username', 'email'], required: false },
      ],
    });

    res.status(201).json({
      ...reloaded.toJSON(),
      reviewer: withAvatar(reloaded.reviewer, req),
    });
  } catch (err) {
    console.error('Submit PR Review Error:', err);
    res.status(500).json({ error: 'Failed to submit review.' });
  }
}

async function listReviews(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user?.userId || null, res);
    if (!readable) return;

    const pr = await loadPr(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const reviews = await PullRequestReview.findAll({
      where: { pull_request_id: pr.id },
      include: [
        { model: User, as: 'reviewer', attributes: ['id', 'name', 'username', 'email'], required: false },
      ],
      order: [['submitted_at', 'ASC'], ['createdAt', 'ASC']],
    });

    res.json(reviews.map((review) => ({
      ...review.toJSON(),
      reviewer: withAvatar(review.reviewer, req),
    })));
  } catch (err) {
    console.error('List PR Reviews Error:', err);
    res.status(500).json({ error: 'Failed to list reviews.' });
  }
}

module.exports = {
  submitReview,
  listReviews,
};
