const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const UPDATE_TYPES = ['milestone', 'devlog', 'release', 'blocker', 'weekly-summary'];

const ProjectSpaceUpdate = sequelize.define(
  'ProjectSpaceUpdate',
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
    type: {
      type: DataTypes.ENUM(...UPDATE_TYPES),
      allowNull: false,
      defaultValue: 'devlog',
    },
    title: {
      type: DataTypes.STRING(180),
      allowNull: false,
      validate: {
        len: [5, 180],
      },
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 15000],
      },
    },
    what_shipped: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    next_up: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    blockers: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    evidence_links: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
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
    tableName: 'project_space_updates',
    timestamps: false,
    indexes: [{ fields: ['space_id'] }, { fields: ['author_id'] }, { fields: ['type'] }, { fields: ['created_at'] }],
  }
);

module.exports = ProjectSpaceUpdate;
