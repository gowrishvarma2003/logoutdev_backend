const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const BranchProtectionRule = sequelize.define('BranchProtectionRule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  repo_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'project_space_repos',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  branch_pattern: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'e.g. main, dev, release/*',
  },
  require_pr: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  required_approvals: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  dismiss_stale_reviews: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  require_status_checks: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  restrict_pushes: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  allow_force_push: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
}, {
  tableName: 'branch_protection_rules',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      unique: true,
      fields: ['repo_id', 'branch_pattern'],
    },
  ],
});

module.exports = BranchProtectionRule;
