const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ProjectSpaceIssueComment = sequelize.define(
  'ProjectSpaceIssueComment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    issue_id: {
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
        len: [1, 2000],
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
    tableName: 'project_space_issue_comments',
    timestamps: false,
    indexes: [
      { fields: ['issue_id'] },
      { fields: ['author_id'] },
      { fields: ['parent_comment_id'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = ProjectSpaceIssueComment;
