const { PullRequest, PullRequestReview, User } = require('../../models');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

async function submitReview(req, res) {
  try {
    const { repoId, number } = req.params;
    const { status, body } = req.body; // status: 'approved', 'changes_requested', 'commented'
    const userId = getAuthenticatedUserId(req);

    if (!['approved', 'changes_requested', 'commented'].includes(status)) {
      return res.status(400).json({ error: 'Invalid review status.' });
    }

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

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

    res.status(201).json(review);
  } catch (err) {
    console.error('Submit PR Review Error:', err);
    res.status(500).json({ error: 'Failed to submit review.' });
  }
}

async function listReviews(req, res) {
  try {
    const { repoId, number } = req.params;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const reviews = await PullRequestReview.findAll({
      where: { pull_request_id: pr.id },
      include: [
        { model: User, as: 'reviewer', attributes: ['id', 'name', 'username', 'email'] }
      ],
      order: [['submitted_at', 'ASC']],
    });

    res.json(reviews.map(r => ({
      ...r.toJSON(),
      reviewer: {
        ...r.reviewer.toJSON(),
        avatar_url: `${baseUrl}/api/users/${r.reviewer.id}/avatar`
      }
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
