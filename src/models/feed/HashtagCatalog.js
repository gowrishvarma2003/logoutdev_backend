const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const HashtagCatalog = sequelize.define(
  'HashtagCatalog',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    normalized_tag: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    display_tag: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    usage_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    recent_post_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    unique_author_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    last_used_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: 'hashtag_catalog',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['normalized_tag'] },
      { fields: ['usage_count'] },
      { fields: ['last_used_at'] },
    ],
  }
);

module.exports = HashtagCatalog;
