const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PullRequestComment = sequelize.define('PullRequestComment', {
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
  review_id: {
    type: DataTypes.UUID,
    allowNull: true, // Null if it's a standalone PR comment not part of a formal review
    references: {
      model: 'pr_reviews',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  author_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  path: {
    type: DataTypes.STRING,
    allowNull: true, // Null if it's a general PR comment, not inline
  },
  position: {
    type: DataTypes.INTEGER,
    allowNull: true, // The line number in the diff
  },
  commit_id: {
    type: DataTypes.STRING,
    allowNull: true, // Specific commit the comment is tied to
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  is_resolved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  parent_comment_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'pr_comments',
      key: 'id',
    },
    onDelete: 'CASCADE', // If parent thread is deleted, delete replies
  },
}, {
  tableName: 'pr_comments',
  timestamps: true,
  indexes: [
    {
      fields: ['pull_request_id', 'path'],
    }
  ]
});

module.exports = PullRequestComment;
