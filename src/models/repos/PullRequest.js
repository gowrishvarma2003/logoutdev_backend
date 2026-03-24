const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PullRequest = sequelize.define('PullRequest', {
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
  source_repo_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'project_space_repos',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    // Note: We'll need a hook or transaction logic to auto-increment this per repo
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  author_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  source_branch: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  target_branch: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('open', 'merged', 'closed'),
    defaultValue: 'open',
  },
  is_draft: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  status_checks: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  },
  merged_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  merged_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'pull_requests',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['repo_id', 'number'],
    },
    {
      fields: ['repo_id', 'status'],
    },
    {
      fields: ['source_repo_id'],
    }
  ],
});

module.exports = PullRequest;
