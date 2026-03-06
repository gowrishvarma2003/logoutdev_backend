const { Op } = require('sequelize');
const { User } = require('../../models');

const USERNAME_REGEX = /^[a-z0-9_]+$/;

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUsername(value) {
  const base = asTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

  return base;
}

function isValidUsername(username) {
  return USERNAME_REGEX.test(username) && username.length >= 3 && username.length <= 50;
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeStringArray(values, maxItems = 10) {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  const normalized = [];

  for (const raw of values) {
    const item = asTrimmedString(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    normalized.push(item.slice(0, 60));
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

async function generateUniqueUsername(seed, fallback = 'developer') {
  const normalized = normalizeUsername(seed) || fallback;
  let candidate = normalized;
  let counter = 0;

  while (counter < 1000) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.findOne({ where: { username: candidate }, attributes: ['id'] });
    if (!exists) return candidate;

    counter += 1;
    candidate = `${normalized}_${counter}`.slice(0, 50);
  }

  return `${fallback}_${Date.now()}`.slice(0, 50);
}

async function ensureUniqueUsername(username, excludeUserId = null) {
  const where = excludeUserId
    ? { username, id: { [Op.ne]: excludeUserId } }
    : { username };

  const existing = await User.findOne({ where, attributes: ['id'] });
  return !existing;
}

module.exports = {
  asTrimmedString,
  normalizeUsername,
  isValidUsername,
  isValidUrl,
  normalizeStringArray,
  generateUniqueUsername,
  ensureUniqueUsername,
};
