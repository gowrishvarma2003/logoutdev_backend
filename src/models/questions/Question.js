const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const Question = sequelize.define(
  'Question',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('open', 'mcq'),
      allowNull: false,
    },
    mcq_mode: {
      type: DataTypes.ENUM('single', 'multi'),
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING(160),
      allowNull: false,
      validate: {
        len: [8, 160],
      },
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [20, 4000],
      },
    },
    status: {
      type: DataTypes.ENUM('open', 'closed'),
      allowNull: false,
      defaultValue: 'open',
    },
    accepted_answer_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    answer_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    discussion_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    participant_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    latest_activity_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
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
    tableName: 'questions',
    timestamps: false,
    indexes: [
      { fields: ['author_id'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['latest_activity_at'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = Question;
