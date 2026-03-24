#!/usr/bin/env node

require('dotenv').config();

const { execFile } = require('child_process');
const { promisify } = require('util');
const { ProjectSpaceRepo, sequelize } = require('../../models');
const { getAccessContext, roleMeets } = require('../spaces/repoAccess');
const { getMatchingBranchProtectionRule } = require('../repos/repoGovernance');

const execFileAsync = promisify(execFile);
const ZERO_OID = '0000000000000000000000000000000000000000';

async function git(args) {
  return execFileAsync('git', args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
  });
}

function branchNameFromRef(refName) {
  return typeof refName === 'string' && refName.startsWith('refs/heads/')
    ? refName.slice('refs/heads/'.length)
    : null;
}

async function isFastForward(oldOid, newOid) {
  if (oldOid === ZERO_OID || newOid === ZERO_OID) return true;
  try {
    await git(['merge-base', '--is-ancestor', oldOid, newOid]);
    return true;
  } catch (error) {
    return false;
  }
}

async function hasMergeCommit(range) {
  if (!range) return false;
  const { stdout } = await git(['rev-list', '--parents', range]);
  return stdout
    .split('\n')
    .filter(Boolean)
    .some((line) => line.trim().split(/\s+/).length > 2);
}

async function main() {
  const repoId = process.env.LOGOUTDEV_REPO_ID;
  const actorId = process.env.LOGOUTDEV_ACTOR_ID;

  if (!repoId || !actorId) {
    process.exit(0);
  }

  const repo = await ProjectSpaceRepo.findByPk(repoId);
  if (!repo) {
    throw new Error('Repository not found for push validation.');
  }

  const access = await getAccessContext(repo, actorId);
  if (!access.permissions.can_push) {
    throw new Error('You do not have permission to push to this repository.');
  }

  const input = await new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });

  const updates = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [oldOid, newOid, refName] = line.split(/\s+/);
      return { oldOid, newOid, refName };
    });

  for (const update of updates) {
    const branchName = branchNameFromRef(update.refName);
    if (!branchName) continue;

    const rule = await getMatchingBranchProtectionRule(repoId, branchName);
    if (!rule) continue;

    if (rule.restrict_pushes && !access.effective_role) {
      throw new Error(`Pushes to ${branchName} are restricted.`);
    }

    if (rule.restrict_pushes && !roleMeets(access.effective_role, rule.push_role_min || 'maintain')) {
      throw new Error(`Pushes to ${branchName} require at least ${rule.push_role_min || 'maintain'} access.`);
    }

    if (update.newOid === ZERO_OID && !rule.allow_deletions) {
      throw new Error(`Deleting protected branch ${branchName} is not allowed.`);
    }

    if (update.newOid !== ZERO_OID && update.oldOid !== ZERO_OID && !rule.allow_force_push) {
      const fastForward = await isFastForward(update.oldOid, update.newOid);
      if (!fastForward) {
        throw new Error(`Force-pushes to protected branch ${branchName} are not allowed.`);
      }
    }

    if (rule.require_pr && update.newOid !== ZERO_OID) {
      throw new Error(`Direct pushes to protected branch ${branchName} are blocked. Open a pull request instead.`);
    }

    if (rule.require_linear_history && update.newOid !== ZERO_OID) {
      const range = update.oldOid === ZERO_OID ? update.newOid : `${update.oldOid}..${update.newOid}`;
      const containsMergeCommit = await hasMergeCommit(range);
      if (containsMergeCommit) {
        throw new Error(`Protected branch ${branchName} requires linear history.`);
      }
    }
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
