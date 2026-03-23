const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ProjectSpaceRepoAttachment = sequelize.define(
  'ProjectSpaceRepoAttachment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    space_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    repo_id: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: true,
    },
    external_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    label: {
      type: DataTypes.STRING(160),
      allowNull: true,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_primary: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    attached_by: {
      type: DataTypes.UUID,
      allowNull: false,
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
    tableName: 'space_repo_attachments',
    timestamps: false,
    indexes: [
      { fields: ['space_id'] },
      { fields: ['repo_id'], unique: true },
      { fields: ['position'] },
      { fields: ['is_primary'] },
    ],
  }
);

module.exports = ProjectSpaceRepoAttachment;
