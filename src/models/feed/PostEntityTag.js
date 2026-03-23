const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const PostEntityTag = sequelize.define(
  'PostEntityTag',
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
    entity_type: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    entity_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    display_name_snapshot: {
      type: DataTypes.STRING(200),
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
    tableName: 'post_entity_tags',
    timestamps: false,
    indexes: [
      { fields: ['post_id'] },
      { fields: ['entity_type', 'entity_id'] },
      { unique: true, fields: ['post_id', 'entity_type', 'entity_id'] },
    ],
  }
);

module.exports = PostEntityTag;
