const { User } = require('../../models');

function normalizeUsername(value) {
  return (typeof value === 'string' ? value : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

async function generateUniqueUsername(seed) {
  const base = normalizeUsername(seed) || 'developer';
  let candidate = base;
  let counter = 0;

  while (counter < 1000) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.findOne({ where: { username: candidate }, attributes: ['id'] });
    if (!exists) return candidate;
    counter += 1;
    candidate = `${base}_${counter}`.slice(0, 50);
  }

  return `developer_${Date.now()}`.slice(0, 50);
}

async function initializeUserStore() {
  return Promise.resolve();
}

async function findUserByEmail(email) {
  const user = await User.findOne({ where: { email } });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    passwordHash: user.password_hash,
    name: user.name,
    username: user.username,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    websiteUrl: user.website_url,
    githubUrl: user.github_url,
    linkedinUrl: user.linkedin_url,
    createdAt: user.created_at,
  };
}

async function findUserById(userId) {
  const user = await User.findByPk(userId);

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    passwordHash: user.password_hash,
    name: user.name,
    username: user.username,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    websiteUrl: user.website_url,
    githubUrl: user.github_url,
    linkedinUrl: user.linkedin_url,
    createdAt: user.created_at,
  };
}

async function createUser({ email, passwordHash, name, username }) {
  const resolvedUsername = await generateUniqueUsername(username || name || email.split('@')[0]);

  const user = await User.create({
    email,
    password_hash: passwordHash,
    name: name || '',
    username: resolvedUsername,
  });

  return {
    id: user.id,
    email: user.email,
    passwordHash: user.password_hash,
    name: user.name,
    username: user.username,
    headline: user.headline,
    bio: user.bio,
    location: user.location,
    websiteUrl: user.website_url,
    githubUrl: user.github_url,
    linkedinUrl: user.linkedin_url,
    createdAt: user.created_at,
  };
}

async function updatePassword(email, passwordHash) {
  const user = await User.findOne({ where: { email } });
  if (!user) return null;

  user.password_hash = passwordHash;
  await user.save();

  return true;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    headline: user.headline || null,
    bio: user.bio || null,
    location: user.location || null,
    websiteUrl: user.websiteUrl || null,
    githubUrl: user.githubUrl || null,
    linkedinUrl: user.linkedinUrl || null,
    createdAt: user.createdAt,
  };
}

module.exports = {
  initializeUserStore,
  createUser,
  findUserByEmail,
  findUserById,
  updatePassword,
  sanitizeUser,
};
