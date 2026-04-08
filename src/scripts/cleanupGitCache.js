require('dotenv').config();

const {
  runGitCacheCleanupSweep,
  recoverDirtyRepos,
} = require('../services/git/gitCacheCleanupService');

async function main() {
  const args = new Set(process.argv.slice(2));
  const applyChanges = args.has('--apply');
  const runRecovery = args.has('--recover-dirty');

  if (runRecovery) {
    const recoverySummary = await recoverDirtyRepos();
    console.log('Dirty recovery summary:');
    console.log(JSON.stringify(recoverySummary, null, 2));
  }

  const summary = await runGitCacheCleanupSweep({
    reason: 'manual-script',
    dryRun: !applyChanges,
  });

  console.log('Cleanup summary:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
