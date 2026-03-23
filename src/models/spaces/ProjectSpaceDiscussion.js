const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const DISCUSSION_CATEGORIES = ['idea', 'decision', 'question', 'blocked', 'retrospective', 'announcement'];
const DISCUSSION_STATUSES = ['open', 'in-progress', 'resolved', 'closed'];

const ProjectSpaceDiscussion = sequelize.define(
  'ProjectSpaceDiscussion',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    space_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(180),
      allowNull: false,
      validate: {
        len: [5, 180],
      },
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 10000],
      },
    },
    category: {
      type: DataTypes.ENUM(...DISCUSSION_CATEGORIES),
      allowNull: false,
      defaultValue: 'idea',
    },
    is_pinned: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    status: {
      type: DataTypes.ENUM(...DISCUSSION_STATUSES),
      allowNull: false,
      defaultValue: 'open',
    },
    decision_summary: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    answer_reply_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'project_space_discussions',
    timestamps: false,
    indexes: [
      { fields: ['space_id'] },
      { fields: ['author_id'] },
      { fields: ['category'] },
      { fields: ['status'] },
      { fields: ['is_pinned'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = ProjectSpaceDiscussion;
