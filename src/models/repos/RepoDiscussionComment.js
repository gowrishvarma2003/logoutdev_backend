const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const RepoDiscussionComment = sequelize.define('RepoDiscussionComment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  discussion_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'repo_discussions',
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
    onDelete: 'CASCADE',
  },
  parent_comment_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'repo_discussion_comments',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
}, {
  tableName: 'repo_discussion_comments',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['discussion_id'],
    },
    {
      fields: ['parent_comment_id'],
    },
  ],
});

module.exports = RepoDiscussionComment;
