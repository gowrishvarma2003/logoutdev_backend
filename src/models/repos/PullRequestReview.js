const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PullRequestReview = sequelize.define('PullRequestReview', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  pull_request_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'pull_requests',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  reviewer_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  status: {
    type: DataTypes.ENUM('approved', 'changes_requested', 'commented', 'pending'),
    defaultValue: 'pending',
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  submitted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'pr_reviews',
  timestamps: true,
});

module.exports = PullRequestReview;
