const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const Follow = sequelize.define(
  'Follow',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // The user who is doing the following
    follower_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // The user being followed
    following_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'follows',
    timestamps: false,
    indexes: [
      // Ensures uniqueness — one follow relationship per pair
      { unique: true, fields: ['follower_id', 'following_id'] },
      { fields: ['following_id'] },
    ],
  }
);

module.exports = Follow;
