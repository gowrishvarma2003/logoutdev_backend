const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const QuestionAnswer = sequelize.define(
  'QuestionAnswer',
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
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [20, 3000],
      },
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_accepted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
    tableName: 'question_answers',
    timestamps: false,
    indexes: [
      { fields: ['question_id'] },
      { fields: ['author_id'] },
      { fields: ['score'] },
      { unique: true, fields: ['question_id', 'author_id'] },
    ],
  }
);

module.exports = QuestionAnswer;
