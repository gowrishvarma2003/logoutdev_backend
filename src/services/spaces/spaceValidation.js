const SPACE_STATUSES = new Set(['idea', 'building', 'shipping', 'paused', 'archived']);
const SPACE_VISIBILITIES = new Set(['public', 'private']);
const STACK_CATEGORIES = new Set(['frontend', 'backend', 'database', 'infra', 'tooling', 'other']);
const STACK_MATURITY = new Set(['planned', 'in-use', 'deprecated']);
const MEMBER_ROLES = new Set(['owner', 'maintainer', 'contributor']);
const JOIN_REVIEW_ACTIONS = new Set(['accept', 'reject', 'need-info', 'request-more-info']);
const DISCUSSION_CATEGORIES = new Set(['idea', 'decision', 'question', 'blocked', 'retrospective']);
const DISCUSSION_STATUSES = new Set(['open', 'in-progress', 'resolved', 'closed']);
const UPDATE_TYPES = new Set(['milestone', 'devlog', 'release', 'blocker', 'weekly-summary']);
const REPO_MEMBER_ROLES = new Set(['read', 'write']);

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140);
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(values, maxItems = 20) {
  if (!Array.isArray(values)) return [];
  const unique = [];
  const seen = new Set();

  for (const item of values) {
    const value = asTrimmedString(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
    if (unique.length >= maxItems) break;
  }

  return unique;
}

function normalizeHttpLinks(values, maxItems = 10) {
  const links = normalizeStringArray(values, maxItems);
  return links.filter((link) => /^https?:\/\//i.test(link));
}

function isAllowedValue(value, allowedSet) {
  return allowedSet.has(value);
}

module.exports = {
  SPACE_STATUSES,
  SPACE_VISIBILITIES,
  STACK_CATEGORIES,
  STACK_MATURITY,
  MEMBER_ROLES,
  JOIN_REVIEW_ACTIONS,
  DISCUSSION_CATEGORIES,
  DISCUSSION_STATUSES,
  UPDATE_TYPES,
  REPO_MEMBER_ROLES,
  slugify,
  asTrimmedString,
  normalizeStringArray,
  normalizeHttpLinks,
  isAllowedValue,
};
