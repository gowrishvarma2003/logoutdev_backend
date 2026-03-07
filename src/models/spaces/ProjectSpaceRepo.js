const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ProjectSpaceRepo = sequelize.define(
  'ProjectSpaceRepo',
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
      validate: {
        len: [2, 140],
      },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
      validate: {
        len: [0, 2000],
      },
    },
    default_branch: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'main',
      validate: {
        len: [1, 100],
      },
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    archived_at: {
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
    tableName: 'project_space_repos',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['space_id', 'slug'] },
      { fields: ['space_id'] },
      { fields: ['archived_at'] },
    ],
  }
);

module.exports = ProjectSpaceRepo;
