const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ProjectSpaceIssueActivity = sequelize.define(
  'ProjectSpaceIssueActivity',
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
    issue_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    actor_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    event_type: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'project_space_issue_activities',
    timestamps: false,
    indexes: [
      { fields: ['space_id'] },
      { fields: ['issue_id'] },
      { fields: ['actor_user_id'] },
      { fields: ['event_type'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = ProjectSpaceIssueActivity;
