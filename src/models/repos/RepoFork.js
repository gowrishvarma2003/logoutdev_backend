const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const RepoFork = sequelize.define(
  'RepoFork',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    source_repo_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    forked_repo_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    forked_by: {
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
    tableName: 'repo_forks',
    timestamps: false,
    indexes: [
      { fields: ['source_repo_id'] },
      { fields: ['forked_repo_id'], unique: true },
      { fields: ['forked_by'] },
    ],
  }
);

module.exports = RepoFork;
