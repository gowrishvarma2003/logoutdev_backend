const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ISSUE_STATUSES = ['open', 'triaged', 'in-progress', 'resolved', 'closed'];
const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const WORK_TYPES = ['task', 'bug', 'feature', 'docs', 'research'];

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
    type: {
      type: DataTypes.ENUM(...WORK_TYPES),
      allowNull: false,
      defaultValue: 'task',
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
    repo_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    milestone_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    good_first_task: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    help_wanted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    blocked_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    close_reason: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    estimate: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    target_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    needed_skill: {
      type: DataTypes.STRING(120),
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
      { fields: ['repo_id'] },
      { fields: ['status'] },
      { fields: ['priority'] },
      { fields: ['type'] },
      { fields: ['milestone_id'] },
      { fields: ['good_first_task'] },
      { fields: ['help_wanted'] },
      { fields: ['target_date'] },
      { fields: ['created_at'] },
      { fields: ['updated_at'] },
    ],
  }
);

module.exports = ProjectSpaceIssue;
