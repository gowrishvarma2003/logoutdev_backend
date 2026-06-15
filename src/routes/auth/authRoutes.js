const express = require('express');
const { register, login, getCurrentUser, resetPassword } = require('../../controllers/auth/authController');
const authMiddleware = require('../../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authMiddleware, getCurrentUser);

router.post('/reset-password', resetPassword);

module.exports = router;
