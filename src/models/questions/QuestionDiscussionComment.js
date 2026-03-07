const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const QuestionDiscussionComment = sequelize.define(
  'QuestionDiscussionComment',
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
    parent_comment_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [1, 1000],
      },
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
    tableName: 'question_discussion_comments',
    timestamps: false,
    indexes: [
      { fields: ['question_id'] },
      { fields: ['author_id'] },
      { fields: ['parent_comment_id'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = QuestionDiscussionComment;
