const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ProjectSpaceDiscussionReply = sequelize.define(
  'ProjectSpaceDiscussionReply',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    thread_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    author_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    parent_reply_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [1, 8000],
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
    tableName: 'project_space_discussion_replies',
    timestamps: false,
    indexes: [
      { fields: ['thread_id'] },
      { fields: ['author_id'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = ProjectSpaceDiscussionReply;
