const AGENT_BRANCH_NAME = 'logoutdev/ai-docs';
const AGENT_ARTIFACT_ROOT = '.logoutdev';

function validateAgentBranchName(name) {
  return String(name || '').trim() === AGENT_BRANCH_NAME;
}

function normalizeInternalPath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function isAllowedAgentArtifactPath(filePath) {
  const normalizedPath = normalizeInternalPath(filePath);
  return normalizedPath.startsWith(`${AGENT_ARTIFACT_ROOT}/`) && !normalizedPath.includes('..');
}

module.exports = {
  AGENT_BRANCH_NAME,
  AGENT_ARTIFACT_ROOT,
  validateAgentBranchName,
  normalizeInternalPath,
  isAllowedAgentArtifactPath,
};
