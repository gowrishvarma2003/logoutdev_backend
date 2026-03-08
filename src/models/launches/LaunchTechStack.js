const { DataTypes } = require('sequelize');
const sequelize = require('../../db/sequelize');

const LaunchTechStack = sequelize.define(
  'LaunchTechStack',
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
    technology: {
      type: DataTypes.STRING(80),
      allowNull: false,
      validate: {
        len: [1, 80],
      },
    },
    rank: {
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
    tableName: 'launch_tech_stack',
    timestamps: false,
    indexes: [
      { fields: ['launch_id'] },
      { fields: ['rank'] },
      { unique: true, fields: ['launch_id', 'technology'] },
    ],
  }
);

module.exports = LaunchTechStack;