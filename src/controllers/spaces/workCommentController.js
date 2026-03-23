const {
  ProjectSpaceIssue,
  ProjectSpaceIssueComment,
  User,
} = require('../../models');
const { ensureSpaceReadable } = require('../../services/spaces/spaceAccess');
const { asTrimmedString } = require('../../services/spaces/spaceValidation');
const { logWorkActivity } = require('../../services/spaces/workActivity');

async function loadIssue(spaceId, issueId) {
  return ProjectSpaceIssue.findOne({
    where: { id: issueId, space_id: spaceId },
    attributes: ['id', 'space_id', 'title'],
  });
}

async function listWorkComments(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const { spaceId, issueId } = req.params;

    const readableSpace = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!readableSpace) return;

    const issue = await loadIssue(spaceId, issueId);
    if (!issue) {
      return res.status(404).json({ error: 'Work item not found.' });
    }

    const comments = await ProjectSpaceIssueComment.findAll({
      where: { issue_id: issue.id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
      order: [['created_at', 'ASC']],
    });

    return res.json({ comments });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch work comments.' });
  }
}

async function createWorkComment(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, issueId } = req.params;

    const readableSpace = await ensureSpaceReadable(spaceId, userId, res);
    if (!readableSpace) return;

    const issue = await loadIssue(spaceId, issueId);
    if (!issue) {
      return res.status(404).json({ error: 'Work item not found.' });
    }

    const body = asTrimmedString(req.body.body);
    if (body.length < 1 || body.length > 2000) {
      return res.status(400).json({ error: 'Comment must be between 1 and 2000 characters.' });
    }

    const parentCommentId = asTrimmedString(req.params.commentId || '');
    let parentComment = null;
    if (parentCommentId) {
      parentComment = await ProjectSpaceIssueComment.findOne({
        where: { id: parentCommentId, issue_id: issue.id },
        attributes: ['id'],
      });
      if (!parentComment) {
        return res.status(400).json({ error: 'Invalid parent comment.' });
      }
    }

    const comment = await ProjectSpaceIssueComment.create({
      issue_id: issue.id,
      author_id: userId,
      parent_comment_id: parentComment ? parentComment.id : null,
      body,
      updated_at: new Date(),
    });

    const hydrated = await ProjectSpaceIssueComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email', 'username'] }],
    });

    await logWorkActivity({
      spaceId,
      issueId: issue.id,
      actorUserId: userId,
      eventType: 'comment_added',
      payload: {
        comment_id: comment.id,
        parent_comment_id: comment.parent_comment_id,
        body_preview: body.slice(0, 240),
      },
      createdAt: comment.created_at,
    });

    return res.status(201).json({ comment: hydrated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create work comment.' });
  }
}

module.exports = {
  listWorkComments,
  createWorkComment,
};
