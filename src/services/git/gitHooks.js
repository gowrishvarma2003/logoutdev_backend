const fs = require('fs');
const path = require('path');

const PRE_RECEIVE_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
node "${path.resolve(__dirname, 'validatePush.js')}"
`;

async function ensureRepositoryHooks(repoPath) {
  const hooksDir = path.join(repoPath, 'hooks');
  await fs.promises.mkdir(hooksDir, { recursive: true });

  const preReceivePath = path.join(hooksDir, 'pre-receive');
  await fs.promises.writeFile(preReceivePath, PRE_RECEIVE_SCRIPT, { mode: 0o755 });
  await fs.promises.chmod(preReceivePath, 0o755);
}

module.exports = {
  ensureRepositoryHooks,
};
