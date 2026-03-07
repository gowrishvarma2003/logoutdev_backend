const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const QuestionMcqResponse = sequelize.define(
  'QuestionMcqResponse',
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
    option_id: {
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
    tableName: 'question_mcq_responses',
    timestamps: false,
    indexes: [
      { fields: ['question_id'] },
      { fields: ['user_id'] },
      { fields: ['option_id'] },
      { unique: true, fields: ['question_id', 'option_id', 'user_id'] },
    ],
  }
);

module.exports = QuestionMcqResponse;
