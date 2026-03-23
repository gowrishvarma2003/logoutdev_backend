const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const WATCH_LEVELS = ['all', 'releases', 'ignore'];

const RepoWatch = sequelize.define(
  'RepoWatch',
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
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    level: {
      type: DataTypes.ENUM(...WATCH_LEVELS),
      allowNull: false,
      defaultValue: 'all',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'repo_watches',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['repo_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

module.exports = RepoWatch;
