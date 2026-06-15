const bcrypt = require('bcryptjs');
const {
  createUser,
  findUserByEmail,
  findUserById,
  updatePassword,
  sanitizeUser,
} = require('../../services/auth/userStore');
const { createAuthToken } = require('../../utils/token');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim().toLowerCase());
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

async function register(req, res) {
  try {
    const { email, password, name, username } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser({
      email: normalizedEmail,
      passwordHash,
      name: typeof name === 'string' ? name.trim() : '',
      username: typeof username === 'string' ? username.trim() : '',
    });

    const token = createAuthToken({ userId: user.id, email: user.email });

    return res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to register user.' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!validateEmail(email) || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await findUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = createAuthToken({ userId: user.id, email: user.email });

    return res.json({ token, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to login.' });
  }
}

async function getCurrentUser(req, res) {
  try {
    const user = await findUserById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.json({ user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch user profile.' });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and new password are required.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await updatePassword(email.trim().toLowerCase(), passwordHash);

    if (!updated) {
      return res.status(404).json({ error: 'No account found with that email.' });
    }

    return res.json({ message: 'Password reset successfully.' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
}

module.exports = { register, login, getCurrentUser, resetPassword };
