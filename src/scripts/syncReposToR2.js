require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getGitStorageRoot } = require('../services/git/gitPath');
const { isR2Enabled, syncRepoToR2 } = require('../services/git/r2Storage');

async function findBareRepos(root) {
  const repos = [];

  async function walk(current) {
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (error) {
      return;
    }

    const names = new Set(entries.map((entry) => entry.name));
    if (current.endsWith('.git') && names.has('HEAD') && names.has('objects')) {
      repos.push(current);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await walk(path.join(current, entry.name));
    }
  }

  await walk(root);
  return repos;
}

async function main() {
  if (!isR2Enabled()) {
    throw new Error('R2 repo storage is not enabled. Set REPO_STORAGE_DRIVER=r2 and R2 credentials first.');
  }

  const root = getGitStorageRoot();
  const repos = await findBareRepos(root);

  for (const repoPath of repos) {
    process.stdout.write(`Syncing ${repoPath} ... `);
    await syncRepoToR2(repoPath);
    process.stdout.write('done\n');
  }

  process.stdout.write(`Synced ${repos.length} repositories to R2.\n`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
