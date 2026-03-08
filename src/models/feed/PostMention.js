const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PostMention = sequelize.define(
  'PostMention',
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
    mentioned_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    username_snapshot: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    start_index: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    end_index: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: 'post_mentions',
    timestamps: false,
    indexes: [
      { fields: ['post_id'] },
      { fields: ['mentioned_user_id'] },
      { unique: true, fields: ['post_id', 'mentioned_user_id'] },
    ],
  }
);

module.exports = PostMention;
