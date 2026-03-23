const { PullRequest, PullRequestComment, PullRequestReview, User } = require('../../models');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

async function addComment(req, res) {
  try {
    const { repoId, number } = req.params;
    const { body, path, position, parent_comment_id, review_id } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!body) return res.status(400).json({ error: 'Comment body is required.' });

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    if (review_id) {
      const review = await PullRequestReview.findOne({ where: { id: review_id, pull_request_id: pr.id } });
      if (!review) return res.status(404).json({ error: 'Review not found.' });
    }

    if (parent_comment_id) {
      const parent = await PullRequestComment.findOne({ where: { id: parent_comment_id, pull_request_id: pr.id } });
      if (!parent) return res.status(404).json({ error: 'Parent comment not found.' });
    }

    const comment = await PullRequestComment.create({
      pull_request_id: pr.id,
      review_id,
      author_id: userId,
      path,
      position,
      body,
      parent_comment_id,
    });

    res.status(201).json(comment);
  } catch (err) {
    console.error('Add PR Comment Error:', err);
    res.status(500).json({ error: 'Failed to add pull request comment.' });
  }
}

async function listComments(req, res) {
  try {
    const { repoId, number } = req.params;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const comments = await PullRequestComment.findAll({
      where: { pull_request_id: pr.id },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'] }
      ],
      order: [['created_at', 'ASC']],
    });

    res.json(comments.map(c => ({
      ...c.toJSON(),
      author: {
        ...c.author.toJSON(),
        avatar_url: `${baseUrl}/api/users/${c.author.id}/avatar`
      }
    })));
  } catch (err) {
    console.error('List PR Comments Error:', err);
    res.status(500).json({ error: 'Failed to list pull request comments.' });
  }
}

async function updateComment(req, res) {
  try {
    const { repoId, number, commentId } = req.params;
    const { body } = req.body;
    const userId = getAuthenticatedUserId(req);

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const comment = await PullRequestComment.findOne({ where: { id: commentId, pull_request_id: pr.id } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });

    if (comment.author_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to edit this comment.' });
    }

    comment.body = body;
    await comment.save();

    res.json(comment);
  } catch (err) {
    console.error('Update PR Comment Error:', err);
    res.status(500).json({ error: 'Failed to update comment.' });
  }
}

async function deleteComment(req, res) {
  try {
    const { repoId, number, commentId } = req.params;
    const userId = getAuthenticatedUserId(req);

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const comment = await PullRequestComment.findOne({ where: { id: commentId, pull_request_id: pr.id } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });

    if (comment.author_id !== userId && pr.author_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this comment.' });
    }

    await comment.destroy();
    res.json({ message: 'Comment deleted successfully.' });
  } catch (err) {
    console.error('Delete PR Comment Error:', err);
    res.status(500).json({ error: 'Failed to delete comment.' });
  }
}

async function resolveThread(req, res) {
  try {
    const { repoId, number, commentId } = req.params;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const comment = await PullRequestComment.findOne({ where: { id: commentId, pull_request_id: pr.id } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });

    comment.is_resolved = true;
    await comment.save();

    res.json(comment);
  } catch (err) {
    console.error('Resolve PR Thread Error:', err);
    res.status(500).json({ error: 'Failed to resolve thread.' });
  }
}

module.exports = {
  addComment,
  listComments,
  updateComment,
  deleteComment,
  resolveThread,
};
