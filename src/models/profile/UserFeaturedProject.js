const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const UserFeaturedProject = sequelize.define(
  'UserFeaturedProject',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    space_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: 'user_featured_projects',
    timestamps: false,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['space_id'] },
      { unique: true, fields: ['user_id', 'space_id'] },
      { unique: true, fields: ['user_id', 'position'] },
    ],
  }
);

module.exports = UserFeaturedProject;
