const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const {
  getSummary,
  listNotifications,
  readNotification,
  readAllNotifications,
} = require('../../controllers/notifications/notificationController');

const router = express.Router();

router.use(authMiddleware);

router.get('/summary', getSummary);
router.get('/', listNotifications);
router.post('/read-all', readAllNotifications);
router.post('/:notificationId/read', readNotification);

module.exports = router;
