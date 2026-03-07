const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const QuestionTag = sequelize.define(
  'QuestionTag',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    question_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    tag_type: {
      type: DataTypes.ENUM('role', 'stack', 'topic'),
      allowNull: false,
    },
    tag: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
  },
  {
    tableName: 'question_tags',
    timestamps: false,
    indexes: [
      { fields: ['question_id'] },
      { fields: ['tag_type', 'slug'] },
      { unique: true, fields: ['question_id', 'tag_type', 'slug'] },
    ],
  }
);

module.exports = QuestionTag;
