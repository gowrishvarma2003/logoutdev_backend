const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const Repost = sequelize.define(
  'Repost',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    post_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    user_id: {
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
    tableName: 'reposts',
    timestamps: false,
    indexes: [
      // Ensures a user can only repost once per post
      { unique: true, fields: ['post_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

module.exports = Repost;
