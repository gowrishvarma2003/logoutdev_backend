const { buildServiceAuthHeaders } = require('../internal/serviceAuth');

function getAgentApiBaseUrl() {
  return String(process.env.REPO_DOC_AGENT_API_URL || '').trim().replace(/\/$/, '');
}

function ensureAgentApiConfigured() {
  const baseUrl = getAgentApiBaseUrl();
  if (!baseUrl) {
    throw new Error('REPO_DOC_AGENT_API_URL is not configured.');
  }
  return baseUrl;
}

async function agentRequest(method, path, body = null) {
  const baseUrl = ensureAgentApiConfigured();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  const headers = {
    'Content-Type': 'application/json',
    ...buildServiceAuthHeaders({
      method,
      path: `${url.pathname}${url.search}`,
    }),
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = { error: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || `Agent API request failed with status ${response.status}.`);
  }

  return payload;
}

async function enqueueRepoDocJob(payload) {
  return agentRequest('POST', '/jobs/repo-doc', payload);
}

async function getRepoDocStatus(repoId) {
  return agentRequest('GET', `/repos/${encodeURIComponent(repoId)}/status`);
}

async function getRepoDocRuns(repoId) {
  return agentRequest('GET', `/repos/${encodeURIComponent(repoId)}/runs`);
}

async function regenerateRepoDoc(repoId, payload) {
  return agentRequest('POST', `/repos/${encodeURIComponent(repoId)}/regenerate`, payload);
}

module.exports = {
  getAgentApiBaseUrl,
  enqueueRepoDocJob,
  getRepoDocStatus,
  getRepoDocRuns,
  regenerateRepoDoc,
};
