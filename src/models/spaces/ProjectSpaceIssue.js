const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ISSUE_STATUSES = ['open', 'triaged', 'in-progress', 'resolved', 'closed'];
const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'critical'];

const ProjectSpaceIssue = sequelize.define(
  'ProjectSpaceIssue',
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
    status: {
      type: DataTypes.ENUM(...ISSUE_STATUSES),
      allowNull: false,
      defaultValue: 'open',
    },
    priority: {
      type: DataTypes.ENUM(...ISSUE_PRIORITIES),
      allowNull: false,
      defaultValue: 'medium',
    },
    assignee_user_id: {
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
    tableName: 'project_space_issues',
    timestamps: false,
    indexes: [
      { fields: ['space_id'] },
      { fields: ['author_id'] },
      { fields: ['assignee_user_id'] },
      { fields: ['status'] },
      { fields: ['priority'] },
      { fields: ['created_at'] },
      { fields: ['updated_at'] },
    ],
  }
);

module.exports = ProjectSpaceIssue;
