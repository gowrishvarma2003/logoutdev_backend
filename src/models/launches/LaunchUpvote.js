const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LaunchUpvote = sequelize.define(
  'LaunchUpvote',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    launch_id: {
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
    tableName: 'launch_upvotes',
    timestamps: false,
    indexes: [
      { fields: ['launch_id'] },
      { fields: ['user_id'] },
      { unique: true, fields: ['launch_id', 'user_id'] },
    ],
  }
);

module.exports = LaunchUpvote;