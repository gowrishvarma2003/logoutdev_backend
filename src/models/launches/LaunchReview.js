const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LAUNCH_REVIEW_RECOMMENDATIONS = ['recommend', 'mixed', 'not_recommend'];

const LaunchReview = sequelize.define(
  'LaunchReview',
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
    headline: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        len: [3, 120],
      },
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [20, 2000],
      },
    },
    recommendation: {
      type: DataTypes.ENUM(...LAUNCH_REVIEW_RECOMMENDATIONS),
      allowNull: false,
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
    tableName: 'launch_reviews',
    timestamps: false,
    indexes: [
      { fields: ['launch_id'] },
      { fields: ['author_id'] },
      { unique: true, fields: ['launch_id', 'author_id'] },
    ],
  }
);

module.exports = LaunchReview;