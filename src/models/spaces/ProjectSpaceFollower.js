const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const ProjectSpaceFollower = sequelize.define(
  'ProjectSpaceFollower',
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
    tableName: 'project_space_followers',
    timestamps: false,
    indexes: [
      { fields: ['space_id'] },
      { fields: ['user_id'] },
      { unique: true, fields: ['space_id', 'user_id'] },
    ],
  }
);

module.exports = ProjectSpaceFollower;
