const { PullRequest, PullRequestComment, PullRequestReview, User } = require('../../models');
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

async function addComment(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const { body, path, position, parent_comment_id, review_id } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!body) return res.status(400).json({ error: 'Comment body is required.' });
    if (!readable.access.permissions.can_read) {
      return res.status(403).json({ error: 'You do not have permission to comment on this pull request.' });
    }

    const pr = await loadPr(repoId, number);
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

    const reloaded = await PullRequestComment.findByPk(comment.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'], required: false },
      ],
    });

    res.status(201).json({
      ...reloaded.toJSON(),
      author: withAvatar(reloaded.author, req),
    });
  } catch (err) {
    console.error('Add PR Comment Error:', err);
    res.status(500).json({ error: 'Failed to add pull request comment.' });
  }
}

async function listComments(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user?.userId || null, res);
    if (!readable) return;

    const pr = await loadPr(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const comments = await PullRequestComment.findAll({
      where: { pull_request_id: pr.id },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'], required: false },
      ],
      order: [['created_at', 'ASC'], ['updated_at', 'ASC']],
    });

    res.json(comments.map((comment) => ({
      ...comment.toJSON(),
      author: withAvatar(comment.author, req),
    })));
  } catch (err) {
    console.error('List PR Comments Error:', err);
    res.status(500).json({ error: 'Failed to list pull request comments.' });
  }
}

async function updateComment(req, res) {
  try {
    const { repoId, number, commentId } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const pr = await loadPr(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const comment = await PullRequestComment.findOne({ where: { id: commentId, pull_request_id: pr.id } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });
    if (comment.author_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized to edit this comment.' });
    }

    comment.body = req.body.body;
    await comment.save();

    const reloaded = await PullRequestComment.findByPk(comment.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'], required: false },
      ],
    });

    res.json({
      ...reloaded.toJSON(),
      author: withAvatar(reloaded.author, req),
    });
  } catch (err) {
    console.error('Update PR Comment Error:', err);
    res.status(500).json({ error: 'Failed to update comment.' });
  }
}

async function deleteComment(req, res) {
  try {
    const { repoId, number, commentId } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const pr = await loadPr(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const comment = await PullRequestComment.findOne({ where: { id: commentId, pull_request_id: pr.id } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });
    if (comment.author_id !== req.user.userId && pr.author_id !== req.user.userId && !readable.access.permissions.can_review) {
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
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    if (!readable.access.permissions.can_review) {
      return res.status(403).json({ error: 'You do not have permission to resolve review threads.' });
    }

    const pr = await loadPr(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const comment = await PullRequestComment.findOne({ where: { id: commentId, pull_request_id: pr.id } });
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });

    comment.is_resolved = true;
    await comment.save();

    const reloaded = await PullRequestComment.findByPk(comment.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'], required: false },
      ],
    });

    res.json({
      ...reloaded.toJSON(),
      author: withAvatar(reloaded.author, req),
    });
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
