const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  sequelize,
  ProjectSpaceIssue,
  ProjectSpaceRepo,
  ProjectSpaceRepoAttachment,
  ProjectSpaceRepoMember,
  ProjectSpaceUpdate,
  RepoStar,
  RepoWatch,
  RepoFork,
  RepoRelease,
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  BranchProtectionRule,
  RepoDiscussion,
  RepoDiscussionComment,
} = require('../../models');
const {
  getGitStorageRoot,
  getRepoPath,
  getLegacyRepoPath,
} = require('../git/gitPath');
const { deleteRepoFromR2 } = require('../git/r2Storage');

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertSafeRepoPath(repoPath, repoId) {
  const storageRoot = path.resolve(getGitStorageRoot());
  const resolvedPath = path.resolve(repoPath);
  const expectedName = `${repoId}.git`;

  if (!isPathInside(storageRoot, resolvedPath) || path.basename(resolvedPath) !== expectedName) {
    throw new Error('Refusing to delete an unexpected repository storage path.');
  }

  return resolvedPath;
}

async function removeLocalRepoPath(repoPath, repoId) {
  const safePath = assertSafeRepoPath(repoPath, repoId);
  await fs.promises.rm(safePath, { recursive: true, force: true });
}

function repoStoragePaths(repo) {
  const paths = [getRepoPath(repo.id)];
  if (repo.space_id) {
    paths.push(getLegacyRepoPath(repo.space_id, repo.id));
  }
  return [...new Set(paths.map((repoPath) => path.resolve(repoPath)))];
}

async function deleteRepositoryStorage(repo) {
  const paths = repoStoragePaths(repo);

  for (const repoPath of paths) {
    // eslint-disable-next-line no-await-in-loop
    await deleteRepoFromR2(repoPath);
    // eslint-disable-next-line no-await-in-loop
    await removeLocalRepoPath(repoPath, repo.id);
  }
}

async function deleteRepositoryData(repoId) {
  await sequelize.transaction(async (transaction) => {
    const pullRequests = await PullRequest.findAll({
      where: {
        [Op.or]: [
          { repo_id: repoId },
          { source_repo_id: repoId },
        ],
      },
      attributes: ['id'],
      transaction,
    });
    const pullRequestIds = pullRequests.map((pullRequest) => pullRequest.id);

    if (pullRequestIds.length > 0) {
      await PullRequestComment.destroy({
        where: { pull_request_id: { [Op.in]: pullRequestIds } },
        transaction,
      });
      await PullRequestReview.destroy({
        where: { pull_request_id: { [Op.in]: pullRequestIds } },
        transaction,
      });
      await PullRequest.destroy({
        where: { id: { [Op.in]: pullRequestIds } },
        transaction,
      });
    }

    const discussions = await RepoDiscussion.findAll({
      where: { repo_id: repoId },
      attributes: ['id'],
      transaction,
    });
    const discussionIds = discussions.map((discussion) => discussion.id);

    if (discussionIds.length > 0) {
      await RepoDiscussionComment.destroy({
        where: { discussion_id: { [Op.in]: discussionIds } },
        transaction,
      });
      await RepoDiscussion.destroy({
        where: { id: { [Op.in]: discussionIds } },
        transaction,
      });
    }

    await ProjectSpaceIssue.update(
      { repo_id: null, updated_at: new Date() },
      { where: { repo_id: repoId }, transaction }
    );
    await ProjectSpaceUpdate.update(
      { repo_id: null, updated_at: new Date() },
      { where: { repo_id: repoId }, transaction }
    );

    await Promise.all([
      ProjectSpaceRepoAttachment.destroy({ where: { repo_id: repoId }, transaction }),
      ProjectSpaceRepoMember.destroy({ where: { repo_id: repoId }, transaction }),
      RepoStar.destroy({ where: { repo_id: repoId }, transaction }),
      RepoWatch.destroy({ where: { repo_id: repoId }, transaction }),
      RepoFork.destroy({
        where: {
          [Op.or]: [
            { source_repo_id: repoId },
            { forked_repo_id: repoId },
          ],
        },
        transaction,
      }),
      RepoRelease.destroy({ where: { repo_id: repoId }, transaction }),
      BranchProtectionRule.destroy({ where: { repo_id: repoId }, transaction }),
    ]);

    await ProjectSpaceRepo.destroy({
      where: { id: repoId },
      transaction,
    });
  });
}

async function permanentlyDeleteRepository(repo) {
  await deleteRepositoryStorage(repo);
  await deleteRepositoryData(repo.id);
}

module.exports = {
  permanentlyDeleteRepository,
  _private: {
    assertSafeRepoPath,
    deleteRepositoryData,
    deleteRepositoryStorage,
    repoStoragePaths,
  },
};
