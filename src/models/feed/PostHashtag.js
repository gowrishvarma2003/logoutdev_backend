const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PostHashtag = sequelize.define(
  'PostHashtag',
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
    // Stored lowercase for consistent grouping and trending queries
    tag: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
  },
  {
    tableName: 'post_hashtags',
    timestamps: false,
    indexes: [
      { fields: ['tag'] },
      { fields: ['post_id'] },
    ],
  }
);

module.exports = PostHashtag;
