const { ProjectSpaceDiscussion, ProjectSpaceDiscussionReply, User } = require('../../models');
const {
  getSpaceOr404,
  ensureSpaceReadable,
  getMembership,
  isMaintainerOrOwner,
  isMember,
} = require('../../services/spaces/spaceAccess');
const {
  DISCUSSION_CATEGORIES,
  DISCUSSION_STATUSES,
  asTrimmedString,
  isAllowedValue,
} = require('../../services/spaces/spaceValidation');
const { parsePagination } = require('../../services/spaces/pagination');
const {
  buildEntityRef,
  emitUserNotifications,
} = require('../../services/notifications/notificationService');

async function createDiscussion(req, res) {
  try {
    const userId = req.user.userId;
    const spaceId = req.params.spaceId;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMember(membership)) {
      return res.status(403).json({ error: 'Only project contributors can start discussions.' });
    }

    const title = asTrimmedString(req.body.title);
    const body = asTrimmedString(req.body.body);
    const category = asTrimmedString(req.body.category || 'idea');

    if (title.length < 5) {
      return res.status(400).json({ error: 'Discussion title must be at least 5 characters.' });
    }

    if (body.length < 10) {
      return res.status(400).json({ error: 'Discussion body must be at least 10 characters.' });
    }

    if (!isAllowedValue(category, DISCUSSION_CATEGORIES)) {
      return res.status(400).json({ error: 'Invalid discussion category.' });
    }

    const thread = await ProjectSpaceDiscussion.create({
      space_id: spaceId,
      author_id: userId,
      title,
      body,
      category,
      is_pinned: false,
      status: 'open',
    });

    return res.status(201).json({ thread });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create discussion.' });
  }
}

async function listDiscussions(req, res) {
  try {
    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(req.params.spaceId, requesterId, res);
    if (!readableSpace) return;

    const { limit, page, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const { count, rows: threads } = await ProjectSpaceDiscussion.findAndCountAll({
      where: { space_id: req.params.spaceId },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email'] }],
      order: [['is_pinned', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return res.json({ threads, total: count, page, limit });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch discussions.' });
  }
}

async function getDiscussion(req, res) {
  try {
    const { spaceId, threadId } = req.params;

    const requesterId = req.user?.userId || null;
    const readableSpace = await ensureSpaceReadable(spaceId, requesterId, res);
    if (!readableSpace) return;

    const thread = await ProjectSpaceDiscussion.findOne({
      where: { id: threadId, space_id: spaceId },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'email'] },
        {
          model: ProjectSpaceDiscussionReply,
          as: 'replies',
          include: [{ model: User, as: 'author', attributes: ['id', 'name', 'email'] }],
        },
      ],
      order: [[{ model: ProjectSpaceDiscussionReply, as: 'replies' }, 'created_at', 'ASC']],
    });

    if (!thread) {
      return res.status(404).json({ error: 'Discussion thread not found.' });
    }

    return res.json({ thread });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch discussion thread.' });
  }
}

async function addDiscussionReply(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, threadId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMember(membership)) {
      return res.status(403).json({ error: 'Only project contributors can reply.' });
    }

    const thread = await ProjectSpaceDiscussion.findOne({
      where: { id: threadId, space_id: spaceId },
    });

    if (!thread) {
      return res.status(404).json({ error: 'Discussion thread not found.' });
    }

    const body = asTrimmedString(req.body.body);
    const parentReplyId = asTrimmedString(req.body.parent_reply_id || '');
    if (!body) {
      return res.status(400).json({ error: 'Reply body is required.' });
    }

    let parentReply = null;
    if (parentReplyId) {
      parentReply = await ProjectSpaceDiscussionReply.findOne({
        where: { id: parentReplyId, thread_id: threadId },
      });

      if (!parentReply) {
        return res.status(400).json({ error: 'Parent reply is invalid for this discussion.' });
      }
    }

    const reply = await ProjectSpaceDiscussionReply.create({
      thread_id: threadId,
      author_id: userId,
      parent_reply_id: parentReply ? parentReply.id : null,
      body,
    });

    const recipientIds = [...new Set([
      thread.author_id,
      parentReply?.author_id,
    ].filter(Boolean))];

    await emitUserNotifications(
      recipientIds.map((recipientUserId) => ({
        recipientUserId,
        actorUserId: userId,
        eventType: 'space_discussion_reply',
        category: 'space',
        priority: 'important',
        entityType: 'space',
        entityId: spaceId,
        entitySnapshot: buildEntityRef({
          type: 'space',
          id: spaceId,
          title: space.name,
          href: `/spaces/${spaceId}`,
          visibility: space.visibility,
        }),
        secondaryEntityType: 'space_discussion',
        secondaryEntityId: thread.id,
        secondarySnapshot: {
          type: 'space_discussion',
          id: thread.id,
          title: thread.title,
          href: `/spaces/${spaceId}/discussions/${threadId}`,
          subtitle: body,
          visibility: null,
          tags: [],
        },
        actionUrl: `/spaces/${spaceId}/discussions/${threadId}`,
        previewText: 'replied in a discussion you follow',
        groupKey: `space_discussion_reply:${thread.id}:${recipientUserId}`,
        dedupeKey: `space_discussion_reply:${reply.id}:${recipientUserId}`,
        createdAt: reply.created_at,
      }))
    );

    return res.status(201).json({ reply });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to post discussion reply.' });
  }
}

async function updateDiscussion(req, res) {
  try {
    const userId = req.user.userId;
    const { spaceId, threadId } = req.params;

    const space = await getSpaceOr404(spaceId, res);
    if (!space) return;

    const membership = await getMembership(spaceId, userId);
    if (!isMaintainerOrOwner(membership)) {
      return res.status(403).json({ error: 'Only owner or maintainer can update thread status/pin/decision.' });
    }

    const thread = await ProjectSpaceDiscussion.findOne({
      where: { id: threadId, space_id: spaceId },
    });

    if (!thread) {
      return res.status(404).json({ error: 'Discussion thread not found.' });
    }

    const updates = {};

    if (req.body.status !== undefined) {
      const status = asTrimmedString(req.body.status);
      if (!isAllowedValue(status, DISCUSSION_STATUSES)) {
        return res.status(400).json({ error: 'Invalid discussion status.' });
      }
      updates.status = status;
    }

    if (req.body.is_pinned !== undefined) {
      updates.is_pinned = Boolean(req.body.is_pinned);
    }

    if (req.body.category !== undefined) {
      const category = asTrimmedString(req.body.category);
      if (!isAllowedValue(category, DISCUSSION_CATEGORIES)) {
        return res.status(400).json({ error: 'Invalid discussion category.' });
      }
      updates.category = category;
    }

    if (req.body.decision_summary !== undefined) {
      const decisionSummary = asTrimmedString(req.body.decision_summary);
      updates.decision_summary = decisionSummary || null;
      if (decisionSummary && updates.category === undefined && thread.category !== 'decision') {
        updates.category = 'decision';
      }
    }

    updates.updated_at = new Date();
    await thread.update(updates);

    return res.json({ thread });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update discussion thread.' });
  }
}

module.exports = {
  createDiscussion,
  listDiscussions,
  getDiscussion,
  addDiscussionReply,
  updateDiscussion,
};
