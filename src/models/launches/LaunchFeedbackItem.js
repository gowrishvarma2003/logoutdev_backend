const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LAUNCH_FEEDBACK_TYPES = ['suggestion', 'bug', 'idea'];
const LAUNCH_FEEDBACK_STATUSES = ['open', 'acknowledged', 'planned', 'resolved', 'closed'];
const LAUNCH_FEEDBACK_VISIBILITY_SCOPES = ['beta', 'public'];

const LaunchFeedbackItem = sequelize.define(
  'LaunchFeedbackItem',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    launch_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM(...LAUNCH_FEEDBACK_TYPES),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(140),
      allowNull: false,
      validate: {
        len: [3, 140],
      },
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 3000],
      },
    },
    status: {
      type: DataTypes.ENUM(...LAUNCH_FEEDBACK_STATUSES),
      allowNull: false,
      defaultValue: 'open',
    },
    visibility_scope: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'public',
      validate: {
        isIn: [LAUNCH_FEEDBACK_VISIBILITY_SCOPES],
      },
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
    tableName: 'launch_feedback_items',
    timestamps: false,
    indexes: [
      { fields: ['launch_id'] },
      { fields: ['author_id'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['visibility_scope'] },
    ],
  }
);

module.exports = LaunchFeedbackItem;
