const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const MILESTONE_STATUSES = ['planned', 'active', 'completed', 'archived'];

const ProjectSpaceMilestone = sequelize.define(
  'ProjectSpaceMilestone',
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
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(180),
      allowNull: false,
      validate: {
        len: [3, 180],
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(...MILESTONE_STATUSES),
      allowNull: false,
      defaultValue: 'planned',
    },
    target_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
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
    tableName: 'project_space_milestones',
    timestamps: false,
    indexes: [
      { fields: ['space_id'] },
      { fields: ['created_by'] },
      { fields: ['status'] },
      { fields: ['target_date'] },
      { fields: ['position'] },
    ],
  }
);

module.exports = ProjectSpaceMilestone;
