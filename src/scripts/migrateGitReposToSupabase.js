require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getGitStorageRoot } = require('../services/git/gitPath');
const {
  isGitSupabaseStorageEnabled,
  syncRepoToSupabase,
} = require('../services/git/gitSupabaseStorage');

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function findBareRepositories(baseDir) {
  if (!(await pathExists(baseDir))) {
    return [];
  }

  const found = [];

  async function walk(currentDir) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.name.endsWith('.git')) {
        found.push(fullPath);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await walk(fullPath);
    }
  }

  await walk(baseDir);
  return found;
}

async function main() {
  if (!isGitSupabaseStorageEnabled()) {
    throw new Error('Git Supabase storage is disabled. Set GIT_STORAGE_PROVIDER=supabase or FILE_STORAGE_PROVIDER=supabase.');
  }

  const storageRoot = getGitStorageRoot();
  const roots = [
    path.join(storageRoot, 'repos'),
    path.join(storageRoot, 'spaces'),
  ];

  const allRepos = [];
  for (const root of roots) {
    // eslint-disable-next-line no-await-in-loop
    const repos = await findBareRepositories(root);
    allRepos.push(...repos);
  }

  const uniqueRepos = Array.from(new Set(allRepos));
  if (uniqueRepos.length === 0) {
    console.log('No local bare repositories found for migration.');
    return;
  }

  let successCount = 0;
  const failures = [];

  for (const repoPath of uniqueRepos) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await syncRepoToSupabase(repoPath);
      successCount += 1;
      console.log(`Synced: ${repoPath} -> ${result.objectKey}`);
    } catch (error) {
      failures.push({ repoPath, error: error.message || String(error) });
      console.error(`Failed: ${repoPath} -> ${error.message || String(error)}`);
    }
  }

  console.log(`Done. Synced ${successCount}/${uniqueRepos.length} repositories.`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
