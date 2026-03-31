const { Op } = require('sequelize');
const {
  sequelize,
  ProjectSpaceRepo,
  ProjectSpace,
  RepoFork,
  PullRequest,
  User,
} = require('../../models');
const {
  ensureRepoReadable,
  ensureRepoCapability,
  getAccessContext,
  roleMeets,
} = require('../../services/spaces/repoAccess');
const { resolveRepoPath } = require('../../services/git/gitPath');
const gitShell = require('../../services/git/gitShell');
const {
  getMatchingBranchProtectionRule,
  evaluateRuleForPullRequest,
  loadPullRequestReviews,
  normalizeStatusContexts,
} = require('../../services/repos/repoGovernance');
const { tryTriggerDefaultBranchRepoDocRefresh } = require('../../services/repos/repoDocRefresh');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

function buildAvatarUser(user, req) {
  if (!user) return null;
  const json = typeof user.toJSON === 'function' ? user.toJSON() : user;
  return {
    ...json,
    avatar_url: `${req.protocol}://${req.get('host')}/api/users/${json.id}/avatar`,
  };
}

function toPlainRepo(repo) {
  if (!repo) return null;
  return typeof repo.toJSON === 'function' ? repo.toJSON() : repo;
}

function buildRepoSummary(repo) {
  if (!repo) return null;
  const json = toPlainRepo(repo);
  return {
    id: json.id,
    name: json.name,
    slug: json.slug,
    owner_id: json.owner_id,
    default_branch: json.default_branch,
    visibility: json.visibility,
    owner: json.owner
      ? {
          id: json.owner.id,
          name: json.owner.name,
          username: json.owner.username,
        }
      : null,
    space: json.space
      ? {
          id: json.space.id,
          slug: json.space.slug,
          name: json.space.name,
        }
      : null,
  };
}

function getRepoNamespace(repo) {
  const json = toPlainRepo(repo);
  return json?.owner?.username || json?.space?.slug || json?.slug || 'repo';
}

function buildBranchLabel(repo, branch) {
  return `${getRepoNamespace(repo)}:${branch}`;
}

function getSyntheticHeadRef(headRepoId, headBranch, namespace = 'pr-sources') {
  return `refs/logoutdev/${namespace}/${headRepoId}/${headBranch}`;
}

async function loadRepoById(repoId) {
  return ProjectSpaceRepo.findByPk(repoId, {
    include: [
      { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
      { model: ProjectSpace, as: 'space', attributes: ['id', 'name', 'slug'], required: false },
    ],
  });
}

async function hydratePullRequestRepos(pr, fallbackTargetRepo = null) {
  const baseRepo = pr.repo || fallbackTargetRepo || (pr.repo_id ? await loadRepoById(pr.repo_id) : null);
  if (!baseRepo) {
    throw new Error('Base repository is not available for this pull request.');
  }

  let sourceRepo = pr.source_repo || null;
  if (!sourceRepo && pr.source_repo_id && pr.source_repo_id !== baseRepo.id) {
    sourceRepo = await loadRepoById(pr.source_repo_id);
  }

  return {
    baseRepo: toPlainRepo(baseRepo),
    sourceRepo: toPlainRepo(sourceRepo || baseRepo),
  };
}

function buildFallbackReviewSummary() {
  return {
    approvals_count: 0,
    changes_requested_count: 0,
    commenters_count: 0,
    stale_reviews_count: 0,
    latest_by_reviewer: [],
  };
}

function buildFallbackRuleEvaluation({ compareDetails, viewerAccess, isDraft }) {
  const sourceBranchExists = compareDetails?.source_branch_exists !== false;
  const mergeabilityState = sourceBranchExists
    ? (compareDetails?.mergeability_state || 'unknown')
    : 'head_missing';
  const blockingReasons = [];

  if (!sourceBranchExists) {
    blockingReasons.push('The source branch is no longer available.');
  }
  if (isDraft) {
    blockingReasons.push('Draft pull requests cannot be merged.');
  }
  if (mergeabilityState === 'dirty') {
    blockingReasons.push('This pull request has merge conflicts.');
  }
  if (mergeabilityState === 'unknown') {
    blockingReasons.push('Mergeability could not be determined.');
  }
  if (!viewerAccess?.permissions?.can_push) {
    blockingReasons.push('Write access is required to merge this pull request.');
  }

  return {
    protected_branch: false,
    required_approvals: 0,
    review_summary: buildFallbackReviewSummary(),
    status_checks: {
      required: [],
      passed: [],
      pending: [],
      satisfied: true,
    },
    source_branch_exists: sourceBranchExists,
    merge_allowed: blockingReasons.length === 0,
    mergeable_state: mergeabilityState === 'clean'
      ? (isDraft ? 'draft' : blockingReasons.length === 0 ? 'clean' : 'blocked')
      : mergeabilityState,
    blocking_reasons: blockingReasons,
  };
}

async function resolveCompareContext(baseRepo, headRepo, baseBranch, headBranch, namespace = 'compare') {
  const repoPath = await resolveRepoPath(baseRepo.id, baseRepo.space_id);
  const baseBranchExists = await gitShell.repoHasCommits(repoPath, `refs/heads/${baseBranch}`);

  if (headRepo.id === baseRepo.id) {
    const sourceBranchExists = await gitShell.repoHasCommits(repoPath, `refs/heads/${headBranch}`);
    return {
      repoPath,
      headRef: headBranch,
      base_branch_exists: baseBranchExists,
      source_branch_exists: sourceBranchExists,
    };
  }

  const sourceRepoPath = await resolveRepoPath(headRepo.id, headRepo.space_id);
  const sourceBranchExists = await gitShell.repoHasCommits(sourceRepoPath, `refs/heads/${headBranch}`);
  const headRef = getSyntheticHeadRef(headRepo.id, headBranch, namespace);

  if (sourceBranchExists) {
    await gitShell.fetchRefIntoRepo(
      repoPath,
      sourceRepoPath,
      `refs/heads/${headBranch}`,
      headRef
    );
  }

  return {
    repoPath,
    headRef,
    base_branch_exists: baseBranchExists,
    source_branch_exists: sourceBranchExists,
  };
}

async function buildCompareDetails({
  baseRepo,
  headRepo,
  baseBranch,
  headBranch,
  namespace = 'compare',
}) {
  const context = await resolveCompareContext(baseRepo, headRepo, baseBranch, headBranch, namespace);
  const response = {
    base_repo_id: baseRepo.id,
    base_branch: baseBranch,
    head_repo_id: headRepo.id,
    head_branch: headBranch,
    head_label: buildBranchLabel(headRepo, headBranch),
    base_label: buildBranchLabel(baseRepo, baseBranch),
    is_cross_repo: headRepo.id !== baseRepo.id,
    base_branch_exists: context.base_branch_exists,
    source_branch_exists: context.source_branch_exists,
    ahead_by: 0,
    behind_by: 0,
    commits: [],
    diff: {
      stats: { additions: 0, deletions: 0, files_changed: 0 },
      files: [],
    },
    mergeability_state: !context.source_branch_exists ? 'head_missing' : context.base_branch_exists ? 'unknown' : 'unknown',
    blocking_reasons: [],
  };

  if (!context.base_branch_exists) {
    response.blocking_reasons.push('The target branch does not exist.');
    return response;
  }

  if (!context.source_branch_exists) {
    response.mergeability_state = 'head_missing';
    response.blocking_reasons.push('The source branch is no longer available.');
    return response;
  }

  const [diff, commits, counts, mergeability] = await Promise.all([
    gitShell.getDiffBetweenRefs(context.repoPath, baseBranch, context.headRef),
    gitShell.listCommitsBetween(context.repoPath, baseBranch, context.headRef),
    gitShell.compareRefs(context.repoPath, baseBranch, context.headRef),
    gitShell.getMergeability(context.repoPath, `refs/heads/${baseBranch}`, context.headRef.startsWith('refs/') ? context.headRef : `refs/heads/${context.headRef}`),
  ]);

  response.diff = diff;
  response.commits = commits;
  response.ahead_by = counts.ahead_by;
  response.behind_by = counts.behind_by;
  response.mergeability_state = mergeability.state;

  if (mergeability.state === 'dirty') {
    response.blocking_reasons.push('This pull request has merge conflicts.');
  }
  if (mergeability.state === 'unknown') {
    response.blocking_reasons.push('Mergeability could not be determined.');
  }

  return response;
}

async function loadPullRequestOr404(repoId, number) {
  return PullRequest.findOne({
    where: { repo_id: repoId, number },
    include: [
      {
        model: ProjectSpaceRepo,
        as: 'repo',
        required: false,
        include: [
          { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
          { model: ProjectSpace, as: 'space', attributes: ['id', 'name', 'slug'], required: false },
        ],
      },
      {
        model: ProjectSpaceRepo,
        as: 'source_repo',
        required: false,
        include: [
          { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
          { model: ProjectSpace, as: 'space', attributes: ['id', 'name', 'slug'], required: false },
        ],
      },
      { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'], required: false },
      { model: User, as: 'merger', attributes: ['id', 'name', 'username', 'email'], required: false },
    ],
  });
}

async function allocatePullRequestNumber(repoId, transaction) {
  const lastPr = await PullRequest.findOne({
    where: { repo_id: repoId },
    order: [['number', 'DESC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  return lastPr ? lastPr.number + 1 : 1;
}

async function serializePullRequest(pr, req, targetRepo, viewerAccess) {
  const result = pr.toJSON();
  let baseRepo = toPlainRepo(targetRepo) || null;
  let sourceRepo = baseRepo;
  try {
    const hydrated = await hydratePullRequestRepos(pr, targetRepo);
    baseRepo = hydrated.baseRepo;
    sourceRepo = hydrated.sourceRepo;
  } catch (error) {
    baseRepo = baseRepo || {
      id: pr.repo_id,
      slug: result.repo?.slug || null,
      name: result.repo?.name || null,
      owner: result.repo?.owner || null,
      space: result.repo?.space || null,
      default_branch: result.repo?.default_branch || null,
      visibility: result.repo?.visibility || null,
    };
    sourceRepo = result.source_repo || (pr.source_repo_id && pr.source_repo_id !== baseRepo?.id
      ? {
          id: pr.source_repo_id,
          slug: null,
          name: null,
          owner: null,
          space: null,
          default_branch: null,
          visibility: null,
        }
      : baseRepo);
  }

  result.author = buildAvatarUser(pr.author, req);
  result.merger = buildAvatarUser(pr.merger, req);
  result.created_at = result.created_at || result.createdAt;
  result.updated_at = result.updated_at || result.updatedAt;

  let compareDetails;
  try {
    compareDetails = await buildCompareDetails({
      baseRepo,
      headRepo: sourceRepo,
      baseBranch: pr.target_branch,
      headBranch: pr.source_branch,
      namespace: 'pr-sources',
    });
  } catch (error) {
    compareDetails = {
      base_repo_id: baseRepo.id,
      base_branch: pr.target_branch,
      head_repo_id: sourceRepo?.id || pr.source_repo_id || baseRepo.id,
      head_branch: pr.source_branch,
      head_label: buildBranchLabel(sourceRepo, pr.source_branch),
      base_label: buildBranchLabel(baseRepo, pr.target_branch),
      is_cross_repo: (sourceRepo?.id || pr.source_repo_id || baseRepo.id) !== baseRepo.id,
      base_branch_exists: true,
      source_branch_exists: false,
      ahead_by: 0,
      behind_by: 0,
      commits: [],
      diff: {
        stats: { additions: 0, deletions: 0, files_changed: 0 },
        files: [],
      },
      mergeability_state: 'head_missing',
      blocking_reasons: ['The source branch is no longer available.'],
    };
  }

  let ruleEvaluation = buildFallbackRuleEvaluation({
    compareDetails,
    viewerAccess,
    isDraft: Boolean(pr.is_draft),
  });
  try {
    const rule = await getMatchingBranchProtectionRule(baseRepo.id, pr.target_branch);
    const reviews = await loadPullRequestReviews(pr.id);
    ruleEvaluation = evaluateRuleForPullRequest({
      rule,
      reviews,
      commits: compareDetails.commits,
      providedStatusContexts: result.status_checks,
      actorRole: viewerAccess?.effective_role || null,
      isDraft: Boolean(pr.is_draft),
      mergeabilityState: compareDetails.mergeability_state,
      sourceBranchExists: compareDetails.source_branch_exists,
    });
  } catch (error) {
    // Fall back to compare-only metadata so a PR can still be listed and opened.
  }

  const blockingReasons = Array.from(new Set([
    ...(compareDetails.blocking_reasons || []),
    ...(ruleEvaluation.blocking_reasons || []),
  ]));

  return {
    ...result,
    base_repo: buildRepoSummary(baseRepo),
    source_repo: buildRepoSummary(sourceRepo),
    is_cross_repo: sourceRepo.id !== baseRepo.id,
    source_branch_exists: compareDetails.source_branch_exists,
    head_label: compareDetails.head_label,
    base_label: compareDetails.base_label,
    compare_summary: {
      ahead_by: compareDetails.ahead_by,
      behind_by: compareDetails.behind_by,
      base_branch_exists: compareDetails.base_branch_exists,
      source_branch_exists: compareDetails.source_branch_exists,
    },
    stats: compareDetails.diff.stats,
    commits_count: compareDetails.commits.length,
    mergeable_state: ruleEvaluation.mergeable_state,
    review_summary: ruleEvaluation.review_summary,
    rule_evaluation: {
      ...ruleEvaluation,
      blocking_reasons: blockingReasons,
    },
    reviewer_eligibility: {
      can_review: Boolean(pr.status === 'open' && viewerAccess?.permissions.can_review),
      can_approve: Boolean(pr.status === 'open' && viewerAccess?.permissions.can_review && pr.author_id !== viewerAccess.user_id),
      can_request_changes: Boolean(pr.status === 'open' && viewerAccess?.permissions.can_review && pr.author_id !== viewerAccess.user_id),
    },
  };
}

async function listPullRequests(req, res) {
  try {
    const { repoId } = req.params;
    const { state = 'open' } = req.query;
    const readable = await ensureRepoReadable(repoId, req.user?.userId || null, res);
    if (!readable) return;

    const where = { repo_id: repoId };
    if (state === 'open') where.status = 'open';
    if (state === 'closed') where.status = { [Op.in]: ['merged', 'closed'] };

    const prs = await PullRequest.findAll({
      where,
      include: [
        {
          model: ProjectSpaceRepo,
          as: 'repo',
          required: false,
          include: [
            { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
            { model: ProjectSpace, as: 'space', attributes: ['id', 'name', 'slug'], required: false },
          ],
        },
        {
          model: ProjectSpaceRepo,
          as: 'source_repo',
          required: false,
          include: [
            { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
            { model: ProjectSpace, as: 'space', attributes: ['id', 'name', 'slug'], required: false },
          ],
        },
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'], required: false },
        { model: User, as: 'merger', attributes: ['id', 'name', 'username', 'email'], required: false },
      ],
      order: [['updatedAt', 'DESC'], ['createdAt', 'DESC']],
    });

    const serialized = [];
    for (const pr of prs) {
      // eslint-disable-next-line no-await-in-loop
      serialized.push(await serializePullRequest(pr, req, readable.repo, readable.access));
    }

    res.json(serialized);
  } catch (err) {
    console.error('List PRs Error:', err);
    res.status(500).json({ error: 'Failed to list pull requests.' });
  }
}

async function getPullRequestHeadOptions(req, res) {
  try {
    const baseReadable = await ensureRepoReadable(req.params.repoId, req.user.userId, res);
    if (!baseReadable) return;

    const options = [];
    const sameRepoAccess = await getAccessContext(baseReadable.repo, req.user.userId);
    if (sameRepoAccess.permissions.can_push) {
      const sameRepoPath = await resolveRepoPath(baseReadable.repo.id, baseReadable.repo.space_id);
      const branches = await gitShell.listBranches(sameRepoPath).catch(() => []);
      options.push({
        repo_id: baseReadable.repo.id,
        owner_username: getRepoNamespace(baseReadable.repo),
        repo_name: baseReadable.repo.name,
        is_same_repo: true,
        is_fork: false,
        default_branch: baseReadable.repo.default_branch,
        writable_branches: branches.map((branch) => branch.name),
      });
    }

    const forks = await RepoFork.findAll({
      where: {
        source_repo_id: baseReadable.repo.id,
        forked_by: req.user.userId,
      },
      include: [
        {
          model: ProjectSpaceRepo,
          as: 'forked_repo',
          required: true,
          where: { archived_at: null },
          include: [
            { model: User, as: 'owner', attributes: ['id', 'name', 'username'], required: false },
            { model: ProjectSpace, as: 'space', attributes: ['id', 'name', 'slug'], required: false },
          ],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    for (const fork of forks) {
      const forkRepo = fork.forked_repo;
      if (!forkRepo) continue;

      // eslint-disable-next-line no-await-in-loop
      const access = await getAccessContext(forkRepo, req.user.userId);
      if (!access.permissions.can_push) continue;

      // eslint-disable-next-line no-await-in-loop
      const forkRepoPath = await resolveRepoPath(forkRepo.id, forkRepo.space_id);
      // eslint-disable-next-line no-await-in-loop
      const branches = await gitShell.listBranches(forkRepoPath).catch(() => []);
      options.push({
        repo_id: forkRepo.id,
        owner_username: getRepoNamespace(forkRepo),
        repo_name: forkRepo.name,
        is_same_repo: false,
        is_fork: true,
        default_branch: forkRepo.default_branch,
        writable_branches: branches.map((branch) => branch.name),
      });
    }

    res.json({ options });
  } catch (error) {
    console.error('Get PR Head Options Error:', error);
    res.status(500).json({ error: 'Failed to load pull request head options.' });
  }
}

async function getPullRequestCompare(req, res) {
  try {
    const baseReadable = await ensureRepoReadable(req.params.repoId, req.user.userId, res);
    if (!baseReadable) return;

    const baseBranch = typeof req.query.base_branch === 'string' && req.query.base_branch.trim()
      ? req.query.base_branch.trim()
      : baseReadable.repo.default_branch;
    const headBranch = typeof req.query.head_branch === 'string' ? req.query.head_branch.trim() : '';
    const headRepoId = typeof req.query.head_repo_id === 'string' && req.query.head_repo_id.trim()
      ? req.query.head_repo_id.trim()
      : baseReadable.repo.id;

    if (!baseBranch || !headBranch) {
      return res.status(400).json({ error: 'base_branch and head_branch are required.' });
    }

    const headWritable = await ensureRepoCapability(headRepoId, req.user.userId, res, 'can_push');
    if (!headWritable) return;
    const headRepo = headWritable.repo;

    if (headRepo.id !== baseReadable.repo.id) {
      const forkRelation = await RepoFork.findOne({
        where: {
          source_repo_id: baseReadable.repo.id,
          forked_repo_id: headRepo.id,
        },
      });
      if (!forkRelation) {
        return res.status(400).json({ error: 'Cross-repo comparisons are only supported from repository forks.' });
      }
    }

    const compareDetails = await buildCompareDetails({
      baseRepo: baseReadable.repo,
      headRepo,
      baseBranch,
      headBranch,
      namespace: 'compare',
    });

    if (!compareDetails.base_branch_exists) {
      return res.status(400).json({ error: 'The target branch does not exist.' });
    }

    if (baseReadable.repo.id === headRepo.id && baseBranch === headBranch) {
      return res.status(400).json({ error: 'Base and compare branches must be different.' });
    }

    const existingPullRequest = await PullRequest.findOne({
      where: {
        repo_id: baseReadable.repo.id,
        source_repo_id: headRepo.id,
        source_branch: headBranch,
        target_branch: baseBranch,
        status: 'open',
      },
      attributes: ['id', 'number', 'title', 'status'],
      order: [['createdAt', 'DESC']],
    });

    res.json({
      ...compareDetails,
      existing_open_pull_request: existingPullRequest
        ? {
            id: existingPullRequest.id,
            number: existingPullRequest.number,
            title: existingPullRequest.title,
            status: existingPullRequest.status,
          }
        : null,
    });
  } catch (error) {
    console.error('Get PR Compare Error:', error);
    res.status(500).json({ error: 'Failed to compare pull request branches.' });
  }
}

async function createPullRequest(req, res) {
  try {
    const { repoId } = req.params;
    const targetReadable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!targetReadable) return;

    const { title, body, source_branch, target_branch, is_draft, source_repo_id } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!title || !source_branch || !target_branch) {
      return res.status(400).json({ error: 'Title, source_branch, and target_branch are required.' });
    }

    const sourceRepoId = source_repo_id || repoId;
    const sourceAccessResult = await ensureRepoCapability(sourceRepoId, userId, res, 'can_push');
    if (!sourceAccessResult) return;

    if (sourceRepoId === repoId) {
      if (!targetReadable.access.permissions.can_open_pr) {
        return res.status(403).json({ error: 'Write access is required to open pull requests from this repository.' });
      }
      if (source_branch === target_branch) {
        return res.status(400).json({ error: 'Base and compare branches must be different.' });
      }
    } else {
      const forkRelation = await RepoFork.findOne({
        where: {
          source_repo_id: repoId,
          forked_repo_id: sourceRepoId,
        },
      });

      if (!forkRelation) {
        return res.status(400).json({ error: 'Cross-repo pull requests are only supported from repository forks.' });
      }
    }

    const compareDetails = await buildCompareDetails({
      baseRepo: targetReadable.repo,
      headRepo: sourceAccessResult.repo,
      baseBranch: target_branch,
      headBranch: source_branch,
      namespace: 'create',
    });

    if (!compareDetails.base_branch_exists || !compareDetails.source_branch_exists) {
      return res.status(400).json({ error: 'Source or target branch does not exist.' });
    }

    const existing = await PullRequest.findOne({
      where: {
        repo_id: repoId,
        source_repo_id: sourceRepoId,
        source_branch,
        target_branch,
        status: 'open',
      },
    });
    if (existing) {
      return res.status(409).json({
        error: 'An open pull request already exists for this branch combination.',
        existing_open_pull_request: {
          id: existing.id,
          number: existing.number,
          title: existing.title,
          status: existing.status,
        },
      });
    }

    const createdPr = await sequelize.transaction(async (transaction) => {
      const nextNumber = await allocatePullRequestNumber(repoId, transaction);
      return PullRequest.create({
        repo_id: repoId,
        source_repo_id: sourceRepoId,
        number: nextNumber,
        author_id: userId,
        title: String(title).trim(),
        body,
        source_branch,
        target_branch,
        is_draft: Boolean(is_draft),
        status: 'open',
        status_checks: normalizeStatusContexts(req.body.status_checks),
      }, { transaction });
    });

    const reloaded = await loadPullRequestOr404(repoId, createdPr.number);
    return res.status(201).json(await serializePullRequest(reloaded, req, targetReadable.repo, targetReadable.access));
  } catch (err) {
    console.error('Create PR Error:', err);
    res.status(500).json({ error: 'Failed to create pull request.' });
  }
}

async function getPullRequest(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user?.userId || null, res);
    if (!readable) return;

    const pr = await loadPullRequestOr404(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    res.json(await serializePullRequest(pr, req, readable.repo, readable.access));
  } catch (err) {
    console.error('Get PR Error:', err);
    res.status(500).json({ error: 'Failed to get pull request.' });
  }
}

async function updatePullRequest(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const pr = await loadPullRequestOr404(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });
    if (pr.status === 'merged') {
      return res.status(400).json({ error: 'Merged pull requests cannot be edited.' });
    }

    const isAuthor = pr.author_id === req.user.userId;
    const isMaintainer = roleMeets(readable.access.effective_role, 'maintain');
    if (!isAuthor && !isMaintainer) {
      return res.status(403).json({ error: 'Not authorized to update this pull request.' });
    }

    if (req.body.title !== undefined) pr.title = String(req.body.title).trim();
    if (req.body.body !== undefined) pr.body = req.body.body;
    if (req.body.is_draft !== undefined) {
      if (pr.status !== 'open') {
        return res.status(400).json({ error: 'Only open pull requests can change draft status.' });
      }
      pr.is_draft = Boolean(req.body.is_draft);
    }
    if (req.body.status_checks !== undefined) {
      if (!readable.access.permissions.can_manage_rules) {
        return res.status(403).json({ error: 'Maintainer access is required to update pull request status checks.' });
      }
      pr.status_checks = normalizeStatusContexts(req.body.status_checks);
    }

    await pr.save();
    const reloaded = await loadPullRequestOr404(repoId, number);
    res.json(await serializePullRequest(reloaded, req, readable.repo, readable.access));
  } catch (err) {
    console.error('Update PR Error:', err);
    res.status(500).json({ error: 'Failed to update pull request.' });
  }
}

async function mergePullRequest(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const pr = await loadPullRequestOr404(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });
    if (pr.status !== 'open') {
      return res.status(400).json({ error: 'Pull request is not open.' });
    }

    const { baseRepo, sourceRepo } = await hydratePullRequestRepos(pr, readable.repo);
    const compareDetails = await buildCompareDetails({
      baseRepo,
      headRepo: sourceRepo,
      baseBranch: pr.target_branch,
      headBranch: pr.source_branch,
      namespace: 'pr-sources',
    });
    const reviews = await loadPullRequestReviews(pr.id);
    const rule = await getMatchingBranchProtectionRule(repoId, pr.target_branch);
    const evaluation = evaluateRuleForPullRequest({
      rule,
      reviews,
      commits: compareDetails.commits,
      providedStatusContexts: pr.status_checks,
      actorRole: readable.access.effective_role,
      isDraft: Boolean(pr.is_draft),
      mergeabilityState: compareDetails.mergeability_state,
      sourceBranchExists: compareDetails.source_branch_exists,
    });

    if (!evaluation.merge_allowed) {
      return res.status(409).json({
        error: evaluation.blocking_reasons[0] || 'This pull request cannot be merged.',
        mergeable_state: evaluation.mergeable_state,
        review_summary: evaluation.review_summary,
        rule_evaluation: evaluation,
      });
    }

    const user = req.user;
    const authorName = user.name || user.username || 'System';
    const authorEmail = user.email || 'system@logout.dev';
    const mergeCommitOid = await gitShell.mergeBranches(
      compareDetails.is_cross_repo ? await resolveRepoPath(baseRepo.id, baseRepo.space_id) : await resolveRepoPath(readable.repo.id, readable.repo.space_id),
      pr.target_branch,
      compareDetails.is_cross_repo ? getSyntheticHeadRef(sourceRepo.id, pr.source_branch, 'pr-sources') : pr.source_branch,
      {
        authorName,
        authorEmail,
        commitMessage: req.body?.message || `Merge pull request #${number} from ${buildBranchLabel(sourceRepo, pr.source_branch)}`,
      }
    );

    pr.status = 'merged';
    pr.merged_by = req.user.userId;
    pr.merged_at = new Date();
    await pr.save();

    await tryTriggerDefaultBranchRepoDocRefresh({
      repo: baseRepo,
      branchName: pr.target_branch,
      sourceCommit: mergeCommitOid,
      trigger: 'default_branch_updated',
      requestedByUserId: req.user.userId,
      requestedByUsername: req.user.username || req.user.name || null,
    });

    const reloaded = await loadPullRequestOr404(repoId, number);
    res.json(await serializePullRequest(reloaded, req, readable.repo, readable.access));
  } catch (err) {
    console.error('Merge PR Error:', err);
    res.status(400).json({ error: err.message || 'Merge failed.' });
  }
}

async function closePullRequest(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const pr = await loadPullRequestOr404(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });
    if (pr.status !== 'open') {
      return res.status(400).json({ error: 'Pull request is not open.' });
    }

    const isAuthor = pr.author_id === req.user.userId;
    const isMaintainer = roleMeets(readable.access.effective_role, 'maintain');
    if (!isAuthor && !isMaintainer) {
      return res.status(403).json({ error: 'Not authorized to close this pull request.' });
    }

    pr.status = 'closed';
    pr.closed_at = new Date();
    await pr.save();

    const reloaded = await loadPullRequestOr404(repoId, number);
    res.json(await serializePullRequest(reloaded, req, readable.repo, readable.access));
  } catch (err) {
    console.error('Close PR Error:', err);
    res.status(500).json({ error: 'Failed to close pull request.' });
  }
}

async function reopenPullRequest(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user.userId, res);
    if (!readable) return;

    const pr = await loadPullRequestOr404(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });
    if (pr.status !== 'closed') {
      return res.status(400).json({ error: 'Pull request is not closed.' });
    }

    const isAuthor = pr.author_id === req.user.userId;
    const isMaintainer = roleMeets(readable.access.effective_role, 'maintain');
    if (!isAuthor && !isMaintainer) {
      return res.status(403).json({ error: 'Not authorized to reopen this pull request.' });
    }

    pr.status = 'open';
    pr.closed_at = null;
    await pr.save();

    const reloaded = await loadPullRequestOr404(repoId, number);
    res.json(await serializePullRequest(reloaded, req, readable.repo, readable.access));
  } catch (err) {
    console.error('Reopen PR Error:', err);
    res.status(500).json({ error: 'Failed to reopen pull request.' });
  }
}

async function getPullRequestDiff(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user?.userId || null, res);
    if (!readable) return;

    const pr = await loadPullRequestOr404(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const { baseRepo, sourceRepo } = await hydratePullRequestRepos(pr, readable.repo);
    const compareDetails = await buildCompareDetails({
      baseRepo,
      headRepo: sourceRepo,
      baseBranch: pr.target_branch,
      headBranch: pr.source_branch,
      namespace: 'pr-sources',
    });

    res.json(compareDetails.diff);
  } catch (err) {
    console.error('Get PR Diff Error:', err);
    res.status(400).json({ error: 'Failed to get diff. Branches might no longer exist.' });
  }
}

async function listPullRequestCommits(req, res) {
  try {
    const { repoId, number } = req.params;
    const readable = await ensureRepoReadable(repoId, req.user?.userId || null, res);
    if (!readable) return;

    const pr = await loadPullRequestOr404(repoId, number);
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const { baseRepo, sourceRepo } = await hydratePullRequestRepos(pr, readable.repo);
    const compareDetails = await buildCompareDetails({
      baseRepo,
      headRepo: sourceRepo,
      baseBranch: pr.target_branch,
      headBranch: pr.source_branch,
      namespace: 'pr-sources',
    });

    res.json(compareDetails.commits);
  } catch (err) {
    console.error('List PR Commits Error:', err);
    res.status(400).json({ error: 'Failed to list commits. Branches might no longer exist.' });
  }
}

module.exports = {
  listPullRequests,
  getPullRequestHeadOptions,
  getPullRequestCompare,
  createPullRequest,
  getPullRequest,
  updatePullRequest,
  mergePullRequest,
  closePullRequest,
  reopenPullRequest,
  getPullRequestDiff,
  listPullRequestCommits,
  _private: {
    buildRepoSummary,
    getRepoNamespace,
    buildBranchLabel,
    toPlainRepo,
  },
};
