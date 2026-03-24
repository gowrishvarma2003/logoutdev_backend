const { Op } = require('sequelize');
const {
  ProjectSpaceMember,
  ProjectSpaceRepoMember,
  PullRequest,
  PullRequestReview,
  RepoFork,
  RepoStar,
  RepoWatch,
  User,
} = require('../../models');
const { ensureRepoReadable, ensureRepoCapability, getAccessContext, maxRole } = require('../../services/spaces/repoAccess');
const { resolveRepoPath } = require('../../services/git/gitPath');
const { listCommits } = require('../../services/git/gitShell');

function userSummary(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
  };
}

async function buildCollaborators(repo) {
  const directMemberUserIds = await ProjectSpaceRepoMember.findAll({
    where: { repo_id: repo.id },
    attributes: ['user_id', 'role', 'id', 'granted_by', 'created_at'],
    raw: true,
  });
  const membershipLookup = repo.space_id && directMemberUserIds.length > 0
    ? await ProjectSpaceMember.findAll({
        where: {
          space_id: repo.space_id,
          user_id: { [Op.in]: directMemberUserIds.map((member) => member.user_id) },
        },
        attributes: ['user_id', 'role'],
        raw: true,
      })
    : [];
  const membershipByUserId = new Map(membershipLookup.map((membership) => [membership.user_id, membership]));
  const directMembers = await ProjectSpaceRepoMember.findAll({
    where: { repo_id: repo.id },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'username'], required: false }],
    order: [['created_at', 'ASC']],
  });

  const directByUserId = new Map(
    directMembers.map((member) => [
      member.user_id,
      {
        id: member.id,
        user_id: member.user_id,
        user: userSummary(member.user),
        role: member.role,
        direct_role: member.role,
        inherited_role: null,
        effective_role: member.role,
        source: repo.space_id
          ? (membershipByUserId.has(member.user_id) ? 'space_member_direct_grant' : 'outside_collaborator')
          : 'direct_collaborator',
        granted_by: member.granted_by,
        created_at: member.created_at,
        is_outside_collaborator: Boolean(repo.space_id && !membershipByUserId.has(member.user_id)),
      },
    ])
  );

  if (repo.space_id) {
    const spaceMembers = await ProjectSpaceMember.findAll({
      where: {
        space_id: repo.space_id,
        role: { [Op.in]: ['owner', 'maintainer'] },
      },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'username'], required: false }],
      order: [['joined_at', 'ASC']],
    });

    for (const member of spaceMembers) {
      const inheritedRole = member.role === 'owner' ? 'admin' : 'maintain';
      const existing = directByUserId.get(member.user_id);

      directByUserId.set(member.user_id, {
        id: existing?.id || `inherited:${member.user_id}`,
        user_id: member.user_id,
        user: existing?.user || userSummary(member.user),
        role: maxRole(existing?.direct_role || null, inheritedRole),
        direct_role: existing?.direct_role || null,
        inherited_role: inheritedRole,
        effective_role: maxRole(existing?.direct_role || null, inheritedRole),
        source: member.role === 'owner' ? 'space_owner' : 'space_maintainer',
        granted_by: existing?.granted_by || null,
        created_at: existing?.created_at || member.joined_at,
        is_outside_collaborator: false,
      });
    }
  }

  if (!directByUserId.has(repo.owner_id) && repo.owner) {
    directByUserId.set(repo.owner_id, {
      id: `owner:${repo.owner_id}`,
      user_id: repo.owner_id,
      user: userSummary(repo.owner),
      role: 'admin',
      direct_role: null,
      inherited_role: 'admin',
      effective_role: 'admin',
      source: 'repo_owner',
      granted_by: null,
      created_at: repo.created_at,
      is_outside_collaborator: false,
    });
  }

  return Array.from(directByUserId.values()).sort((left, right) => {
    if (left.source === 'repo_owner') return -1;
    if (right.source === 'repo_owner') return 1;
    return (left.user?.username || left.user?.name || '').localeCompare(right.user?.username || right.user?.name || '');
  });
}

function summarizeCommitActivity(commits) {
  const perDay = new Map();
  const contributors = new Map();

  for (const commit of commits) {
    const day = String(commit.authored_at || '').slice(0, 10);
    if (day) {
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }

    const key = `${commit.author_email}::${commit.author_name}`;
    const current = contributors.get(key) || {
      author_name: commit.author_name,
      author_email: commit.author_email,
      commit_count: 0,
      latest_commit_at: commit.authored_at,
    };
    current.commit_count += 1;
    current.latest_commit_at = commit.authored_at > current.latest_commit_at ? commit.authored_at : current.latest_commit_at;
    contributors.set(key, current);
  }

  return {
    commit_activity: Array.from(perDay.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, count]) => ({ date, count })),
    contributors: Array.from(contributors.values())
      .sort((left, right) => right.commit_count - left.commit_count)
      .slice(0, 10),
  };
}

async function getRepoAccessOverview(req, res) {
  try {
    const readable = await ensureRepoReadable(req.params.repoId, req.user?.userId || null, res);
    if (!readable) return;

    const collaborators = await buildCollaborators(readable.repo);
    res.json({
      access: {
        user_id: readable.access.user_id,
        repo_id: readable.access.repo_id,
        effective_role: readable.access.effective_role,
        direct_role: readable.access.direct_role,
        inherited_role: readable.access.inherited_role,
        is_outside_collaborator: readable.access.is_outside_collaborator,
        permissions: readable.access.permissions,
      },
      collaborators,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load repository access.' });
  }
}

async function searchCollaborators(req, res) {
  try {
    const manageable = await ensureRepoCapability(req.params.repoId, req.user.userId, res, 'can_manage_access');
    if (!manageable) return;

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.json({ users: [] });
    }

    const users = await User.findAll({
      where: {
        [Op.or]: [
          { username: { [Op.iLike]: `%${q}%` } },
          { name: { [Op.iLike]: `%${q}%` } },
          { email: { [Op.iLike]: `%${q}%` } },
        ],
      },
      attributes: ['id', 'name', 'email', 'username'],
      limit: 12,
      order: [['username', 'ASC']],
    });

    const enriched = [];
    for (const user of users) {
      // eslint-disable-next-line no-await-in-loop
      const access = await getAccessContext(manageable.repo, user.id);
      enriched.push({
        ...userSummary(user),
        effective_role: access.effective_role,
        inherited_role: access.inherited_role,
        direct_role: access.direct_role,
        is_outside_collaborator: access.is_outside_collaborator,
      });
    }

    res.json({ users: enriched });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search users.' });
  }
}

async function getRepoInsights(req, res) {
  try {
    const readable = await ensureRepoReadable(req.params.repoId, req.user?.userId || null, res);
    if (!readable) return;

    const [stars, watchers, forks, pullRequests, reviews, collaborators] = await Promise.all([
      RepoStar.count({ where: { repo_id: readable.repo.id } }),
      RepoWatch.count({ where: { repo_id: readable.repo.id } }),
      RepoFork.count({ where: { source_repo_id: readable.repo.id } }),
      PullRequest.findAll({
        where: { repo_id: readable.repo.id },
        attributes: ['id', 'status', 'created_at', 'updated_at', 'author_id'],
      }),
      PullRequestReview.findAll({
        include: [
          {
            model: PullRequest,
            as: 'pull_request',
            where: { repo_id: readable.repo.id },
            attributes: ['id'],
            required: true,
          },
        ],
        attributes: ['id', 'reviewer_id', 'status', 'submitted_at'],
      }),
      buildCollaborators(readable.repo),
    ]);

    let commits = [];
    try {
      const repoPath = await resolveRepoPath(readable.repo.id, readable.repo.space_id);
      commits = await listCommits(repoPath, readable.repo.default_branch, '', 1, 200);
    } catch (error) {
      commits = [];
    }

    const commitSummary = summarizeCommitActivity(commits);
    const reviewMap = new Map();
    for (const review of reviews) {
      const current = reviewMap.get(review.reviewer_id) || {
        reviewer_id: review.reviewer_id,
        review_count: 0,
        approvals: 0,
      };
      current.review_count += 1;
      if (review.status === 'approved') current.approvals += 1;
      reviewMap.set(review.reviewer_id, current);
    }

    res.json({
      summary: {
        stars,
        watchers,
        forks,
        pull_requests_total: pullRequests.length,
        open_pull_requests: pullRequests.filter((pullRequest) => pullRequest.status === 'open').length,
        merged_pull_requests: pullRequests.filter((pullRequest) => pullRequest.status === 'merged').length,
        collaborator_count: collaborators.length,
        commit_count: commits.length,
      },
      contributors: commitSummary.contributors,
      commit_activity: commitSummary.commit_activity,
      maintainers: collaborators.filter((collaborator) => ['maintain', 'admin'].includes(collaborator.effective_role)),
      reviewers: Array.from(reviewMap.values()).sort((left, right) => right.review_count - left.review_count),
      collaborators,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load repository insights.' });
  }
}

module.exports = {
  getRepoAccessOverview,
  searchCollaborators,
  getRepoInsights,
};
