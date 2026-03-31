const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const Post = sequelize.define(
  'Post',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Author of this post
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [1, 500],
      },
    },
    // True when this is a repost entry in the feed
    is_repost: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Points to the original post when is_repost = true
    original_post_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Points to parent post when this is a reply
    reply_to_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    linked_entity_type: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    linked_entity_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    is_poll: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    like_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    reply_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    repost_count: {
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
    tableName: 'posts',
    timestamps: false,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['created_at'] },
      { fields: ['reply_to_id'] },
      { fields: ['original_post_id'] },
      { fields: ['linked_entity_type', 'linked_entity_id'] },
    ],
  }
);

module.exports = Post;
