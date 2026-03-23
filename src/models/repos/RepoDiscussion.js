const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const RepoDiscussion = sequelize.define('RepoDiscussion', {
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
  author_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
    onDelete: 'CASCADE',
  },
  category: {
    type: DataTypes.ENUM('general', 'q&a', 'ideas', 'show-and-tell'),
    defaultValue: 'general',
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  is_pinned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  is_answered: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  answer_comment_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
}, {
  tableName: 'repo_discussions',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    {
      fields: ['repo_id'],
    },
    {
      fields: ['author_id'],
    },
  ],
});

module.exports = RepoDiscussion;
