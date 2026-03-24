const { BranchProtectionRule, PullRequestReview, User } = require('../../models');
const { roleMeets } = require('../spaces/repoAccess');

function normalizeStatusContexts(value) {
  if (!Array.isArray(value)) return [];
  const unique = [];
  const seen = new Set();

  for (const entry of value) {
    const context = typeof entry === 'string' ? entry.trim() : '';
    if (!context) continue;
    const key = context.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(context);
  }

  return unique;
}

function escapePattern(pattern) {
  return pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
}

function branchPatternMatches(branchName, pattern) {
  if (!branchName || !pattern) return false;
  const regex = new RegExp(`^${escapePattern(pattern)}$`);
  return regex.test(branchName);
}

function serializeBranchProtectionRule(rule) {
  if (!rule) return null;
  const json = typeof rule.toJSON === 'function' ? rule.toJSON() : rule;
  return {
    ...json,
    required_status_contexts: normalizeStatusContexts(json.required_status_contexts),
    push_role_min: json.push_role_min || 'maintain',
    allow_deletions: Boolean(json.allow_deletions),
    require_linear_history: Boolean(json.require_linear_history),
  };
}

function sanitizeBranchProtectionInput(body = {}) {
  const requiredStatusContexts = normalizeStatusContexts(body.required_status_contexts);
  return {
    branch_pattern: typeof body.branch_pattern === 'string' ? body.branch_pattern.trim() : '',
    require_pr: Boolean(body.require_pr),
    required_approvals: Math.max(0, Number(body.required_approvals) || 0),
    dismiss_stale_reviews: Boolean(body.dismiss_stale_reviews),
    require_status_checks: Boolean(body.require_status_checks) || requiredStatusContexts.length > 0,
    required_status_contexts: requiredStatusContexts,
    restrict_pushes: Boolean(body.restrict_pushes),
    push_role_min: ['write', 'maintain', 'admin'].includes(body.push_role_min) ? body.push_role_min : 'maintain',
    allow_force_push: Boolean(body.allow_force_push),
    allow_deletions: Boolean(body.allow_deletions),
    require_linear_history: Boolean(body.require_linear_history),
  };
}

async function listBranchProtectionRulesForRepo(repoId) {
  const rules = await BranchProtectionRule.findAll({
    where: { repo_id: repoId },
    include: [
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'name', 'username', 'github_url'],
        required: false,
      },
    ],
    order: [['created_at', 'ASC']],
  });

  return rules.map(serializeBranchProtectionRule);
}

async function getMatchingBranchProtectionRule(repoId, branchName) {
  const rules = await listBranchProtectionRulesForRepo(repoId);
  const matching = rules.filter((rule) => branchPatternMatches(branchName, rule.branch_pattern));

  if (matching.length === 0) return null;

  matching.sort((left, right) => {
    if (left.branch_pattern === branchName && right.branch_pattern !== branchName) return -1;
    if (right.branch_pattern === branchName && left.branch_pattern !== branchName) return 1;
    return right.branch_pattern.length - left.branch_pattern.length;
  });

  return matching[0];
}

function buildReviewSummary(reviews, commits = [], dismissStaleReviews = false) {
  const latestCommitTime = commits.reduce((latest, commit) => {
    const authoredAt = new Date(commit.authored_at || commit.authoredAt || 0).getTime();
    return Number.isFinite(authoredAt) ? Math.max(latest, authoredAt) : latest;
  }, 0);

  const latestByReviewer = new Map();
  for (const review of reviews) {
    const reviewerId = review.reviewer_id;
    if (!reviewerId) continue;
    const existing = latestByReviewer.get(reviewerId);
    const reviewTime = new Date(
      review.submitted_at
      || review.updated_at
      || review.updatedAt
      || review.created_at
      || review.createdAt
      || 0
    ).getTime();
    if (!existing || reviewTime >= existing.reviewTime) {
      latestByReviewer.set(reviewerId, { review, reviewTime });
    }
  }

  const states = Array.from(latestByReviewer.values()).map(({ review, reviewTime }) => {
    const isStale = dismissStaleReviews && latestCommitTime > 0 && reviewTime > 0 && reviewTime < latestCommitTime;
    return {
      review,
      is_stale: isStale,
    };
  });

  const approvals = states.filter((entry) => entry.review.status === 'approved' && !entry.is_stale);
  const changesRequested = states.filter((entry) => entry.review.status === 'changes_requested' && !entry.is_stale);
  const commented = states.filter((entry) => entry.review.status === 'commented');

  return {
    approvals_count: approvals.length,
    changes_requested_count: changesRequested.length,
    commenters_count: commented.length,
    stale_reviews_count: states.filter((entry) => entry.is_stale).length,
    latest_by_reviewer: states.map(({ review, is_stale }) => ({
      reviewer_id: review.reviewer_id,
      reviewer: review.reviewer || null,
      status: review.status,
      submitted_at: review.submitted_at,
      is_stale,
    })),
  };
}

function evaluateStatusChecks(rule, providedContexts = []) {
  const required = normalizeStatusContexts(rule?.required_status_contexts);
  const provided = new Set(normalizeStatusContexts(providedContexts).map((item) => item.toLowerCase()));
  const pending = required.filter((context) => !provided.has(context.toLowerCase()));

  return {
    required,
    passed: required.filter((context) => provided.has(context.toLowerCase())),
    pending,
    satisfied: pending.length === 0,
  };
}

function evaluateDirectBranchUpdate({ rule, access, branchName, isDeletion = false }) {
  if (!rule) {
    return {
      allowed: access?.permissions.can_push === true,
      blocking_reasons: access?.permissions.can_push ? [] : ['Write access is required to update this branch.'],
    };
  }

  const blockingReasons = [];
  if (rule.restrict_pushes && !roleMeets(access?.effective_role, rule.push_role_min || 'maintain')) {
    blockingReasons.push(`Pushes to ${branchName} require ${rule.push_role_min || 'maintain'} access.`);
  }
  if (rule.require_pr && !isDeletion) {
    blockingReasons.push(`Direct updates to protected branch ${branchName} are blocked. Open a pull request instead.`);
  }
  if (isDeletion && !rule.allow_deletions) {
    blockingReasons.push(`Deleting protected branch ${branchName} is not allowed.`);
  }

  return {
    allowed: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
  };
}

function evaluateRuleForPullRequest({
  rule,
  reviews = [],
  commits = [],
  providedStatusContexts = [],
  actorRole = null,
  isDraft = false,
  mergeabilityState = 'clean',
  sourceBranchExists = true,
}) {
  const computedMergeabilityState = sourceBranchExists ? mergeabilityState : 'head_missing';

  if (!rule) {
    const blockingReasons = [];
    if (!sourceBranchExists) {
      blockingReasons.push('The source branch is no longer available.');
    }
    if (computedMergeabilityState === 'dirty') {
      blockingReasons.push('This pull request has merge conflicts.');
    }
    if (computedMergeabilityState === 'unknown') {
      blockingReasons.push('Mergeability could not be determined.');
    }
    if (isDraft) {
      blockingReasons.push('Draft pull requests cannot be merged.');
    }
    if (!roleMeets(actorRole, 'write')) {
      blockingReasons.push('Write access is required to merge this pull request.');
    }

    return {
      protected_branch: false,
      required_approvals: 0,
      review_summary: buildReviewSummary(reviews, commits, false),
      status_checks: evaluateStatusChecks(null, providedStatusContexts),
      source_branch_exists: sourceBranchExists,
      merge_allowed: blockingReasons.length === 0,
      mergeable_state: sourceBranchExists
        ? (isDraft ? 'draft' : computedMergeabilityState === 'clean' && roleMeets(actorRole, 'write') ? 'clean' : computedMergeabilityState === 'clean' ? 'blocked' : computedMergeabilityState)
        : 'head_missing',
      blocking_reasons: blockingReasons,
    };
  }

  const reviewSummary = buildReviewSummary(reviews, commits, Boolean(rule.dismiss_stale_reviews));
  const statusChecks = evaluateStatusChecks(rule, providedStatusContexts);
  const blockingReasons = [];

  if (!sourceBranchExists) {
    blockingReasons.push('The source branch is no longer available.');
  }
  if (isDraft) {
    blockingReasons.push('Draft pull requests cannot be merged.');
  }
  if (computedMergeabilityState === 'dirty') {
    blockingReasons.push('This pull request has merge conflicts.');
  }
  if (computedMergeabilityState === 'unknown') {
    blockingReasons.push('Mergeability could not be determined.');
  }
  if (!roleMeets(actorRole, 'maintain')) {
    blockingReasons.push('Maintainer access is required to merge into this protected branch.');
  }
  if (rule.require_pr !== true) {
    // Protected but not PR-only; still evaluate reviews/checks.
  }
  if (reviewSummary.changes_requested_count > 0) {
    blockingReasons.push('A reviewer has requested changes.');
  }
  if (reviewSummary.approvals_count < Number(rule.required_approvals || 0)) {
    blockingReasons.push(`At least ${Number(rule.required_approvals || 0)} approving review(s) are required.`);
  }
  if (rule.require_status_checks && !statusChecks.satisfied) {
    blockingReasons.push('Required status checks have not passed.');
  }

  return {
    protected_branch: true,
    required_approvals: Number(rule.required_approvals || 0),
    dismiss_stale_reviews: Boolean(rule.dismiss_stale_reviews),
    require_status_checks: Boolean(rule.require_status_checks),
    source_branch_exists: sourceBranchExists,
    review_summary: reviewSummary,
    status_checks: statusChecks,
    merge_allowed: blockingReasons.length === 0,
    mergeable_state: blockingReasons.length === 0 ? 'clean' : sourceBranchExists ? (isDraft ? 'draft' : computedMergeabilityState === 'clean' ? 'blocked' : computedMergeabilityState) : 'head_missing',
    blocking_reasons: blockingReasons,
  };
}

async function loadPullRequestReviews(pullRequestId) {
  return PullRequestReview.findAll({
    where: { pull_request_id: pullRequestId },
    include: [
      {
        model: User,
        as: 'reviewer',
        attributes: ['id', 'name', 'username', 'email'],
        required: false,
      },
    ],
    order: [['submitted_at', 'ASC'], ['createdAt', 'ASC']],
  });
}

module.exports = {
  normalizeStatusContexts,
  branchPatternMatches,
  serializeBranchProtectionRule,
  sanitizeBranchProtectionInput,
  listBranchProtectionRulesForRepo,
  getMatchingBranchProtectionRule,
  buildReviewSummary,
  evaluateStatusChecks,
  evaluateDirectBranchUpdate,
  evaluateRuleForPullRequest,
  loadPullRequestReviews,
};
