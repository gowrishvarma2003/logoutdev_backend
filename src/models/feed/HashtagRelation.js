const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const HashtagRelation = sequelize.define(
  'HashtagRelation',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    tag: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    related_tag: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    cooccurrence_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    tableName: 'hashtag_relations',
    timestamps: false,
    indexes: [
      { fields: ['tag'] },
      { unique: true, fields: ['tag', 'related_tag'] },
    ],
  }
);

module.exports = HashtagRelation;
