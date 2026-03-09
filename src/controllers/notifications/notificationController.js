const {
  buildSuggestedActions,
  getNotificationSummary,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} = require('../../services/notifications/notificationService');

async function getSummary(req, res) {
  try {
    const summary = await getNotificationSummary(req.user.userId);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch notification summary.' });
  }
}

async function listNotifications(req, res) {
  try {
    const tab = typeof req.query.tab === 'string' ? req.query.tab : 'all';
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const limit = typeof req.query.limit === 'string' ? req.query.limit : req.query.limit;

    const payload = await listNotificationsForUser(req.user.userId, { tab, cursor, limit });
    const suggestedActions = tab === 'needs-action'
      ? await buildSuggestedActions(req.user.userId)
      : [];

    return res.json({
      notifications: payload.items,
      next_cursor: payload.next_cursor,
      suggested_actions: suggestedActions,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
}

async function readNotification(req, res) {
  try {
    const notification = await markNotificationRead(req.user.userId, req.params.notificationId);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }

    return res.json({ read: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
}

async function readAllNotifications(req, res) {
  try {
    const tab = typeof req.body?.tab === 'string' ? req.body.tab : 'all';
    const updated = await markAllNotificationsRead(req.user.userId, tab);
    return res.json({ read: true, updated });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
}

module.exports = {
  getSummary,
  listNotifications,
  readNotification,
  readAllNotifications,
};
