const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const QuestionAnswerVote = sequelize.define(
  'QuestionAnswerVote',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    answer_id: {
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
    tableName: 'question_answer_votes',
    timestamps: false,
    indexes: [
      { fields: ['answer_id'] },
      { fields: ['user_id'] },
      { unique: true, fields: ['answer_id', 'user_id'] },
    ],
  }
);

module.exports = QuestionAnswerVote;
