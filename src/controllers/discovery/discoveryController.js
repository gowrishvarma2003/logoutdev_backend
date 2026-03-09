const { getDiscoveryResult } = require('../../services/discovery/discoveryService');

async function getDiscovery(req, res) {
  try {
    const payload = await getDiscoveryResult(req.query, req.user?.userId || null);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch discovery results.' });
  }
}

module.exports = {
  getDiscovery,
};