const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const RepoRelease = sequelize.define(
  'RepoRelease',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    repo_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    tag_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { len: [1, 100] },
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: { len: [1, 200] },
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: '',
    },
    is_draft: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_prerelease: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    published_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
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
    tableName: 'repo_releases',
    timestamps: false,
    indexes: [
      { fields: ['repo_id'] },
      { unique: true, fields: ['repo_id', 'tag_name'] },
      { fields: ['created_by'] },
    ],
  }
);

module.exports = RepoRelease;
