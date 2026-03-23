const { RepoDiscussion, RepoDiscussionComment, User } = require('../../models');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

exports.listDiscussions = async (req, res) => {
  try {
    const { repoId } = req.params;
    const { category } = req.query;

    const where = { repo_id: repoId };
    if (category) {
      where.category = category;
    }

    const discussions = await RepoDiscussion.findAll({
      where,
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'name', 'username', 'github_url'],
        },
      ],
      order: [
        ['is_pinned', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });

    res.json(discussions);
  } catch (err) {
    console.error('Error listing discussions:', err);
    res.status(500).json({ error: 'Failed to list discussions' });
  }
};

exports.createDiscussion = async (req, res) => {
  try {
    const { repoId } = req.params;
    const { title, body, category } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }

    const discussion = await RepoDiscussion.create({
      repo_id: repoId,
      author_id: userId,
      title,
      body,
      category: category || 'general',
    });

    const discussionWithAuthor = await RepoDiscussion.findByPk(discussion.id, {
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'name', 'username', 'github_url'],
        },
      ],
    });

    res.status(201).json({ discussion: discussionWithAuthor });
  } catch (err) {
    console.error('Error creating discussion:', err);
    res.status(500).json({ error: 'Failed to create discussion' });
  }
};

exports.getDiscussion = async (req, res) => {
  try {
    const { repoId, discussionId } = req.params;

    const discussion = await RepoDiscussion.findOne({
      where: { id: discussionId, repo_id: repoId },
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'name', 'username', 'github_url'],
        },
        {
          model: RepoDiscussionComment,
          as: 'comments',
          include: [
            {
              model: User,
              as: 'author',
              attributes: ['id', 'name', 'username', 'github_url'],
            },
            // Recursive threading could get expensive, 1-level deep for MVP
            {
              model: RepoDiscussionComment,
              as: 'replies',
              include: [
                {
                  model: User,
                  as: 'author',
                  attributes: ['id', 'name', 'username', 'github_url'],
                },
              ],
            },
          ],
        },
      ],
      order: [[{ model: RepoDiscussionComment, as: 'comments' }, 'created_at', 'ASC']],
    });

    if (!discussion) {
      return res.status(404).json({ error: 'Discussion not found' });
    }

    // Filter out replies from top-level comments list easily
    const finalDiscussion = discussion.toJSON();
    finalDiscussion.comments = finalDiscussion.comments.filter((c) => !c.parent_comment_id);

    res.json({ discussion: finalDiscussion });
  } catch (err) {
    console.error('Error fetching discussion:', err);
    res.status(500).json({ error: 'Failed to fetch discussion' });
  }
};

exports.addDiscussionComment = async (req, res) => {
  try {
    const { repoId, discussionId } = req.params;
    const { body, parent_comment_id } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!body) {
      return res.status(400).json({ error: 'Comment body is required' });
    }

    // Verify discussion belongs to repo
    const discussion = await RepoDiscussion.findOne({
      where: { id: discussionId, repo_id: repoId },
    });

    if (!discussion) return res.status(404).json({ error: 'Discussion not found' });

    const comment = await RepoDiscussionComment.create({
      discussion_id: discussionId,
      author_id: userId,
      body,
      parent_comment_id: parent_comment_id || null,
    });

    const populatedComment = await RepoDiscussionComment.findByPk(comment.id, {
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'name', 'username'],
        },
      ],
    });

    res.status(201).json({ comment: populatedComment });
  } catch (err) {
    console.error('Error adding discussion comment:', err);
    res.status(500).json({ error: 'Failed to post comment' });
  }
};

exports.markAnswer = async (req, res) => {
  try {
    const { repoId, discussionId, commentId } = req.params;

    const discussion = await RepoDiscussion.findOne({
      where: { id: discussionId, repo_id: repoId },
    });

    if (!discussion) return res.status(404).json({ error: 'Discussion not found' });

    // Ensure comment belongs to discussion
    const comment = await RepoDiscussionComment.findOne({
      where: { id: commentId, discussion_id: discussionId },
    });

    if (!comment) return res.status(404).json({ error: 'Comment not found in this discussion' });

    await discussion.update({
      is_answered: true,
      answer_comment_id: comment.id,
    });

    res.json({ discussion });
  } catch (err) {
    console.error('Error marking answer:', err);
    res.status(500).json({ error: 'Failed to mark as answer' });
  }
};
