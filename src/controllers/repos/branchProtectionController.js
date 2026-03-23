const { BranchProtectionRule, User } = require('../../models');
const { getAuthenticatedUserId } = require('../../utils/requestUser');

exports.listBranchProtectionRules = async (req, res) => {
  try {
    const { repoId } = req.params;

    const rules = await BranchProtectionRule.findAll({
      where: { repo_id: repoId },
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name', 'username', 'github_url'],
        },
      ],
      order: [['created_at', 'ASC']],
    });

    res.json(rules);
  } catch (err) {
    console.error('Error listing branch protection rules:', err);
    res.status(500).json({ error: 'Failed to list branch protection rules' });
  }
};

exports.createBranchProtectionRule = async (req, res) => {
  try {
    const { repoId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const {
      branch_pattern,
      require_pr,
      required_approvals,
      dismiss_stale_reviews,
      require_status_checks,
      restrict_pushes,
      allow_force_push,
    } = req.body;

    if (!branch_pattern) {
      return res.status(400).json({ error: 'branch_pattern is required' });
    }

    const [rule, created] = await BranchProtectionRule.findOrCreate({
      where: { repo_id: repoId, branch_pattern },
      defaults: {
        require_pr: require_pr || false,
        required_approvals: required_approvals || 0,
        dismiss_stale_reviews: dismiss_stale_reviews || false,
        require_status_checks: require_status_checks || false,
        restrict_pushes: restrict_pushes || false,
        allow_force_push: allow_force_push || false,
        created_by: userId,
      },
    });

    if (!created) {
      // Update existing
      await rule.update({
        require_pr: require_pr ?? rule.require_pr,
        required_approvals: required_approvals ?? rule.required_approvals,
        dismiss_stale_reviews: dismiss_stale_reviews ?? rule.dismiss_stale_reviews,
        require_status_checks: require_status_checks ?? rule.require_status_checks,
        restrict_pushes: restrict_pushes ?? rule.restrict_pushes,
        allow_force_push: allow_force_push ?? rule.allow_force_push,
      });
    }

    res.json({ rule });
  } catch (err) {
    console.error('Error creating branch protection rule:', err);
    res.status(500).json({ error: 'Failed to save branch protection rule' });
  }
};

exports.deleteBranchProtectionRule = async (req, res) => {
  try {
    const { repoId, ruleId } = req.params;

    const rule = await BranchProtectionRule.findOne({
      where: { id: ruleId, repo_id: repoId },
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
};
