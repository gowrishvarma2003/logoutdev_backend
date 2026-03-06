const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PostLike = sequelize.define(
  'PostLike',
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
    tableName: 'post_likes',
    timestamps: false,
    indexes: [
      // Ensures a user can only like a post once
      { unique: true, fields: ['post_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

module.exports = PostLike;
