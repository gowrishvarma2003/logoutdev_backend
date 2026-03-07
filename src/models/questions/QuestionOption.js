const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const QuestionOption = sequelize.define(
  'QuestionOption',
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
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    text: {
      type: DataTypes.STRING(240),
      allowNull: false,
      validate: {
        len: [1, 240],
      },
    },
    is_correct: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'question_options',
    timestamps: false,
    indexes: [
      { fields: ['question_id'] },
      { unique: true, fields: ['question_id', 'position'] },
    ],
  }
);

module.exports = QuestionOption;
