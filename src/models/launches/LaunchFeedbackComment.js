const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LaunchFeedbackComment = sequelize.define(
  'LaunchFeedbackComment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    feedback_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [3, 1500],
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
    tableName: 'launch_feedback_comments',
    timestamps: false,
    indexes: [{ fields: ['feedback_id'] }, { fields: ['author_id'] }],
  }
);

module.exports = LaunchFeedbackComment;