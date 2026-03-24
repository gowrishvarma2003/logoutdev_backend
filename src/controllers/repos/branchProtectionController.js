const { BranchProtectionRule, User } = require('../../models');
const { ensureRepoReadable, ensureRepoCapability } = require('../../services/spaces/repoAccess');
const {
  listBranchProtectionRulesForRepo,
  sanitizeBranchProtectionInput,
  serializeBranchProtectionRule,
} = require('../../services/repos/repoGovernance');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

async function listBranchProtectionRules(req, res) {
  try {
    const readable = await ensureRepoReadable(req.params.repoId, req.user?.userId || null, res);
    if (!readable) return;

    const rules = await listBranchProtectionRulesForRepo(req.params.repoId);
    res.json(rules);
  } catch (err) {
    console.error('Error listing branch protection rules:', err);
    res.status(500).json({ error: 'Failed to list branch protection rules' });
  }
}

async function createBranchProtectionRule(req, res) {
  try {
    const manageable = await ensureRepoCapability(req.params.repoId, req.user.userId, res, 'can_manage_rules');
    if (!manageable) return;

    const payload = sanitizeBranchProtectionInput(req.body);
    if (!payload.branch_pattern) {
      return res.status(400).json({ error: 'branch_pattern is required' });
    }

    const [rule, created] = await BranchProtectionRule.findOrCreate({
      where: { repo_id: req.params.repoId, branch_pattern: payload.branch_pattern },
      defaults: {
        ...payload,
        created_by: getAuthenticatedUserId(req),
      },
    });

    if (!created) {
      await rule.update({
        ...payload,
      });
    }

    const reloaded = await BranchProtectionRule.findByPk(rule.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'name', 'username', 'github_url'], required: false }],
    });

    res.json({ rule: serializeBranchProtectionRule(reloaded) });
  } catch (err) {
    console.error('Error creating branch protection rule:', err);
    res.status(500).json({ error: 'Failed to save branch protection rule' });
  }
}

async function deleteBranchProtectionRule(req, res) {
  try {
    const manageable = await ensureRepoCapability(req.params.repoId, req.user.userId, res, 'can_manage_rules');
    if (!manageable) return;

    const rule = await BranchProtectionRule.findOne({
      where: { id: req.params.ruleId, repo_id: req.params.repoId },
    });
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    await rule.destroy();
    res.json({ message: 'Branch protection rule deleted' });
  } catch (err) {
    console.error('Error deleting branch protection rule:', err);
    res.status(500).json({ error: 'Failed to delete branch protection rule' });
  }
}

module.exports = {
  listBranchProtectionRules,
  createBranchProtectionRule,
  deleteBranchProtectionRule,
};
