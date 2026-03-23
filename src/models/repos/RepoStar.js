const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const RepoStar = sequelize.define(
  'RepoStar',
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
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'repo_stars',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['repo_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

module.exports = RepoStar;
