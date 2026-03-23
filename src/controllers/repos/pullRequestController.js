const { Op } = require('sequelize');
const { ProjectSpaceRepo, User, PullRequest, PullRequestReview, PullRequestComment } = require('../../models');
const { ensureRepoParentDirectory, getRepoPath } = require('../../services/git/gitPath');
const gitShell = require('../../services/git/gitShell');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

async function listPullRequests(req, res) {
  try {
    const { repoId } = req.params;
    const { state = 'open' } = req.query; // 'open', 'closed', 'all'

    const where = { repo_id: repoId };
    if (state === 'open') where.status = 'open';
    if (state === 'closed') where.status = { [Op.in]: ['merged', 'closed'] };

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const prs = await PullRequest.findAll({
      where,
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'], required: false }
      ],
      order: [['createdAt', 'DESC']],
    });

    res.json(prs.map(pr => {
      const prJson = pr.toJSON();
      const author = pr.author ? {
        ...pr.author.toJSON(),
        avatar_url: `${baseUrl}/api/users/${pr.author.id}/avatar`
      } : null;

      return {
        ...prJson,
        created_at: prJson.created_at || prJson.createdAt,
        updated_at: prJson.updated_at || prJson.updatedAt,
        author,
      };
    }));
  } catch (err) {
    console.error('List PRs Error:', err);
    res.status(500).json({ error: 'Failed to list pull requests.' });
  }
}

async function createPullRequest(req, res) {
  try {
    const { repoId } = req.params;
    const { title, body, source_branch, target_branch, is_draft } = req.body;
    const userId = getAuthenticatedUserId(req);

    if (!title || !source_branch || !target_branch) {
      return res.status(400).json({ error: 'Title, source_branch, and target_branch are required.' });
    }

    const repoPath = getRepoPath(repoId);

    // Verify branches exist and have diff
    const hasSource = await gitShell.repoHasCommits(repoPath, `refs/heads/${source_branch}`);
    const hasTarget = await gitShell.repoHasCommits(repoPath, `refs/heads/${target_branch}`);

    if (!hasSource || !hasTarget) {
      return res.status(400).json({ error: 'Source or target branch does not exist.' });
    }

    const pr = await PullRequest.create({
      repo_id: repoId,
      author_id: userId,
      title,
      body,
      source_branch,
      target_branch,
      is_draft: is_draft || false,
      status: 'open',
    });

    res.status(201).json(pr);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'A pull request for this branch combination may already exist.' });
    }
    console.error('Create PR Error:', err);
    res.status(500).json({ error: 'Failed to create pull request.' });
  }
}

async function getPullRequest(req, res) {
  try {
    const { repoId, number } = req.params;

    const pr = await PullRequest.findOne({
      where: { repo_id: repoId, number },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'email'] },
        { model: User, as: 'merger', attributes: ['id', 'name', 'username', 'email'] }
      ]
    });

    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = pr.toJSON();
    result.author.avatar_url = `${baseUrl}/api/users/${pr.author.id}/avatar`;
    if (result.merger) {
      result.merger.avatar_url = `${baseUrl}/api/users/${pr.merger.id}/avatar`;
    }

    // Try to count commits / diff
    const repoPath = getRepoPath(repoId);
    let diffStats = { additions: 0, deletions: 0, files_changed: 0 };
    let commitsCount = 0;

    try {
      if (pr.status === 'open') {
        const diffDesc = await gitShell.getDiffBetweenRefs(repoPath, pr.target_branch, pr.source_branch);
        diffStats = diffDesc.stats;
        
        const commits = await gitShell.listCommitsBetween(repoPath, pr.target_branch, pr.source_branch);
        commitsCount = commits.length;
      }
    } catch (e) {
      // Branches might be deleted
    }

    res.json({ ...result, stats: diffStats, commits_count: commitsCount });
  } catch (err) {
    console.error('Get PR Error:', err);
    res.status(500).json({ error: 'Failed to get pull request.' });
  }
}

async function updatePullRequest(req, res) {
  try {
    const { repoId, number } = req.params;
    const { title, body, is_draft } = req.body;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    // Allow owner or PR author to update
    // Simple check: author
    // If not author, usually need more robust permission system, ignoring for mvp
    
    if (title !== undefined) pr.title = title;
    if (body !== undefined) pr.body = body;
    if (is_draft !== undefined) pr.is_draft = is_draft;

    await pr.save();
    res.json(pr);
  } catch (err) {
    console.error('Update PR Error:', err);
    res.status(500).json({ error: 'Failed to update pull request.' });
  }
}

async function mergePullRequest(req, res) {
  try {
    const { repoId, number } = req.params;
    const { message } = req.body;
    const userId = getAuthenticatedUserId(req);

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    if (pr.status !== 'open') {
      return res.status(400).json({ error: 'Pull request is not open.' });
    }

    const repoPath = getRepoPath(repoId);
    
    // We execute the merge
    const user = req.user;
    const authorName = user.name || user.username || 'System';
    const authorEmail = user.email || 'system@logout.dev';

    await gitShell.mergeBranches(
      repoPath,
      pr.target_branch,
      pr.source_branch,
      { authorName, authorEmail, commitMessage: message || `Merge pull request #${number} from ${pr.source_branch}` }
    );

    pr.status = 'merged';
    pr.merged_by = userId;
    pr.merged_at = new Date();
    await pr.save();

    res.json(pr);
  } catch (err) {
    console.error('Merge PR Error:', err);
    res.status(400).json({ error: err.message || 'Merge failed.' });
  }
}

async function closePullRequest(req, res) {
  try {
    const { repoId, number } = req.params;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    if (pr.status !== 'open') {
      return res.status(400).json({ error: 'Pull request is not open.' });
    }

    pr.status = 'closed';
    pr.closed_at = new Date();
    await pr.save();

    res.json(pr);
  } catch (err) {
    console.error('Close PR Error:', err);
    res.status(500).json({ error: 'Failed to close pull request.' });
  }
}

async function reopenPullRequest(req, res) {
  try {
    const { repoId, number } = req.params;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    if (pr.status !== 'closed') {
      return res.status(400).json({ error: 'Pull request is not closed.' });
    }

    pr.status = 'open';
    pr.closed_at = null;
    await pr.save();

    res.json(pr);
  } catch (err) {
    console.error('Reopen PR Error:', err);
    res.status(500).json({ error: 'Failed to reopen pull request.' });
  }
}

async function getPullRequestDiff(req, res) {
  try {
    const { repoId, number } = req.params;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const repoPath = getRepoPath(repoId);
    
    // In a real system, if it's merged, we compare the merge base or the historical PR ref
    // For MVP, we'll try to diff target..source dynamically. If branches are deleted, it returns 400.
    const diff = await gitShell.getDiffBetweenRefs(repoPath, pr.target_branch, pr.source_branch);

    res.json(diff);
  } catch (err) {
    console.error('Get PR Diff Error:', err);
    res.status(400).json({ error: 'Failed to get diff. Branches might no longer exist.' });
  }
}

async function listPullRequestCommits(req, res) {
  try {
    const { repoId, number } = req.params;

    const pr = await PullRequest.findOne({ where: { repo_id: repoId, number } });
    if (!pr) return res.status(404).json({ error: 'Pull request not found.' });

    const repoPath = getRepoPath(repoId);
    
    // Same as diff, if branches are gone, this fails
    const commits = await gitShell.listCommitsBetween(repoPath, pr.target_branch, pr.source_branch);

    res.json(commits);
  } catch (err) {
    console.error('List PR Commits Error:', err);
    res.status(400).json({ error: 'Failed to list commits. Branches might no longer exist.' });
  }
}

module.exports = {
  listPullRequests,
  createPullRequest,
  getPullRequest,
  updatePullRequest,
  mergePullRequest,
  closePullRequest,
  reopenPullRequest,
  getPullRequestDiff,
  listPullRequestCommits,
};
