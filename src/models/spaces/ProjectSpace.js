const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const SPACE_STATUSES = ['idea', 'building', 'shipping', 'paused', 'archived'];
const SPACE_VISIBILITIES = ['public', 'private'];

const ProjectSpace = sequelize.define(
  'ProjectSpace',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        len: [2, 120],
      },
    },
    slug: {
      type: DataTypes.STRING(140),
      allowNull: false,
      unique: true,
      validate: {
        len: [2, 140],
      },
    },
    summary: {
      type: DataTypes.STRING(300),
      allowNull: false,
      validate: {
        len: [10, 300],
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [20, 10000],
      },
    },
    status: {
      type: DataTypes.ENUM(...SPACE_STATUSES),
      allowNull: false,
      defaultValue: 'idea',
    },
    visibility: {
      type: DataTypes.ENUM(...SPACE_VISIBILITIES),
      allowNull: false,
      defaultValue: 'public',
    },
    primary_repo_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        isUrlOrNull(value) {
          if (value === null || value === undefined || value === '') return;
          const regex = /^https?:\/\/.+/i;
          if (!regex.test(value)) {
            throw new Error('primary_repo_url must be a valid http/https URL.');
          }
        },
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
    tableName: 'project_spaces',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['slug'] },
      { fields: ['owner_id'] },
      { fields: ['status'] },
      { fields: ['visibility'] },
      { fields: ['created_at'] },
    ],
  }
);

module.exports = ProjectSpace;
